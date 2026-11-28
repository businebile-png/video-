import fs from 'node:fs';
import path from 'node:path';
import type {Db} from '../core/db.js';
import type {AppConfig} from '../core/config.js';
import type {Account} from '../core/accounts.js';
import {PATHS, ensureDir} from '../core/paths.js';
import {sleep} from '../core/util.js';
import {photoTitle} from '../generate/captions.js';

/**
 * Publishers. Each one uses the account owner's OWN credentials on an official API and returns a typed outcome:
 *  - "published" / "queued_remote" (the platform or Zernio confirmed and returned an id),
 *  - "deferred" (a limit was reached: retry after the cooldown the platform gave, never around it),
 *  - "failed" (a definitive refusal: no retry),
 *  - "retry" (network or 5xx: retried with backoff, at most max_attempts).
 */

export type Outcome =
  | {kind: 'published' | 'queued_remote'; providerPostId: string; permalink?: string | null}
  | {kind: 'deferred'; until: Date; reason: string}
  | {kind: 'failed'; reason: string}
  | {kind: 'retry'; reason: string};

export interface Job {
  scheduleId: string;
  slideshow: any;
  account: Account;
  scheduledFor: Date;
  images: Array<{path: string; public_url: string | null}>;
}

export interface Publisher {
  id: string;
  ready(): Promise<{ok: boolean; reason?: string}>;
  publish(job: Job): Promise<Outcome>;
}

class HttpError extends Error {
  constructor(readonly status: number, readonly body: any, message: string) {
    super(message);
  }
}

async function http(url: string, init: RequestInit & {timeoutMs?: number} = {}): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 60_000);
  try {
    const res = await fetch(url, {...init, signal: ctrl.signal});
    const text = await res.text();
    let body: any;
    try {
      body = JSON.parse(text);
    } catch {
      body = {raw: text.slice(0, 300)};
    }
    if (!res.ok) throw new HttpError(res.status, body, `HTTP ${res.status} : ${body?.error?.message ?? body?.error ?? body?.message ?? text.slice(0, 200)}`);
    return body;
  } finally {
    clearTimeout(t);
  }
}

function classify(e: unknown): Outcome {
  if (e instanceof HttpError) {
    if (e.status === 429) {
      const m = String(e.message).match(/(\d+)\s*(min|minute|s|sec|second|h|hour)/i);
      const ms = m ? Number(m[1]) * (/^h/i.test(m[2]) ? 3_600_000 : /^min/i.test(m[2]) ? 60_000 : 1000) : 3_600_000;
      return {kind: 'deferred', until: new Date(Date.now() + ms), reason: `limite atteinte : ${e.message}`};
    }
    if (e.status >= 500) return {kind: 'retry', reason: e.message};
    return {kind: 'failed', reason: e.message};
  }
  return {kind: 'retry', reason: (e as Error).message};
}

/* ---------------- Zernio (TikTok photo carousels, and any account connected there) ---------------- */

export class ZernioPublisher implements Publisher {
  id = 'zernio';
  private base = 'https://zernio.com/api/v1';
  constructor(private key: string | null = process.env.ZERNIO_API_KEY ?? null, private cfg?: AppConfig) {}

  private headers() {
    return {Authorization: `Bearer ${this.key ?? 'proxy'}`, 'Content-Type': 'application/json'};
  }

  async ready() {
    try {
      await http(`${this.base}/accounts`, {headers: this.headers(), timeoutMs: 20_000});
      return {ok: true};
    } catch (e) {
      return {ok: false, reason: e instanceof HttpError && e.status === 401 ? 'clé API Zernio refusée (invalide, révoquée ou expirée) : crée une nouvelle clé dans Zernio' : (e as Error).message};
    }
  }

  /** Uploads one JPEG through a presigned URL; returns the public URL Zernio serves. */
  async upload(file: string): Promise<string> {
    const pre = await http(`${this.base}/media/presign`, {method: 'POST', headers: this.headers(), body: JSON.stringify({filename: path.basename(file), contentType: 'image/jpeg', size: fs.statSync(file).size})});
    const put = await fetch(pre.uploadUrl, {method: 'PUT', headers: {'Content-Type': 'image/jpeg'}, body: fs.readFileSync(file)});
    if (!put.ok) throw new HttpError(put.status, null, `envoi de l’image refusé (HTTP ${put.status})`);
    return pre.publicUrl;
  }

  payload(job: Job, urls: string[]) {
    const ss = job.slideshow;
    const settings = job.account.settings;
    const base: any = {
      content: job.account.platform === 'tiktok' ? photoTitle(ss.hook) : ss.caption,
      mediaItems: urls.map((url) => ({type: 'image', url})),
      platforms: [{platform: job.account.platform, accountId: job.account.providerAccountId}],
      scheduledFor: job.scheduledFor.toISOString(),
      timezone: this.cfg?.accounts.timezone ?? 'Europe/Paris',
    };
    if (job.account.platform === 'tiktok') {
      base.tiktokSettings = {
        privacy_level: settings.privacy ?? 'PUBLIC_TO_EVERYONE',
        allow_comment: settings.allowComments ?? true,
        media_type: 'photo',
        photo_cover_index: 0,
        description: ss.caption,
        auto_add_music: settings.autoAddMusic ?? true,
        content_preview_confirmed: true,
        express_consent_given: true,
        commercialContentType: 'brand_content',
      };
    }
    return base;
  }

  async publish(job: Job): Promise<Outcome> {
    try {
      const urls: string[] = [];
      for (const im of job.images) urls.push(im.public_url ?? (await this.upload(path.join(PATHS.var, im.path))));
      const res = await http(`${this.base}/posts`, {method: 'POST', headers: this.headers(), body: JSON.stringify(this.payload(job, urls))});
      const post = res.post ?? res.data ?? res;
      const pid = post?._id ?? post?.id;
      if (!pid) return {kind: 'failed', reason: `réponse Zernio sans identifiant : ${JSON.stringify(res).slice(0, 200)}`};
      return {kind: 'queued_remote', providerPostId: String(pid), permalink: post?.platforms?.[0]?.platformPostUrl ?? null};
    } catch (e) {
      return classify(e);
    }
  }
}

/* ---------------- Meta (Instagram carousel, Threads carousel), official APIs ---------------- */

export class MetaPublisher implements Publisher {
  id = 'meta';
  constructor(
    private ig: {token: string | null; base: string} = {token: process.env.INSTAGRAM_ACCESS_TOKEN ?? null, base: 'https://graph.instagram.com/v24.0'},
    private th: {token: string | null; base: string} = {token: process.env.THREADS_ACCESS_TOKEN ?? null, base: 'https://graph.threads.net/v1.0'},
  ) {}

  async ready() {
    if (!this.ig.token && !this.th.token) return {ok: false, reason: 'INSTAGRAM_ACCESS_TOKEN et THREADS_ACCESS_TOKEN absents (voir docs/publication-meta.md du studio)'};
    return {ok: true};
  }

  private q(params: Record<string, string>) {
    return new URLSearchParams(params).toString();
  }

  async publish(job: Job): Promise<Outcome> {
    const urls = job.images.map((i) => i.public_url).filter((u): u is string => !!u);
    if (urls.length !== job.images.length) return {kind: 'failed', reason: 'images sans adresse publique : lance « media:stage » (ou un hébergement) avant la publication Meta'};
    try {
      if (job.account.platform === 'instagram') return await this.instagram(job, urls);
      if (job.account.platform === 'threads') return await this.threads(job, urls);
      return {kind: 'failed', reason: `Meta ne publie pas sur ${job.account.platform}`};
    } catch (e) {
      return classify(e);
    }
  }

  private async instagram(job: Job, urls: string[]): Promise<Outcome> {
    const {token, base} = this.ig;
    if (!token) return {kind: 'failed', reason: 'INSTAGRAM_ACCESS_TOKEN absent'};
    const me = await http(`${base}/me?${this.q({fields: 'user_id,username', access_token: token})}`);
    const uid = me.user_id ?? me.id;
    const limit = await http(`${base}/${uid}/content_publishing_limit?${this.q({fields: 'quota_usage,config', access_token: token})}`).catch(() => null);
    const used = limit?.data?.[0]?.quota_usage;
    const total = limit?.data?.[0]?.config?.quota_total;
    if (typeof used === 'number' && typeof total === 'number' && used >= total) return {kind: 'deferred', until: new Date(Date.now() + 6 * 3_600_000), reason: `quota Instagram atteint (${used}/${total} sur 24 h)`};
    const children: string[] = [];
    for (const url of urls.slice(0, 10)) {
      const c = await http(`${base}/${uid}/media?${this.q({image_url: url, is_carousel_item: 'true', access_token: token})}`, {method: 'POST'});
      children.push(c.id);
    }
    const container = await http(`${base}/${uid}/media?${this.q({media_type: 'CAROUSEL', children: children.join(','), caption: job.slideshow.caption, access_token: token})}`, {method: 'POST'});
    for (let i = 0; i < 20; i++) {
      const st = await http(`${base}/${container.id}?${this.q({fields: 'status_code', access_token: token})}`);
      if (st.status_code === 'FINISHED') break;
      if (st.status_code === 'ERROR' || st.status_code === 'EXPIRED') return {kind: 'failed', reason: `conteneur Instagram ${st.status_code}`};
      await sleep(5000);
    }
    const pub = await http(`${base}/${uid}/media_publish?${this.q({creation_id: container.id, access_token: token})}`, {method: 'POST'});
    const info = await http(`${base}/${pub.id}?${this.q({fields: 'permalink', access_token: token})}`).catch(() => ({}));
    return {kind: 'published', providerPostId: pub.id, permalink: info.permalink ?? null};
  }

  private async threads(job: Job, urls: string[]): Promise<Outcome> {
    const {token, base} = this.th;
    if (!token) return {kind: 'failed', reason: 'THREADS_ACCESS_TOKEN absent'};
    const children: string[] = [];
    for (const url of urls.slice(0, 20)) {
      const c = await http(`${base}/me/threads?${this.q({media_type: 'IMAGE', image_url: url, is_carousel_item: 'true', access_token: token})}`, {method: 'POST'});
      children.push(c.id);
    }
    const container = await http(`${base}/me/threads?${this.q({media_type: 'CAROUSEL', children: children.join(','), text: job.slideshow.caption.slice(0, 500), access_token: token})}`, {method: 'POST'});
    await sleep(30_000);
    const pub = await http(`${base}/me/threads_publish?${this.q({creation_id: container.id, access_token: token})}`, {method: 'POST'});
    const info = await http(`${base}/${pub.id}?${this.q({fields: 'permalink', access_token: token})}`).catch(() => ({}));
    return {kind: 'published', providerPostId: pub.id, permalink: info.permalink ?? null};
  }
}

/* ---------------- Manual: a ready-to-post package when automation is not allowed ---------------- */

export class ManualPublisher implements Publisher {
  id = 'manual';
  constructor(private db: Db, private cfg: AppConfig) {}
  async ready() {
    return {ok: true};
  }
  async publish(job: Job): Promise<Outcome> {
    const {exportSlideshow} = await import('../render/export.js');
    const r = await exportSlideshow(this.db, this.cfg, job.slideshow.id);
    ensureDir(PATHS.exports);
    return {kind: 'failed', reason: `publication manuelle requise : paquet prêt (${path.relative(PATHS.var, r.zip)})`};
  }
}

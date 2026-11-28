import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {Db} from '../core/db.js';
import {PATHS, ensureDir} from '../core/paths.js';
import {sleep} from '../core/util.js';
import {loadMedia, logCall, recordAsset} from './media.js';

/**
 * Licensed B-roll (Pixabay; Pexels when a key exists). Searches are cached 24 h (Pixabay asks API users to),
 * one clip is downloaded only when a video uses it, and every clip used gets a rights record (source page,
 * author, licence). Selection avoids people for product and call-to-action scenes, so nobody filmed can seem
 * to recommend the product (licence rule), and never searches wealth imagery.
 */

export interface StockClip {
  provider: 'pixabay' | 'pexels';
  id: string;
  pageUrl: string;
  author: string;
  authorUrl: string;
  tags: string[];
  duration: number;
  width: number;
  height: number;
  url: string;
  bytes: number;
}

const PEOPLE = /\b(person|people|woman|women|man|men|girl|boy|child|children|face|portrait|selfie|model|businessman|businesswoman|couple|family|human|lady|guy|student|worker|friends|team)\b/i;
const WEALTH = /\b(money|cash|dollar|euro|luxury|rich|wealth|gold|car|lamborghini|ferrari|yacht|jet|villa|watch|rolex|banknote|coins?)\b/i;

function cacheFile(provider: string, params: Record<string, string>): string {
  return path.join(PATHS.var, 'cache', provider, `${crypto.createHash('sha1').update(JSON.stringify(params)).digest('hex')}.json`);
}

let lastCall = 0;
async function throttle(): Promise<void> {
  const wait = lastCall + 700 - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
}

export async function searchStock(db: Db, query: string, opts: {perPage?: number; ref?: string} = {}): Promise<StockClip[]> {
  if (WEALTH.test(query)) throw new Error(`Recherche refusée (images de richesse) : ${query}`);
  const out: StockClip[] = [];
  const pix = process.env.PIXABAY_API_KEY?.trim();
  if (pix) out.push(...(await searchPixabay(db, query, pix, opts)));
  const pex = process.env.PEXELS_API_KEY?.trim();
  if (pex && out.length < 4) out.push(...(await searchPexels(db, query, pex, opts)));
  if (!pix && !pex) throw new Error('Aucune banque de vidéos configurée (PIXABAY_API_KEY ou PEXELS_API_KEY)');
  return out;
}

async function searchPixabay(db: Db, query: string, key: string, opts: {perPage?: number; ref?: string}): Promise<StockClip[]> {
  const params = {q: query.slice(0, 100), video_type: 'film', safesearch: 'true', order: 'popular', per_page: String(Math.min(50, Math.max(3, opts.perPage ?? 20)))};
  const cf = cacheFile('pixabay', params);
  let data: any;
  if (fs.existsSync(cf) && Date.now() - fs.statSync(cf).mtimeMs < 24 * 3_600_000) data = JSON.parse(fs.readFileSync(cf, 'utf8'));
  else {
    await throttle();
    const t0 = Date.now();
    const r = await fetch(`https://pixabay.com/api/videos/?${new URLSearchParams({key, ...params})}`, {signal: AbortSignal.timeout(30_000)});
    if (!r.ok) {
      const msg = r.status === 429 ? 'quota Pixabay atteint (100 requêtes par minute)' : `HTTP ${r.status}`;
      logCall(db, {provider: 'pixabay', kind: 'search', ref: opts.ref, ok: false, ms: Date.now() - t0, error: msg});
      throw new Error(`Pixabay : ${msg}`);
    }
    data = await r.json();
    logCall(db, {provider: 'pixabay', kind: 'search', ref: opts.ref, ok: true, units: 1, unit: 'recherche', ms: Date.now() - t0});
    ensureDir(path.dirname(cf));
    fs.writeFileSync(cf, JSON.stringify(data));
  }
  return (data.hits ?? [])
    .map((h: any): StockClip | null => {
      const r = h.videos?.large?.url ? h.videos.large : h.videos?.medium;
      if (!r?.url) return null;
      return {
        provider: 'pixabay',
        id: String(h.id),
        pageUrl: h.pageURL,
        author: h.user,
        authorUrl: `https://pixabay.com/users/${encodeURIComponent(h.user)}-${h.user_id}/`,
        tags: String(h.tags ?? '').split(',').map((t: string) => t.trim().toLowerCase()).filter(Boolean),
        duration: h.duration,
        width: r.width,
        height: r.height,
        url: r.url,
        bytes: r.size ?? 0,
      };
    })
    .filter(Boolean) as StockClip[];
}

async function searchPexels(db: Db, query: string, key: string, opts: {perPage?: number; ref?: string}): Promise<StockClip[]> {
  const params = {query: query.slice(0, 100), per_page: String(Math.min(40, opts.perPage ?? 15)), orientation: 'portrait'};
  const cf = cacheFile('pexels', params);
  let data: any;
  if (fs.existsSync(cf) && Date.now() - fs.statSync(cf).mtimeMs < 24 * 3_600_000) data = JSON.parse(fs.readFileSync(cf, 'utf8'));
  else {
    await throttle();
    const t0 = Date.now();
    const r = await fetch(`https://api.pexels.com/videos/search?${new URLSearchParams(params)}`, {headers: {Authorization: key}, signal: AbortSignal.timeout(30_000)});
    if (!r.ok) {
      logCall(db, {provider: 'pexels', kind: 'search', ref: opts.ref, ok: false, ms: Date.now() - t0, error: `HTTP ${r.status}`});
      throw new Error(`Pexels : HTTP ${r.status}`);
    }
    data = await r.json();
    logCall(db, {provider: 'pexels', kind: 'search', ref: opts.ref, ok: true, units: 1, unit: 'recherche', ms: Date.now() - t0});
    ensureDir(path.dirname(cf));
    fs.writeFileSync(cf, JSON.stringify(data));
  }
  return (data.videos ?? [])
    .map((v: any): StockClip | null => {
      const f = (v.video_files ?? []).filter((x: any) => x.file_type === 'video/mp4' && x.width && x.height).sort((a: any, b: any) => Math.abs(a.height - 1920) - Math.abs(b.height - 1920))[0];
      if (!f) return null;
      return {provider: 'pexels', id: String(v.id), pageUrl: v.url, author: v.user?.name ?? '', authorUrl: v.user?.url ?? '', tags: [], duration: v.duration, width: f.width, height: f.height, url: f.link, bytes: 0};
    })
    .filter(Boolean) as StockClip[];
}

/** Best clip for a scene: long enough, sharp enough, vertical if possible, no person when the product is mentioned, not used recently. */
export function pickClip(clips: StockClip[], opts: {minSeconds: number; aspect: '9:16' | '1:1' | '16:9'; noPeople: boolean; avoid: Set<string>; rand: () => number; query?: string}): StockClip | null {
  // Relevance: share of the search words found in the clip's tags (Pixabay often returns loosely related clips).
  const words = (opts.query ?? '').toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const relevance = (c: StockClip) => (!words.length || !c.tags.length ? 0.5 : words.filter((w) => c.tags.some((t) => t.includes(w) || w.includes(t))).length / words.length);
  const scored = clips
    .filter((c) => !words.length || !c.tags.length || relevance(c) >= 0.5)
    .filter((c) => c.duration >= Math.min(opts.minSeconds, 6) && !opts.avoid.has(`${c.provider}:${c.id}`))
    .filter((c) => !WEALTH.test(c.tags.join(' ')))
    .filter((c) => !(opts.noPeople && PEOPLE.test(c.tags.join(' '))))
    .map((c) => {
      const vertical = c.height > c.width;
      const want = opts.aspect === '9:16' ? vertical : opts.aspect === '16:9' ? !vertical : true;
      const sharp = Math.min(c.width, c.height) >= 1080 ? 1 : Math.min(c.width, c.height) >= 720 ? 0.7 : 0.3;
      const people = PEOPLE.test(c.tags.join(' ')) ? -0.4 : 0;
      return {c, s: (want ? 1 : 0.55) + sharp + people + relevance(c) * 1.5 + Math.min(c.duration, 20) / 40 + opts.rand() * 0.3};
    })
    .sort((a, b) => b.s - a.s);
  return scored[0]?.c ?? null;
}

/** Download one clip (kept in var/cache/clips; never redistributed as such) and record its rights. */
export async function downloadClip(db: Db, clip: StockClip, ref: string): Promise<{file: string; assetId: string}> {
  const dir = ensureDir(path.join(PATHS.var, 'cache', 'clips'));
  const file = path.join(dir, `${clip.provider}-${clip.id}-${clip.width}x${clip.height}.mp4`);
  if (!fs.existsSync(file) || fs.statSync(file).size < 10_000) {
    const t0 = Date.now();
    const r = await fetch(clip.url, {signal: AbortSignal.timeout(180_000)});
    if (!r.ok) {
      logCall(db, {provider: clip.provider, kind: 'download', ref, ok: false, ms: Date.now() - t0, error: `HTTP ${r.status}`});
      throw new Error(`${clip.provider} : téléchargement refusé (HTTP ${r.status})`);
    }
    const buf = Buffer.from(await r.arrayBuffer());
    fs.writeFileSync(file, buf);
    logCall(db, {provider: clip.provider, kind: 'download', ref, ok: true, units: Math.round(buf.length / 1e5) / 10, unit: 'Mo', ms: Date.now() - t0});
  }
  const def = loadMedia().stock.find((s) => s.id === clip.provider)!;
  const assetId = recordAsset(db, {
    kind: 'stock-video',
    provider: clip.provider,
    sourceId: clip.id,
    sourceUrl: clip.pageUrl,
    author: clip.author,
    authorUrl: clip.authorUrl,
    file,
    license: def.license,
    licenseUrl: def.licenseUrl,
    commercialOk: def.commercial,
    attribution: def.attribution ? `${clip.author} (${clip.provider})` : undefined,
    meta: {tags: clip.tags, duration: clip.duration, width: clip.width, height: clip.height, downloadedFrom: clip.url.split('?')[0]},
  });
  return {file, assetId};
}

export const hasPeople = (tags: string[]) => PEOPLE.test(tags.join(' '));

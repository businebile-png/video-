import fs from 'node:fs';
import path from 'node:path';
import type {Db} from '../core/db.js';
import type {AppConfig} from '../core/config.js';
import {getAccount} from '../core/accounts.js';
import {PATHS, ROOT, ensureDir} from '../core/paths.js';
import {nowIso, parseJson} from '../core/util.js';
import {photoTitle} from '../generate/captions.js';
import {runQc} from '../qc/qc.js';
import {runVideoQc} from '../video/qc.js';
import {ManualPublisher, MetaPublisher, ZernioPublisher, type Job, type Outcome, type Publisher} from './publishers.js';

/**
 * Publication queue runner. Takes the due items of the calendar and hands them to the account's publisher.
 * Guards: the account must allow automatic publication (settings.autoPublish), the slideshow must still be
 * approved and QC-clean, and the publisher must be ready. Otherwise the item becomes "manual_required" with a
 * ready-to-post package. Every attempt is logged; retries only for transient errors, never around a limit.
 */

export interface RunReport {
  considered: number;
  published: number;
  queued: number;
  deferred: number;
  failed: number;
  manual: number;
  skipped: Array<{id: string; reason: string}>;
  dryRun: boolean;
}

function publisherFor(db: Db, cfg: AppConfig, provider: string): Publisher {
  if (provider === 'zernio') return new ZernioPublisher(process.env.ZERNIO_API_KEY ?? null, cfg);
  if (provider === 'meta') return new MetaPublisher();
  return new ManualPublisher(db, cfg);
}

function log(db: Db, scheduleId: string, message: string, level: 'info' | 'warn' | 'error' = 'info', data?: unknown) {
  db.event('publish', message, {ref: scheduleId, level, data});
}

export async function runDue(db: Db, cfg: AppConfig, opts: {now?: Date; dryRun?: boolean; leadMinutes?: number; metaLeadMinutes?: number; only?: string} = {}): Promise<RunReport> {
  const now = opts.now ?? new Date();
  // Zernio schedules on its side (scheduledFor): hand items over up to 36 h ahead. Meta has no scheduling: 90 min.
  const lead = (opts.leadMinutes ?? 36 * 60) * 60_000;
  // Meta publishes at once (no remote scheduling): never hand an item over long before its time.
  const metaLead = (opts.metaLeadMinutes ?? 90) * 60_000;
  const rows0 = db.all(
    `SELECT * FROM schedule WHERE status IN ('planned', 'deferred') AND scheduled_for <= ? AND (next_attempt_at IS NULL OR next_attempt_at <= ?) ${opts.only ? 'AND id = ?' : ''} ORDER BY scheduled_for`,
    new Date(now.getTime() + lead).toISOString(),
    now.toISOString(),
    ...(opts.only ? [opts.only] : []),
  );
  const rows = rows0.filter((r) => r.provider === 'zernio' || new Date(r.scheduled_for).getTime() <= now.getTime() + metaLead);
  const report: RunReport = {considered: rows.length, published: 0, queued: 0, deferred: 0, failed: 0, manual: 0, skipped: [], dryRun: !!opts.dryRun};
  const readiness = new Map<string, {ok: boolean; reason?: string}>();
  for (const row of rows) {
    const ss = db.get('SELECT * FROM slideshows WHERE id = ?', row.slideshow_id);
    const account = getAccount(db, row.account_id);
    // Re-check just before publishing: facts may have expired (prices are valid 7 days) or the text changed.
    const isVideo = ss?.kind === 'video';
    const qc = ss && ss.status === 'scheduled' ? (isVideo ? runVideoQc(db, cfg, ss.id) : runQc(db, cfg, ss.id)) : isVideo ? parseJson<any>(ss?.qc_json, {}).video : parseJson<any>(ss?.qc_json, {}).report;
    if (!ss || ss.status !== 'scheduled' || !qc?.ok) {
      report.skipped.push({id: row.id, reason: 'carrousel modifié ou contrôle qualité non valide : reprogrammation nécessaire'});
      db.run("UPDATE schedule SET status = 'cancelled', last_error = ?, updated_at = ? WHERE id = ?", 'contrôle qualité non valide', nowIso(), row.id);
      continue;
    }
    const images = db.all<{path: string; public_url: string | null}>('SELECT path, public_url FROM images WHERE slideshow_id = ? ORDER BY slide_index', ss.id);
    const job: Job = {scheduleId: row.id, slideshow: ss, account, scheduledFor: new Date(row.scheduled_for), images};
    if (isVideo) {
      const spec = parseJson<any>(ss.video_json, {});
      const v = db.get<any>('SELECT * FROM videos WHERE slideshow_id = ? AND aspect = ?', ss.id, spec.aspect ?? '9:16');
      if (!v) {
        report.skipped.push({id: row.id, reason: 'vidéo non montée'});
        continue;
      }
      const tlFile = path.join(PATHS.var, path.dirname(v.path), 'timeline.json');
      const tl = fs.existsSync(tlFile) ? JSON.parse(fs.readFileSync(tlFile, 'utf8')) : null;
      const coverMs = tl ? Math.round(Math.min(tl.scenes[0].end - 0.15, Math.max(1.2, tl.scenes[0].speechStart + 1.3)) * 1000) : 1200;
      job.video = {path: v.path, public_url: v.public_url, poster_path: v.poster_path, cover_url: v.cover_url, duration_s: v.duration_s, coverMs};
    }
    if (!account.settings.autoPublish) {
      if (new Date(row.scheduled_for).getTime() > now.getTime()) {
        report.skipped.push({id: row.id, reason: 'publication automatique désactivée pour ce compte : attente de l’heure prévue pour préparer le paquet manuel'});
        continue;
      }
      if (opts.dryRun) {
        report.skipped.push({id: row.id, reason: 'simulation : passerait en publication manuelle'});
        continue;
      }
      const out = await new ManualPublisher(db, cfg).publish(job);
      db.run("UPDATE schedule SET status = 'manual_required', last_error = ?, updated_at = ? WHERE id = ?", (out as any).reason, nowIso(), row.id);
      log(db, row.id, `À publier à la main (publication automatique désactivée) : ${account.id}`, 'warn');
      report.manual++;
      continue;
    }
    let provider = row.provider;
    if (!readiness.has(provider)) readiness.set(provider, await publisherFor(db, cfg, provider).ready());
    if (!readiness.get(provider)!.ok && account.fallbackProvider && account.fallbackProvider !== provider) {
      log(db, row.id, `${provider} indisponible (${readiness.get(provider)!.reason}) : essai avec ${account.fallbackProvider}`, 'warn');
      provider = account.fallbackProvider;
      if (!readiness.has(provider)) readiness.set(provider, await publisherFor(db, cfg, provider).ready());
    }
    const ready = readiness.get(provider)!;
    if (!ready.ok || provider === 'metricool' || provider === 'manual') {
      if (opts.dryRun) {
        report.skipped.push({id: row.id, reason: `simulation : ${provider} indisponible (${ready.reason ?? 'pas d’API publique'}) → paquet manuel`});
        continue;
      }
      if (new Date(row.scheduled_for).getTime() > now.getTime()) {
        report.skipped.push({id: row.id, reason: `${provider} indisponible : ${ready.reason ?? 'publication via une session Claude (MCP) ou à la main'}`});
        continue;
      }
      const out = await new ManualPublisher(db, cfg).publish(job);
      db.run("UPDATE schedule SET status = 'manual_required', last_error = ?, updated_at = ? WHERE id = ?", `${provider} indisponible (${ready.reason ?? 'pas d’API'}) — ${(out as any).reason}`, nowIso(), row.id);
      report.manual++;
      continue;
    }
    if (opts.dryRun) {
      report.skipped.push({id: row.id, reason: `simulation : prêt pour ${provider}`});
      continue;
    }
    db.run("UPDATE schedule SET status = 'publishing', attempts = attempts + 1, updated_at = ? WHERE id = ?", nowIso(), row.id);
    const out: Outcome = await publisherFor(db, cfg, provider).publish(job);
    applyOutcome(db, row, out, report);
  }
  return report;
}

export function applyOutcome(db: Db, row: any, out: Outcome, report?: RunReport): void {
  const now = nowIso();
  switch (out.kind) {
    case 'published':
    case 'queued_remote':
      db.run('UPDATE schedule SET status = ?, provider_post_id = ?, permalink = ?, published_at = ?, last_error = NULL, updated_at = ? WHERE id = ?', out.kind, out.providerPostId, out.permalink ?? null, out.kind === 'published' ? now : null, now, row.id);
      if (out.kind === 'published') db.run("UPDATE slideshows SET status = 'published', updated_at = ? WHERE id = ?", now, row.slideshow_id);
      db.event('publish', out.kind === 'published' ? `Publié (${out.providerPostId})` : `Confié à la plateforme pour ${row.scheduled_for} (${out.providerPostId})`, {ref: row.id});
      if (report) out.kind === 'published' ? report.published++ : report.queued++;
      break;
    case 'deferred':
      db.run("UPDATE schedule SET status = 'deferred', next_attempt_at = ?, last_error = ?, updated_at = ? WHERE id = ?", out.until.toISOString(), out.reason, now, row.id);
      db.event('publish', `Reporté : ${out.reason}`, {ref: row.id, level: 'warn'});
      if (report) report.deferred++;
      break;
    case 'retry': {
      const attempts = (row.attempts ?? 0) + 1;
      if (attempts >= (row.max_attempts ?? 3)) {
        db.run("UPDATE schedule SET status = 'failed', last_error = ?, updated_at = ? WHERE id = ?", `abandon après ${attempts} essais : ${out.reason}`, now, row.id);
        db.run("UPDATE slideshows SET status = 'failed', updated_at = ? WHERE id = ?", now, row.slideshow_id);
        if (report) report.failed++;
      } else {
        db.run("UPDATE schedule SET status = 'planned', next_attempt_at = ?, last_error = ?, updated_at = ? WHERE id = ?", new Date(Date.now() + 2 ** attempts * 5 * 60_000).toISOString(), out.reason, now, row.id);
        if (report) report.deferred++;
      }
      db.event('publish', `Échec temporaire : ${out.reason}`, {ref: row.id, level: 'warn'});
      break;
    }
    case 'failed':
      db.run("UPDATE schedule SET status = 'failed', last_error = ?, updated_at = ? WHERE id = ?", out.reason, now, row.id);
      db.run("UPDATE slideshows SET status = 'failed', updated_at = ? WHERE id = ?", now, row.slideshow_id);
      db.event('publish', `Échec : ${out.reason}`, {ref: row.id, level: 'error'});
      if (report) report.failed++;
      break;
  }
}

/** Failed items may be retried only when the cause was transient or fixed by the user (new key, reconnected account). */
export function retry(db: Db, scheduleId: string): void {
  const r = db.get('SELECT * FROM schedule WHERE id = ?', scheduleId);
  if (!r) throw new Error(`Programmation inconnue : ${scheduleId}`);
  if (!['failed', 'deferred', 'manual_required'].includes(r.status)) throw new Error(`Statut « ${r.status} » : rien à relancer`);
  if (r.status === 'deferred' && r.next_attempt_at && new Date(r.next_attempt_at) > new Date()) throw new Error(`Limite de la plateforme : nouvelle tentative possible après ${r.next_attempt_at} (aucun contournement)`);
  db.run("UPDATE schedule SET status = 'planned', attempts = 0, next_attempt_at = NULL, updated_at = ? WHERE id = ?", nowIso(), scheduleId);
  db.run("UPDATE slideshows SET status = 'scheduled', updated_at = ? WHERE id = ?", nowIso(), r.slideshow_id);
}

/** Copies rendered slides (or the video and its cover) into viral/media/<id>/ (published by git) and records their public URLs. */
export function stageMedia(db: Db, slideshowId: string, baseUrl = process.env.VIRAL_MEDIA_BASE_URL): {dir: string; urls: string[]} {
  if (!baseUrl) throw new Error('VIRAL_MEDIA_BASE_URL absente (ex. https://cdn.jsdelivr.net/gh/<compte>/<dépôt>@<branche>/viral/media)');
  const vids = db.all('SELECT v.* FROM videos v JOIN slideshows s ON s.id = v.slideshow_id WHERE v.slideshow_id = ? AND s.kind = ?', slideshowId, 'video');
  if (vids.length) {
    const dir = ensureDir(path.join(ROOT, 'media', slideshowId));
    const urls: string[] = [];
    for (const v of vids) {
      const tag = v.aspect.replace(':', 'x');
      fs.copyFileSync(path.join(PATHS.var, v.path), path.join(dir, `video-${tag}.mp4`));
      const url = `${baseUrl.replace(/\/$/, '')}/${slideshowId}/video-${tag}.mp4`;
      let cover: string | null = null;
      if (v.poster_path && fs.existsSync(path.join(PATHS.var, v.poster_path))) {
        fs.copyFileSync(path.join(PATHS.var, v.poster_path), path.join(dir, `cover-${tag}.jpg`));
        cover = `${baseUrl.replace(/\/$/, '')}/${slideshowId}/cover-${tag}.jpg`;
      }
      db.run('UPDATE videos SET public_url = ?, cover_url = ? WHERE id = ?', url, cover, v.id);
      urls.push(url);
    }
    return {dir, urls};
  }
  const images = db.all('SELECT * FROM images WHERE slideshow_id = ? ORDER BY slide_index', slideshowId);
  if (!images.length) throw new Error(`${slideshowId} : aucune image rendue`);
  const dir = ensureDir(path.join(ROOT, 'media', slideshowId));
  const urls: string[] = [];
  for (const im of images) {
    const name = path.basename(im.path);
    fs.copyFileSync(path.join(PATHS.var, im.path), path.join(dir, name));
    const url = `${baseUrl.replace(/\/$/, '')}/${slideshowId}/${name}`;
    db.run('UPDATE images SET public_url = ? WHERE id = ?', url, im.id);
    urls.push(url);
  }
  return {dir, urls};
}

/**
 * Plan for a Claude session that publishes through the Zernio connector (MCP): one ready-made posts_create
 * payload per due item. After posting, the session records the result with « publish:record ».
 */
export function bridgePlan(db: Db, cfg: AppConfig, horizonHours = 36) {
  const rows = db.all("SELECT * FROM schedule WHERE status IN ('planned', 'deferred', 'manual_required') AND scheduled_for <= ? ORDER BY scheduled_for", new Date(Date.now() + horizonHours * 3_600_000).toISOString());
  return rows.map((row) => {
    const ss = db.get('SELECT * FROM slideshows WHERE id = ?', row.slideshow_id)!;
    const account = getAccount(db, row.account_id);
    const urls = db.all('SELECT public_url FROM images WHERE slideshow_id = ? ORDER BY slide_index', ss.id).map((i) => i.public_url);
    const ready = urls.length > 0 && urls.every(Boolean);
    const zernio = new ZernioPublisher(null, cfg).payload({scheduleId: row.id, slideshow: ss, account, scheduledFor: new Date(row.scheduled_for), images: []}, urls);
    return {
      scheduleId: row.id,
      slideshowId: ss.id,
      account: account.id,
      provider: account.provider,
      scheduledFor: row.scheduled_for,
      mediaReady: ready,
      zernioPostsCreate:
        account.provider === 'zernio'
          ? {content: zernio.content, media_items: zernio.mediaItems, platforms: zernio.platforms, scheduled_for: zernio.scheduledFor, timezone: zernio.timezone, tiktok_settings: zernio.tiktokSettings}
          : null,
      title: photoTitle(ss.hook),
      caption: ss.caption,
      note: ready ? null : 'images sans adresse publique : « media:stage » puis git push',
    };
  });
}

export function recordPublication(db: Db, scheduleId: string, r: {status: 'published' | 'queued_remote' | 'failed'; providerPostId?: string; permalink?: string; error?: string}): void {
  const row = db.get('SELECT * FROM schedule WHERE id = ?', scheduleId);
  if (!row) throw new Error(`Programmation inconnue : ${scheduleId}`);
  if (r.status === 'failed') applyOutcome(db, row, {kind: 'failed', reason: r.error ?? 'échec signalé'});
  else applyOutcome(db, row, {kind: r.status, providerPostId: r.providerPostId ?? 'inconnu', permalink: r.permalink ?? null});
}

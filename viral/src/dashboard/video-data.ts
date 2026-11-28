import fs from 'node:fs';
import path from 'node:path';
import type {Db} from '../core/db.js';
import type {AppConfig} from '../core/config.js';
import {listAccounts, videoSettings} from '../core/accounts.js';
import {PATHS} from '../core/paths.js';
import {parseJson} from '../core/util.js';
import {loadMedia, providerCosts} from '../video/media.js';
import {MUSIC_CATEGORIES} from '../video/music.js';
import {SFX_LABELS, SFX_NAMES} from '../video/sfx.js';
import {loadTracks, checkTrack} from '../video/music-library.js';
import {VIDEO_FORMATS} from '../video/formats.js';
import {aiVideoProviders} from '../video/aigen.js';

const PREVIEWS = () => path.join(PATHS.var, 'audio', 'previews');
const mediaUrl = (abs: string) => `/media/${path.relative(PATHS.var, abs).split(path.sep).map(encodeURIComponent).join('/')}`;
const exists = (f: string) => fs.existsSync(f);

/** Audio Studio: every voice (with its preview when generated), music categories, licensed tracks, effects, account settings. */
export function audioStudio(db: Db, cfg: AppConfig) {
  const media = loadMedia();
  const pv = PREVIEWS();
  const voices = media.voices.map((v) => {
    const f = path.join(pv, `voice-${v.id}.mp3`);
    return {id: v.id, label: v.label, engine: v.engine, language: v.language, languages: v.languages ?? [v.language], gender: v.gender, accent: v.accent, style: v.style ?? '', speed: v.speed ?? '', license: v.license, credit: v.credit ?? null, commercial: v.commercial === true ? 'oui' : 'seulement avec une offre payante', local: v.engine === 'chatterbox' || v.engine === 'kokoro', preview: exists(f) ? mediaUrl(f) : null};
  });
  const music = Object.entries(MUSIC_CATEGORIES).map(([id, c]) => {
    const f = path.join(pv, `music-${id}.mp3`);
    return {id, label: c.label, description: c.description, license: 'Création originale (aucun droit tiers) : publiable partout', preview: exists(f) ? mediaUrl(f) : null};
  });
  const tracks = loadTracks().map((t) => ({id: t.id, title: t.title, artist: t.artist, license: t.license, platforms: t.platforms, moods: t.moods, problems: checkTrack(t)}));
  const sfx = SFX_NAMES.map((n) => {
    const f = path.join(pv, `sfx-${n}.mp3`);
    return {id: n, label: SFX_LABELS[n], preview: exists(f) ? mediaUrl(f) : null};
  });
  const accounts = listAccounts(db).map((a) => {
    const v = videoSettings(a);
    return {id: a.id, platform: a.platform, handle: a.handle, voice: v.voice, audio: v.audio, captions: v.captions, music: v.music};
  });
  return {voices, music, tracks, sfx, accounts, captionStyles: ['auto', 'mot', 'phrase', 'tiktok', 'documentaire', 'minimal', 'cinematique'], animations: ['pop', 'fondu', 'glisse', 'rebond', 'machine']};
}

const VSTATUS = (s: string, job?: any) => (job && ['queued', 'running', 'retry'].includes(job.status) ? 'en_cours' : s);

/** Video library: generated, in progress, finished, to review, scheduled, published, failed; costs and performance. */
export function videosPage(db: Db, cfg: AppConfig) {
  const rows = db.all("SELECT s.*, v.path AS vpath, v.poster_path, v.duration_s, v.bytes, v.qc_status, v.render_ms FROM slideshows s LEFT JOIN videos v ON v.slideshow_id = s.id AND v.aspect = s.format WHERE s.kind = 'video' ORDER BY s.created_at DESC LIMIT 300");
  const jobs = db.all("SELECT * FROM video_jobs WHERE status IN ('queued', 'running', 'retry') ORDER BY created_at DESC LIMIT 50");
  const byId = new Map(db.all('SELECT * FROM video_jobs WHERE slideshow_id IS NOT NULL').map((j) => [j.slideshow_id, j]));
  const perf = new Map(db.all('SELECT slideshow_id, views, likes, comments, shares, score, avg_watch_s, completion_rate FROM posts WHERE is_own = 1 AND slideshow_id IS NOT NULL').map((p) => [p.slideshow_id, p]));
  const costs = new Map(db.all('SELECT ref, ROUND(SUM(cost_eur), 4) AS c FROM provider_calls GROUP BY ref').map((r) => [r.ref, r.c]));
  const videos = rows.map((r) => {
    const spec = parseJson<any>(r.video_json, {});
    const qc = parseJson<any>(r.qc_json, {}).video;
    return {
      id: r.id,
      account: r.account_id,
      hook: r.hook,
      format: spec.format,
      formatLabel: VIDEO_FORMATS[spec.format as keyof typeof VIDEO_FORMATS]?.label ?? spec.format,
      duration: r.duration_s ? Math.round(r.duration_s * 10) / 10 : null,
      voice: spec.production?.voice?.voice ?? (spec.voice?.mode === 'voix' ? 'à générer' : 'sans voix'),
      music: spec.music ? `${MUSIC_CATEGORIES[spec.music.mood as keyof typeof MUSIC_CATEGORIES]?.label ?? spec.music.mood}` : '—',
      status: VSTATUS(r.status, byId.get(r.id)),
      qc: qc ? {ok: qc.ok, score: qc.score, errors: qc.errors.length, warnings: qc.warnings.length} : null,
      video: r.vpath && exists(path.join(PATHS.var, r.vpath)) ? mediaUrl(path.join(PATHS.var, r.vpath)) : null,
      poster: r.poster_path && exists(path.join(PATHS.var, r.poster_path)) ? mediaUrl(path.join(PATHS.var, r.poster_path)) : null,
      costEur: costs.get(r.id) ?? 0,
      perf: perf.get(r.id) ?? null,
      createdAt: r.created_at,
    };
  });
  const count = (f: (v: any) => boolean) => videos.filter(f).length;
  return {
    counts: {
      generees: videos.length,
      en_cours: jobs.length,
      terminees: count((v) => !!v.video && v.qc?.ok),
      a_verifier: count((v) => v.status === 'awaiting_approval'),
      programmees: count((v) => v.status === 'scheduled'),
      publiees: count((v) => v.status === 'published'),
      echouees: count((v) => v.status === 'qc_failed' || v.status === 'failed') + db.get<any>("SELECT COUNT(*) AS n FROM video_jobs WHERE status = 'failed'")!.n,
    },
    videos,
    jobs: jobs.map((j) => ({...j, params: parseJson(j.params_json, {}), log: parseJson<string[]>(j.log_json, []).slice(-4)})),
    batches: db.all('SELECT id, account_id, quantity, done, failed, status, budget_eur, spent_eur, created_at FROM video_batches ORDER BY created_at DESC LIMIT 10'),
    costs: providerCosts(db),
    formats: Object.values(VIDEO_FORMATS).map((f) => ({id: f.id, label: f.label, durations: f.durations})),
    aiVideo: aiVideoProviders().map((p) => ({id: p.id, label: p.label, configured: p.configured})),
    accounts: listAccounts(db).filter((a) => videoSettings(a).enabled).map((a) => ({id: a.id, label: `${a.platform} @${a.handle}`})),
  };
}

export function videoDetail(db: Db, id: string) {
  const r = db.get('SELECT * FROM slideshows WHERE id = ?', id);
  if (!r) return null;
  const spec = parseJson<any>(r.video_json, {});
  const files = db.all('SELECT * FROM videos WHERE slideshow_id = ? ORDER BY aspect', id).map((v) => ({aspect: v.aspect, duration: v.duration_s, mo: Math.round(v.bytes / 1e5) / 10, url: exists(path.join(PATHS.var, v.path)) ? mediaUrl(path.join(PATHS.var, v.path)) : null, poster: v.poster_path ? mediaUrl(path.join(PATHS.var, v.poster_path)) : null, srt: v.subtitles_path ? mediaUrl(path.join(PATHS.var, v.subtitles_path)) : null, qc: parseJson(v.qc_json, null)}));
  const assets = db.all('SELECT a.kind, a.provider, a.license, a.author, a.source_url, a.commercial_ok, sa.role FROM slideshow_assets sa JOIN media_assets a ON a.id = sa.asset_id WHERE sa.slideshow_id = ? ORDER BY sa.role', id);
  return {id, account: r.account_id, status: r.status, hook: r.hook, caption: r.caption, spec: {format: spec.format, duration: spec.duration, aspect: spec.aspect, voice: spec.voice, music: spec.music, audio: spec.audio, captions: spec.captions, notes: spec.production?.notes ?? [], steps: spec.production?.steps ?? {}}, script: (spec.script?.scenes ?? []).map((s: any) => ({role: s.role, narration: s.narration, title: s.text?.title})), files, assets, costs: db.all('SELECT provider, kind, ok, cost_eur, units, unit, at, error FROM provider_calls WHERE ref = ? ORDER BY at', id)};
}

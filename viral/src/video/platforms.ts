import type {Db} from '../core/db.js';
import type {AppConfig, VideoProfile} from '../core/config.js';
import {getAccount, videoSettings, type Account} from '../core/accounts.js';
import {truncate} from '../core/text.js';
import {nowIso, parseJson} from '../core/util.js';
import {assetsOf} from './media.js';
import type {VideoScript, VideoSpec} from './types.js';

/**
 * Publication profiles (TikTok, Instagram Reels, YouTube Shorts, Threads) and per-platform adaptation:
 * each video gets its own description, title, hashtags, cover and end card for the network it goes to.
 * The same video is never pushed as is to another account: an adapted copy is made (new end card, new
 * caption, the target account's identity), after a rights check on every media it uses.
 */

const PLATFORM_PROFILE: Record<string, string> = {tiktok: 'tiktok', instagram: 'reels', youtube: 'shorts', threads: 'threads'};

export function profileFor(cfg: AppConfig, account: Account): VideoProfile {
  const id = videoSettings(account).profile ?? PLATFORM_PROFILE[account.platform] ?? 'tiktok';
  const p = cfg.platforms.videoProfiles[id];
  if (!p) throw new Error(`Profil de publication vidéo inconnu : ${id}`);
  return p;
}

export function profileId(cfg: AppConfig, account: Account): string {
  return videoSettings(account).profile ?? PLATFORM_PROFILE[account.platform] ?? 'tiktok';
}

const LINK_LINE: Record<string, string> = {
  bio: 'Lien en bio pour découvrir Systeme.io.',
  chaîne: 'Lien sur ma chaîne pour découvrir Systeme.io.',
};

/** Description of a video for one network: disclosure first, hook, key points, call to action, hashtags. */
export function videoCaption(cfg: AppConfig, account: Account, script: VideoScript, profile: VideoProfile): string {
  const points = script.scenes
    .filter((s) => s.role === 'point' || s.role === 'compare')
    .map((s) => s.text.title ?? s.text.right ?? '')
    .filter(Boolean)
    .slice(0, 4)
    .map((t) => `→ ${t}`);
  const engagement = script.scenes.find((s) => s.role === 'cta')?.text.body;
  const tags = script.hashtags.slice(0, profile.hashtags[1]).join(' ');
  const link = LINK_LINE[profile.linkHint] ?? LINK_LINE.bio;
  const build = (k: number) =>
    [cfg.compliance.disclosure.captionPrefix, '', script.hook, ...(k ? ['', ...points.slice(0, k)] : []), '', ...(engagement ? [engagement] : []), link, ...(tags ? ['', tags] : [])]
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  for (let k = points.length; k >= 0; k--) {
    const c = build(k);
    if (c.length <= profile.captionMax) return c;
  }
  return truncate(`${cfg.compliance.disclosure.captionPrefix}\n\n${script.hook}\n\n${link}`, profile.captionMax);
}

/** YouTube title (100 characters): the disclosure is in the first thing a viewer reads (studio rule). */
export function youtubeTitle(script: VideoScript, max = 100): string {
  return truncate(`Publicité · ${script.hook.replace(/#[\p{L}\p{N}_]+/gu, '').trim()}`, max);
}

/** Every media of a video may be used commercially on the target network (licence recorded and positive). */
export function rightsCheck(db: Db, slideshowId: string): {ok: boolean; problems: string[]; credits: string[]} {
  const problems: string[] = [];
  const credits: string[] = [];
  for (const a of assetsOf(db, slideshowId)) {
    if (!a.commercial_ok) problems.push(`${a.role} (${a.provider}) : usage commercial non autorisé par « ${a.license} »`);
    if (!a.license) problems.push(`${a.role} (${a.provider}) : licence non enregistrée`);
    if (a.attribution) credits.push(a.attribution);
  }
  return {ok: problems.length === 0, problems, credits: [...new Set(credits)]};
}

/**
 * Adapted copy of a finished video for another account (other network or other identity). The copy has its own
 * end card and caption; it is re-voiced when the spoken call to action changes, then rendered and checked again.
 */
export function adaptProject(db: Db, cfg: AppConfig, sourceId: string, targetAccountId: string): {id: string; revoice: boolean} {
  const src = db.get('SELECT * FROM slideshows WHERE id = ?', sourceId);
  if (!src || src.kind !== 'video') throw new Error(`Vidéo inconnue : ${sourceId}`);
  const rights = rightsCheck(db, sourceId);
  if (!rights.ok) throw new Error(`Adaptation refusée, droits insuffisants : ${rights.problems.join(' ; ')}`);
  const target = getAccount(db, targetAccountId);
  if (target.id === src.account_id) throw new Error('Même compte : utilisez une nouvelle vidéo, pas une copie.');
  const spec = parseJson<VideoSpec>(src.video_json, null as any);
  const profile = profileFor(cfg, target);
  const copy: VideoSpec = JSON.parse(JSON.stringify(spec));
  const cta = copy.script.scenes.find((s) => s.role === 'cta');
  const oldCta = cta?.text.title;
  if (cta) {
    cta.text.title = profile.cta;
    cta.narration = cta.narration.replace(oldCta ?? '', profile.cta);
  }
  copy.script.cta = profile.cta;
  copy.profile = profileId(cfg, target);
  const revoice = oldCta !== profile.cta || videoSettings(target).voice.id !== spec.voice.id;
  copy.production = {steps: {}, notes: [`Adaptation de ${sourceId} pour ${target.platform} @${target.handle}`], ...(revoice ? {} : {voice: spec.production?.voice}), visuals: spec.production?.visuals};
  const caption = videoCaption(cfg, target, copy.script, profile);
  const id = `ss_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const now = nowIso();
  db.upsert('slideshows', {
    ...Object.fromEntries(Object.entries(src).filter(([k]) => !['id', 'created_at', 'updated_at'].includes(k))),
    id,
    account_id: target.id,
    platform: target.platform,
    caption,
    status: 'draft',
    qc_json: null,
    qc_score: null,
    approved_by: null,
    approved_at: null,
    render_dir: null,
    export_path: null,
    parent_id: sourceId,
    video_json: JSON.stringify(copy),
    created_at: now,
    updated_at: now,
  });
  for (const a of db.all("SELECT asset_id, role FROM slideshow_assets WHERE slideshow_id = ? AND role != 'voix'", sourceId)) db.upsert('slideshow_assets', {slideshow_id: id, asset_id: a.asset_id, role: a.role}, ['slideshow_id', 'asset_id', 'role']);
  if (!revoice && spec.production?.voice) db.upsert('slideshow_assets', {slideshow_id: id, asset_id: spec.production.voice.assetId, role: 'voix'}, ['slideshow_id', 'asset_id', 'role']);
  return {id, revoice};
}

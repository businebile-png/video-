import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import type {Db} from '../core/db.js';
import type {AppConfig} from '../core/config.js';
import {PATHS} from '../core/paths.js';
import {jaccard, shingles} from '../core/text.js';
import {nowIso, parseJson} from '../core/util.js';
import {runQc} from '../qc/qc.js';
import {findForbidden} from '../qc/rules.js';
import {spellCheck} from '../qc/spell.js';
import {loadSpec} from './produce.js';
import {hasCredit, profileFor, rightsCheck} from './platforms.js';
import {ffprobe} from './render.js';
import {spokenTokens} from './voice.js';
import type {Caption} from './timeline.js';

/**
 * A video is finished only when every check below passes on the real file: container and codecs, duration,
 * frame size, captions, audio / caption sync, loudness, picture (no black or frozen stretch), media rights,
 * script (the carousel content checks + the narration), and duplicates (text and pictures).
 * Errors keep the video out of the publication queue; warnings go to the human reviewer.
 */

export const VIDEO_CHECKS = ['fichier', 'duree', 'format', 'sous-titres', 'synchro', 'son', 'image', 'droits', 'script', 'doublons', 'mention'] as const;
type Check = (typeof VIDEO_CHECKS)[number];

export interface VideoQcReport {
  ok: boolean;
  score: number;
  checks: Record<Check, 'ok' | 'avertissement' | 'échec' | 'non vérifié'>;
  errors: Array<{check: Check; message: string}>;
  warnings: Array<{check: Check; message: string}>;
  measures: Record<string, number | string | null>;
  at: string;
}

/** Top-level MP4 boxes: « faststart » means the index (moov) comes before the media data (mdat). */
export function moovBeforeMdat(file: string): boolean {
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(8);
    let pos = 0;
    const size = fs.fstatSync(fd).size;
    while (pos + 8 <= size) {
      fs.readSync(fd, head, 0, 8, pos);
      let len = head.readUInt32BE(0);
      const type = head.toString('ascii', 4, 8);
      if (type === 'moov') return true;
      if (type === 'mdat') return false;
      if (len === 1) {
        const big = Buffer.alloc(8);
        fs.readSync(fd, big, 0, 8, pos + 8);
        len = Number(big.readBigUInt64BE(0));
      }
      if (len < 8) return false;
      pos += len;
    }
    return false;
  } finally {
    fs.closeSync(fd);
  }
}

/** 64-bit difference hash of the frame at `t` (9×8 grey pixels from FFmpeg). */
export function frameHash(file: string, t: number): string | null {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-ss', t.toFixed(2), '-i', file, '-frames:v', '1', '-vf', 'scale=9:8:flags=area,format=gray', '-f', 'rawvideo', '-'], {maxBuffer: 1 << 20});
  if (r.status !== 0 || !r.stdout || r.stdout.length < 72) return null;
  let bits = '';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += r.stdout[y * 9 + x] > r.stdout[y * 9 + x + 1] ? '1' : '0';
  return BigInt('0b' + bits).toString(16).padStart(16, '0');
}

export function hamming(a: string, b: string): number {
  let x = BigInt('0x' + a) ^ BigInt('0x' + b);
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

function detect(file: string, filter: string, re: RegExp): Array<Record<string, number>> {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, ...filter.split(' '), '-f', 'null', '-'], {encoding: 'utf8', maxBuffer: 64 << 20});
  const out: Array<Record<string, number>> = [];
  for (const line of (r.stderr ?? '').split('\n')) {
    const m = re.exec(line);
    if (m?.groups) out.push(Object.fromEntries(Object.entries(m.groups).map(([k, v]) => [k, Number(v)])));
  }
  return out;
}

export function runVideoQc(db: Db, cfg: AppConfig, id: string, aspect?: string): VideoQcReport {
  const {row, spec, account} = loadSpec(db, id);
  const vid = db.get('SELECT * FROM videos WHERE slideshow_id = ? AND aspect = ?', id, aspect ?? spec.aspect);
  const checks = Object.fromEntries(VIDEO_CHECKS.map((c) => [c, 'ok'])) as VideoQcReport['checks'];
  const errors: VideoQcReport['errors'] = [];
  const warnings: VideoQcReport['warnings'] = [];
  const measures: VideoQcReport['measures'] = {};
  const err = (c: Check, m: string) => {
    errors.push({check: c, message: m});
    checks[c] = 'échec';
  };
  const warn = (c: Check, m: string) => {
    warnings.push({check: c, message: m});
    if (checks[c] === 'ok') checks[c] = 'avertissement';
  };
  const profile = profileFor(cfg, account);
  const file = vid ? path.join(PATHS.var, vid.path) : '';
  if (!vid || !fs.existsSync(file)) {
    err('fichier', 'aucun fichier MP4 : la vidéo n’a pas été montée');
    for (const c of VIDEO_CHECKS) if (checks[c] === 'ok') checks[c] = 'non vérifié';
    return finish();
  }
  // File and format.
  let probe: any;
  try {
    probe = ffprobe(file);
  } catch (e) {
    err('fichier', `MP4 illisible : ${(e as Error).message}`);
    return finish();
  }
  const v = probe.streams.find((s: any) => s.codec_type === 'video');
  const a = probe.streams.find((s: any) => s.codec_type === 'audio');
  const duration = Number(probe.format.duration);
  measures.duree = Math.round(duration * 10) / 10;
  measures.taille_mo = Math.round(Number(probe.format.size) / 1e5) / 10;
  if (!/mp4/.test(probe.format.format_name)) err('fichier', `conteneur ${probe.format.format_name} au lieu de MP4`);
  if (!v || v.codec_name !== 'h264') err('fichier', `vidéo ${v?.codec_name ?? 'absente'} au lieu de H.264`);
  if (v && v.pix_fmt !== 'yuv420p') err('fichier', `pixels ${v.pix_fmt} au lieu de yuv420p (lecture mobile)`);
  if (!a || a.codec_name !== 'aac') err('fichier', `son ${a?.codec_name ?? 'absent'} au lieu d’AAC`);
  if (!moovBeforeMdat(file)) warn('fichier', 'index MP4 en fin de fichier (lecture en ligne plus lente)');
  if (Number(probe.format.size) > 500e6) err('fichier', 'fichier de plus de 500 Mo');
  const size = cfg.platforms.videoSizes[vid.aspect];
  if (v && (v.width !== size.width || v.height !== size.height)) err('format', `${v.width}×${v.height} au lieu de ${size.width}×${size.height}`);
  const [fn, fd] = String(v?.avg_frame_rate || '0/1').split('/').map(Number);
  const fps = fd ? fn / fd : 0;
  measures.ips = Math.round(fps * 100) / 100;
  if (fps < 23.9 || fps > 60.1) err('format', `${fps} images par seconde`);
  // Duration.
  if (duration < profile.minDuration || duration > profile.maxDuration) err('duree', `${duration.toFixed(1)} s hors des limites ${profile.label} (${profile.minDuration} à ${profile.maxDuration} s)`);
  if (Math.abs(duration - spec.duration) > spec.duration * 0.4) warn('duree', `${duration.toFixed(1)} s pour ${spec.duration} s demandées (le script vérifié ne permet pas plus)`);
  // Captions and sync (voiced formats).
  const prod = spec.production ?? {steps: {}, notes: []};
  const tlFile = path.join(PATHS.var, path.dirname(vid.path), `timeline${vid.aspect === spec.aspect ? '' : '-' + vid.aspect.replace(':', 'x')}.json`);
  const tl = fs.existsSync(tlFile) ? JSON.parse(fs.readFileSync(tlFile, 'utf8')) : null;
  if (spec.voice.mode === 'voix' && prod.voice) {
    const caps: Caption[] = tl?.captions ?? [];
    const capWords = caps.flatMap((c) => c.words.map((w) => w.text));
    const said = spokenTokens(spec.script.scenes.map((s) => s.narration).join(' '));
    const shown = spokenTokens(capWords.join(' '));
    const coverage = said.length ? shown.length / said.length : 1;
    measures.sous_titres_couverture = Math.round(coverage * 100);
    if (!caps.length) err('sous-titres', 'aucun sous-titre');
    else if (coverage < 0.95) err('sous-titres', `${Math.round(coverage * 100)} % des mots dits sont sous-titrés`);
    const long = caps.filter((c) => c.words.map((w) => w.text).join(' ').length > 34);
    if (long.length) warn('sous-titres', `${long.length} lignes de sous-titres longues`);
    const short = caps.filter((c) => c.end - c.start < 0.25);
    if (short.length > 2) warn('sous-titres', `${short.length} sous-titres affichés moins de 0,25 s`);
    if (vid.subtitles_path && !fs.existsSync(path.join(PATHS.var, vid.subtitles_path))) warn('sous-titres', 'fichier SRT manquant');
    measures.ecart_voix_script = Math.round(prod.voice.mismatch * 100);
    if (prod.voice.mismatch > 0.3) err('synchro', `la voix ne dit pas le script (${Math.round(prod.voice.mismatch * 100)} % de mots différents à la réécoute)`);
    else if (prod.voice.mismatch > 0.12) warn('synchro', `réécoute : ${Math.round(prod.voice.mismatch * 100)} % de mots entendus différemment (souvent des chiffres ou la marque)`);
    const lastWord = (tl?.voiceOffset ?? 0) + prod.voice.seconds;
    if (lastWord > duration + 0.05) err('synchro', 'la narration dépasse la fin de la vidéo');
    if (caps.length && caps[caps.length - 1].end > duration + 0.05) err('synchro', 'un sous-titre dépasse la fin de la vidéo');
    const audioDur = Number(a?.duration ?? duration);
    if (Math.abs(audioDur - Number(v?.duration ?? duration)) > 0.25) err('synchro', `son ${audioDur.toFixed(2)} s, image ${Number(v?.duration).toFixed(2)} s`);
    const silences = detect(file, '-map 0:a -af silencedetect=n=-42dB:d=1.6', /silence_end: (?<end>[\d.]+) \| silence_duration: (?<dur>[\d.]+)/).filter((s) => s.end < lastWord - 0.2);
    if (silences.length) warn('son', `${silences.length} silence(s) de plus de 1,6 s pendant la narration`);
  } else {
    checks['sous-titres'] = 'non vérifié';
    if (spec.voice.mode !== 'voix') checks.synchro = 'non vérifié';
  }
  // Loudness.
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-map', '0:a', '-af', 'ebur128=peak=true', '-f', 'null', '-'], {encoding: 'utf8', maxBuffer: 64 << 20});
  const summary = (r.stderr ?? '').split('Summary:').pop() ?? '';
  const lufs = Number(/I:\s+(-?[\d.]+) LUFS/.exec(summary)?.[1]);
  const peak = Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(summary)?.[1]);
  measures.lufs = lufs;
  measures.crete_dbfs = peak;
  if (!Number.isFinite(lufs) || lufs < -20) err('son', `son trop faible (${lufs} LUFS)`);
  else if (lufs > -10) err('son', `son trop fort (${lufs} LUFS)`);
  else if (Math.abs(lufs + 14) > 2.5) warn('son', `niveau ${lufs} LUFS (cible -14)`);
  if (peak > -0.3) warn('son', `crête à ${peak} dBFS`);
  // Picture: black or frozen stretches.
  const black = detect(file, '-map 0:v -vf blackdetect=d=0.4:pix_th=0.06', /black_start:(?<start>[\d.]+) black_end:(?<end>[\d.]+) black_duration:(?<dur>[\d.]+)/);
  if (black.length) err('image', `${black.length} passage(s) noir(s) (${black.map((b) => `${b.start.toFixed(1)} s`).join(', ')})`);
  const frozen = detect(file, '-map 0:v -vf freezedetect=n=0.0008:d=3', /freeze_duration: (?<dur>[\d.]+)/);
  if (frozen.length) warn('image', `${frozen.length} passage(s) figé(s) de plus de 3 s`);
  measures.noirs = black.length;
  measures.figes = frozen.length;
  // Rights.
  const rights = rightsCheck(db, id);
  if (!rights.ok) rights.problems.forEach((p) => err('droits', p));
  const assets = db.all('SELECT a.kind FROM slideshow_assets sa JOIN media_assets a ON a.id = sa.asset_id WHERE sa.slideshow_id = ?', id).map((x) => x.kind);
  if (spec.voice.mode === 'voix' && !assets.includes('voice')) err('droits', 'voix sans licence enregistrée');
  if (spec.music.mode !== 'aucune' && !assets.includes('music')) err('droits', 'musique sans licence enregistrée');
  (prod.visuals ?? []).forEach((vv, i) => {
    if (vv.kind !== 'motion' && !vv.assetId) err('droits', `plan ${i + 1} sans licence enregistrée`);
  });
  measures.credits = rights.credits.join(' · ') || null;
  if (rights.credits.length && !hasCredit(String(row.caption ?? ''))) err('droits', 'crédit obligatoire (CC BY 4.0) absent de la description');
  // Script: content checks of the carousel engine + the narration itself.
  const content = runQc(db, cfg, id);
  for (const e of content.errors) err('script', `${e.where} : ${e.message}`);
  for (const w of content.warnings) (w.check === 'doublons' ? warn('doublons', `${w.where} : ${w.message}`) : warn('script', `${w.where} : ${w.message}`));
  const narration = spec.script.scenes.map((s) => s.narration).join(' ');
  for (const f of findForbidden(narration)) err('script', `narration : ${f.message}`);
  const spell = spellCheck(narration);
  if (spell.length) warn('script', `orthographe à relire dans la narration : ${spell.slice(0, 5).map((s) => s.word).join(', ')}`);
  for (const n of prod.notes ?? []) if (/repli|sans voix|aucune voix|plus courte/i.test(n)) warn('script', n);
  // Duplicates: other videos of the same account (narration and pictures).
  const hashes = [0.15, 0.35, 0.55, 0.75, 0.92].map((k) => frameHash(file, duration * k)).filter(Boolean) as string[];
  db.run('UPDATE videos SET frame_hashes = ? WHERE id = ?', JSON.stringify(hashes), vid.id);
  const mine = shingles(narration || spec.script.scenes.map((s) => s.text.title ?? '').join(' '), 4);
  const others = db.all(
    "SELECT s.id, s.video_json, s.created_at, v.frame_hashes FROM slideshows s LEFT JOIN videos v ON v.slideshow_id = s.id AND v.aspect = ? WHERE s.kind = 'video' AND s.account_id = ? AND s.id != ? AND s.status NOT IN ('rejected', 'qc_failed')",
    vid.aspect,
    account.id,
    id,
  );
  for (const o of others) {
    const os = parseJson<any>(o.video_json, null);
    if (!os) continue;
    const sim = jaccard(mine, shingles(os.script.scenes.map((s: any) => s.narration || s.text?.title || '').join(' '), 4));
    if (sim >= 0.6 && o.created_at <= row.created_at) err('doublons', `narration identique à ${Math.round(sim * 100)} % à la vidéo ${o.id} du même compte`);
    const oh = parseJson<string[]>(o.frame_hashes, []);
    if (oh.length === hashes.length && hashes.length) {
      const d = hashes.reduce((acc, h, k) => acc + hamming(h, oh[k]), 0) / hashes.length;
      if (d < 5) warn('doublons', `images très proches de la vidéo ${o.id} (écart ${d.toFixed(1)} / 64)`);
    }
  }
  // Disclosure: on screen for the whole video (built into the page) and first in the description.
  const html = fs.existsSync(file.replace(/video([^/]*)\.mp4$/, 'video$1.html')) ? fs.readFileSync(file.replace(/video([^/]*)\.mp4$/, 'video$1.html'), 'utf8') : '';
  if (!html.includes(`class="badge">${cfg.compliance.disclosure.badge}<`)) err('mention', 'mention « Publicité » absente de l’image');
  if (!String(row.caption ?? '').startsWith(cfg.compliance.disclosure.captionPrefix)) err('mention', 'la description ne commence pas par « Publicité »');
  return finish();

  function finish(): VideoQcReport {
    const score = Math.max(0, 100 - errors.length * 20 - warnings.length * 4);
    const report: VideoQcReport = {ok: errors.length === 0, score, checks, errors, warnings, measures, at: nowIso()};
    if (vid) db.run('UPDATE videos SET qc_status = ?, qc_json = ? WHERE id = ?', report.ok ? 'ok' : 'failed', JSON.stringify(report), vid.id);
    const next = !report.ok ? 'qc_failed' : account.settings.requireApproval ? 'awaiting_approval' : 'approved';
    const keep = ['scheduled', 'published', 'publishing', 'rejected'].includes(row.status);
    const prev = parseJson<any>(row.qc_json, {});
    db.run('UPDATE slideshows SET qc_json = ?, qc_score = ?, status = ?, updated_at = ? WHERE id = ?', JSON.stringify({...prev, video: report}), score, keep && report.ok ? row.status : next, nowIso(), id);
    return report;
  }
}

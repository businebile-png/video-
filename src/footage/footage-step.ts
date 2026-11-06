import fsp from 'node:fs/promises';
import path from 'node:path';
import {runPaths} from '../core/paths.js';
import {exists, readJson, readJsonIfExists, readValidated, writeJson} from '../core/fsx.js';
import {downloadTo} from '../core/http.js';
import {ffmpeg, ffprobe, displayDims, parseRate} from '../core/exec.js';
import {log} from '../core/log.js';
import {loadFootageUsage, recordFootageUsage} from '../core/stores.js';
import {daysBetween} from '../core/time.js';
import {ScriptSchema, type Script} from '../schemas/script.js';
import type {StudioConfig} from '../schemas/config.js';
import type {VoiceWord} from '../schemas/records.js';
import {artDirection} from '../edit/art-directions.js';
import {sceneSpans, targetShotSec, type PreparedClip} from '../edit/timeline.js';
import type {Plan} from '../editorial/plan.js';
import type {PexelsSearch, PexelsVideo, PexelsVideoFile} from './pexels.js';
import {searchStock, STOCK_LICENSES, type StockProvider} from './stock.js';

export interface Candidate {
  pexelsId: number;
  sceneId: string;
  query: string;
  rank: number;
  pageUrl: string;
  image: string;
  pictures: string[];
  durationSec: number;
  author: string;
  authorUrl: string;
  portrait: boolean;
  file: {link: string; width: number; height: number; fps: number; quality: string | null};
  score: number;
  reasons: string[];
}

export interface CandidatesFile {
  runId: string;
  createdAt: string;
  /** Library the candidates come from (absent in files written before Pixabay support: Pexels). */
  provider?: StockProvider;
  needs: Record<string, number>;
  scenes: Record<string, Candidate[]>;
}

export interface SelectionFile {
  by: 'agent' | 'auto' | 'human';
  notes?: string;
  scenes: Record<string, number[]>;
}

export interface LicenseRecord {
  /** Clip id in its library (the field name predates Pixabay support). */
  pexelsId: number;
  source?: string;
  pageUrl: string;
  author: string;
  authorUrl: string;
  fileUrl: string;
  license: string;
  licenseUrl: string;
  downloadedAt: string;
}

/** Best downloadable rendition: portrait ≥ 1080 px wide (or 4K landscape to crop), smallest that suffices. */
export function pickFile(v: PexelsVideo, cfg: StudioConfig['footage']): PexelsVideoFile | null {
  const mp4 = v.video_files.filter((f) => f.file_type === 'video/mp4' && f.width && f.height);
  const portrait = mp4.filter((f) => f.height! > f.width! && f.width! >= cfg.minShortSide);
  if (portrait.length) {
    portrait.sort((a, b) => a.width! - b.width!);
    return portrait.find((f) => f.width! >= 1080 && f.width! <= 1600) ?? portrait[0]!;
  }
  if (cfg.allowLandscapeCrop) {
    const land = mp4.filter((f) => f.width! >= f.height! && f.height! >= 2160).sort((a, b) => a.height! - b.height!);
    if (land.length) return land[0]!;
  }
  return null;
}

export function scoreCandidate(
  v: PexelsVideo,
  file: PexelsVideoFile,
  rank: number,
  perQuery: number,
  ctx: {usage: Record<string, string>; today: string; cooldownDays: number; neededSec: number},
): {score: number; reasons: string[]} | null {
  const reasons: string[] = [];
  const lastUse = ctx.usage[String(v.id)];
  if (lastUse && daysBetween(lastUse, ctx.today) < ctx.cooldownDays) return null;
  if (v.duration < ctx.neededSec) return null;
  let score = 0;
  const portrait = file.height! > file.width!;
  if (portrait) {
    score += 30;
    reasons.push('vertical natif');
  } else reasons.push('paysage 4K recadré');
  if (Math.min(file.width!, file.height!) >= 2160 || (portrait && file.height! >= 2560)) {
    score += 6;
    reasons.push('marge de recadrage');
  }
  score += 20 * (1 - rank / Math.max(1, perQuery));
  if (v.duration >= 6 && v.duration <= 40) score += 10;
  else if (v.duration > 40 && v.duration <= 90) score += 5;
  const fps = file.fps ?? 0;
  if (fps >= 23 && fps <= 31) score += 5;
  else if (fps >= 47) {
    score += 4;
    reasons.push('haute cadence');
  }
  if (lastUse) {
    score -= 6;
    reasons.push(`déjà utilisée le ${lastUse}`);
  }
  return {score: Math.round(score * 10) / 10, reasons};
}

/** How many distinct clips each scene needs, from the real voice timings and the art direction's pacing. */
export function clipsNeeded(script: Script, words: VoiceWord[], plan: Plan): Record<string, number> {
  const ad = artDirection(plan.artDirection);
  const last = words.length ? words[words.length - 1]!.end : 30;
  const spans = sceneSpans(script, words, last + 0.2);
  const out: Record<string, number> = {};
  for (const span of spans) {
    const dur = span.endSec - span.startSec;
    const t = targetShotSec(ad.motion.pacing, span.scene.phase);
    const kind = span.scene.visual.kind;
    if (kind === 'demo') out[span.scene.id] = 1;
    else if (kind === 'graphic' || span.scene.phase === 'cta') out[span.scene.id] = Math.min(2, Math.max(1, Math.ceil(dur / (t * 1.6))));
    else out[span.scene.id] = Math.min(3, Math.max(1, Math.round(dur / t)));
  }
  return out;
}

export async function searchFootage(runId: string, config: StudioConfig): Promise<CandidatesFile> {
  const p = runPaths(runId);
  const script = await readValidated(p.script, ScriptSchema);
  const plan = await readJson<Plan>(p.plan);
  const words = await readJson<VoiceWord[]>(p.voiceWords);
  const needs = clipsNeeded(script, words, plan);
  const usage = await loadFootageUsage();
  const scenes: Record<string, Candidate[]> = {};
  const seen = new Set<number>();
  const cacheDir = path.join(p.footageDir, 'search');
  await fsp.mkdir(cacheDir, {recursive: true});
  for (const scene of script.scenes) {
    const queries = scene.visual.queries.slice(0, 3);
    if (queries.length === 0) continue;
    const neededSec = 2.5;
    const pool = new Map<number, Candidate>();
    for (const query of queries) {
      // Pixabay has no orientation filter: one search returns both kinds of clips.
      const orientations = config.footage.provider === 'pixabay' ? (['portrait'] as const) : (['portrait', 'landscape'] as const);
      for (const orientation of orientations) {
        if (orientation === 'landscape' && !config.footage.allowLandscapeCrop) continue;
        const cacheFile = path.join(cacheDir, `${config.footage.provider}-${encodeURIComponent(query)}-${orientation}.json`);
        const res = exists(cacheFile)
          ? await readJson<PexelsSearch>(cacheFile)
          : await searchStock(query, {orientation, perPage: config.footage.perQuery}, config);
        if (!exists(cacheFile)) await writeJson(cacheFile, res);
        res.videos.forEach((v, rank) => {
          if (seen.has(v.id) && !pool.has(v.id)) return;
          const file = pickFile(v, config.footage);
          if (!file) return;
          const scored = scoreCandidate(v, file, rank, config.footage.perQuery, {usage, today: plan.date, cooldownDays: config.footage.reuseCooldownDays, neededSec});
          if (!scored) return;
          const existing = pool.get(v.id);
          if (existing && existing.score >= scored.score) return;
          pool.set(v.id, {
            pexelsId: v.id,
            sceneId: scene.id,
            query,
            rank,
            pageUrl: v.url,
            image: v.image,
            pictures: v.video_pictures
              .filter((pic) => [0, 5, 10].includes(pic.nr))
              .map((pic) => pic.picture),
            durationSec: v.duration,
            author: v.user.name,
            authorUrl: v.user.url,
            portrait: file.height! > file.width!,
            file: {link: file.link, width: file.width!, height: file.height!, fps: file.fps ?? 0, quality: file.quality},
            score: scored.score,
            reasons: scored.reasons,
          });
        });
        if ([...pool.values()].filter((c) => c.portrait).length >= config.footage.candidatesPerScene * 2) break;
      }
    }
    const ranked = [...pool.values()].sort((a, b) => b.score - a.score).slice(0, config.footage.candidatesPerScene);
    ranked.forEach((c) => seen.add(c.pexelsId));
    scenes[scene.id] = ranked;
    if (ranked.length === 0) log.warn(`Scène ${scene.id} : aucune séquence exploitable pour ${queries.join(' | ')}`);
    else log.info(`Scène ${scene.id} : ${ranked.length} séquences candidates`);
  }
  const out: CandidatesFile = {runId, createdAt: new Date().toISOString(), provider: config.footage.provider, needs, scenes};
  await writeJson(p.footageCandidates, out);
  await buildContactSheets(runId, out);
  return out;
}

const LABEL_FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';

/** One image per scene with numbered candidate thumbnails, for a visual choice by the agent. */
export async function buildContactSheets(runId: string, file: CandidatesFile): Promise<string[]> {
  const p = runPaths(runId);
  const sheets: string[] = [];
  const thumbs = path.join(p.footageDir, 'thumbs');
  await fsp.mkdir(thumbs, {recursive: true});
  for (const [sceneId, cands] of Object.entries(file.scenes)) {
    if (cands.length === 0) continue;
    const tileDir = path.join(thumbs, sceneId);
    await fsp.rm(tileDir, {recursive: true, force: true});
    await fsp.mkdir(tileDir, {recursive: true});
    let n = 0;
    for (const c of cands) {
      const src = path.join(thumbs, `${c.pexelsId}.jpg`);
      try {
        if (!exists(src)) await downloadTo(c.image, src, {timeoutMs: 30_000, retries: 1});
        const label = `${n + 1}  #${c.pexelsId}  ${c.portrait ? 'V' : 'H'} ${Math.round(c.durationSec)}s`;
        const draw = exists(LABEL_FONT)
          ? `,drawbox=y=ih-56:w=iw:h=56:color=black@0.65:t=fill,drawtext=fontfile=${LABEL_FONT}:text='${label.replace(/[':]/g, ' ')}':x=12:y=h-42:fontsize=26:fontcolor=white`
          : '';
        await ffmpeg(['-i', src, '-vf', `scale=320:568:force_original_aspect_ratio=increase,crop=320:568${draw}`, '-frames:v', '1', path.join(tileDir, `tile${String(n).padStart(2, '0')}.jpg`)]);
        n++;
      } catch (err) {
        log.warn(`Miniature indisponible pour ${c.pexelsId} : ${(err as Error).message}`);
      }
    }
    if (n === 0) continue;
    const cols = Math.min(4, n);
    const rows = Math.ceil(n / cols);
    const out = path.join(p.footageDir, 'sheets', `${sceneId}.jpg`);
    await fsp.mkdir(path.dirname(out), {recursive: true});
    await ffmpeg(['-framerate', '1', '-i', path.join(tileDir, 'tile%02d.jpg'), '-vf', `tile=${cols}x${rows}:padding=6:color=0x111111`, '-frames:v', '1', out]);
    sheets.push(out);
  }
  return sheets;
}

/** Heuristic choice (used when no reviewer picked): best scores, varied authors. */
export function autoSelection(file: CandidatesFile): SelectionFile {
  const scenes: Record<string, number[]> = {};
  const used = new Set<number>();
  for (const [sceneId, cands] of Object.entries(file.scenes)) {
    const need = file.needs[sceneId] ?? 1;
    const authors = new Set<string>();
    const pick: number[] = [];
    for (const c of cands) {
      if (pick.length >= need) break;
      if (used.has(c.pexelsId) || authors.has(c.author)) continue;
      pick.push(c.pexelsId);
      authors.add(c.author);
      used.add(c.pexelsId);
    }
    for (const c of cands) {
      if (pick.length >= need) break;
      if (!used.has(c.pexelsId)) {
        pick.push(c.pexelsId);
        used.add(c.pexelsId);
      }
    }
    scenes[sceneId] = pick;
  }
  return {by: 'auto', scenes};
}

export async function fetchFootage(runId: string): Promise<Record<string, PreparedClip[]>> {
  const p = runPaths(runId);
  const cands = await readJson<CandidatesFile>(p.footageCandidates);
  const provider: StockProvider = cands.provider ?? 'pexels';
  const lib = STOCK_LICENSES[provider];
  if (!exists(p.footageSelection)) throw new Error('Aucune sélection de séquences : lancer footage:auto ou écrire footage/selection.json.');
  const selection = await readJson<SelectionFile>(p.footageSelection);
  const plan = await readJson<Plan>(p.plan);
  const byId = new Map<number, Candidate>();
  for (const list of Object.values(cands.scenes)) for (const c of list) byId.set(c.pexelsId, c);
  const licenses = await readJsonIfExists<LicenseRecord[]>(p.footageLicenses, []);
  const clips: Record<string, PreparedClip[]> = {};
  const srcDir = path.join(p.footageDir, 'src');
  await fsp.mkdir(srcDir, {recursive: true});
  for (const [sceneId, ids] of Object.entries(selection.scenes)) {
    clips[sceneId] = [];
    for (const id of ids) {
      const c = byId.get(id);
      if (!c) throw new Error(`Séquence ${id} absente des candidats de la scène ${sceneId}.`);
      const dest = path.join(srcDir, `${id}.mp4`);
      if (!exists(dest)) {
        log.info(`Téléchargement ${lib.name} #${id} (${c.file.width}×${c.file.height}) — ${c.author}`);
        await downloadTo(c.file.link, dest, {timeoutMs: 600_000, retries: 2});
      }
      const probe = await ffprobe(dest);
      const v = probe.streams.find((s) => s.codec_type === 'video');
      if (!v) throw new Error(`Fichier vidéo illisible : ${dest}`);
      const dims = displayDims(v);
      clips[sceneId]!.push({
        clipId: `${provider}-${id}`,
        pexelsId: id,
        file: path.relative(p.dir, dest),
        durationSec: Number(probe.format.duration ?? c.durationSec),
        width: dims.width,
        height: dims.height,
        fps: Math.round(parseRate(v.avg_frame_rate || v.r_frame_rate) * 100) / 100,
        author: c.author,
      });
      if (!licenses.some((l) => l.pexelsId === id)) {
        licenses.push({
          pexelsId: id,
          source: lib.name,
          pageUrl: c.pageUrl,
          author: c.author,
          authorUrl: c.authorUrl,
          fileUrl: c.file.link,
          license: lib.license,
          licenseUrl: lib.licenseUrl,
          downloadedAt: new Date().toISOString(),
        });
      }
    }
  }
  await writeJson(p.footageLicenses, licenses);
  await writeJson(path.join(p.footageDir, 'clips.json'), clips);
  await recordFootageUsage(
    Object.values(selection.scenes).flat(),
    plan.date,
  );
  return clips;
}

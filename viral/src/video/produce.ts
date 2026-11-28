import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {Db} from '../core/db.js';
import type {AppConfig} from '../core/config.js';
import {getAccount, videoSettings, type Account} from '../core/accounts.js';
import {PATHS, ensureDir} from '../core/paths.js';
import {nowIso, parseJson, rng, sha256} from '../core/util.js';
import {saveDraft} from '../generate/generate.js';
import type {SlideshowDraft} from '../generate/types.js';
import {resolvePalette} from '../render/html.js';
import {templateById} from '../render/templates.js';
import {drawCharacter, nameInText} from './characters.js';
import {formatDef} from './formats.js';
import {linkAsset, loadMedia, recordAsset} from './media.js';
import {MUSIC_CATEGORIES, composeMusic, musicCandidates, musicGrid} from './music.js';
import {pickTrack, trackPath} from './music-library.js';
import {choose} from '../analytics/learn.js';
import {buildVideoPage} from './page.js';
import {profileFor, videoCaption, withCredits} from './platforms.js';
import {loadConfig} from '../core/config.js';
const cfgFor = () => loadConfig();
import {extractFrames, extractStill, mixAudio, renderFrames, writeSubtitles} from './render.js';
import {scriptFromDraft} from './script.js';
import {downloadClip, pickClip, searchStock} from './stock.js';
import {buildTimeline} from './timeline.js';
import type {Aspect, AudioSettings, CaptionSettings, DurationTarget, MusicMood, SceneVisual, VideoFormatId, VideoSpec, VisualMode} from './types.js';
import {VoiceUnavailable, synthesize} from './voice.js';
import {envelope, readWav, writeWav} from './wav.js';
import {generateAiClip, aiVideoAvailable} from './aigen.js';

/**
 * Production steps of one video. Each step stores what it made in the content row (video_json), so a batch can
 * stop and resume anywhere, and a failed step can be retried alone.
 */

export interface ProjectOptions {
  format: VideoFormatId;
  duration: DurationTarget;
  aspect?: Aspect;
  voice?: string;
  gender?: 'female' | 'male';
  speed?: number;
  intonation?: 'neutre' | 'expressive' | 'calme';
  visuals?: VisualMode | 'auto';
  music?: 'original' | 'licence' | 'aucune';
  seed?: string;
}

export function loadSpec(db: Db, id: string): {row: any; spec: VideoSpec; account: Account} {
  const row = db.get('SELECT * FROM slideshows WHERE id = ?', id);
  if (!row) throw new Error(`Vidéo inconnue : ${id}`);
  const spec = parseJson<VideoSpec | null>(row.video_json, null);
  if (!spec) throw new Error(`${id} n’est pas une vidéo (pas de script vidéo)`);
  spec.production ??= {steps: {}, notes: []};
  return {row, spec, account: getAccount(db, row.account_id)};
}

export function saveSpec(db: Db, id: string, spec: VideoSpec, extra: Record<string, unknown> = {}): void {
  const sets = ['video_json = ?', 'updated_at = ?', ...Object.keys(extra).map((k) => `${k} = ?`)];
  db.run(`UPDATE slideshows SET ${sets.join(', ')} WHERE id = ?`, JSON.stringify(spec), nowIso(), ...Object.values(extra), id);
}

/** A video project from content (library / AI draft, or an existing carousel converted in place). */
export function createProject(db: Db, cfg: AppConfig, d: SlideshowDraft, opts: ProjectOptions, existingId?: string): string {
  const account = getAccount(db, d.accountId);
  const vs = videoSettings(account);
  const def = formatDef(opts.format);
  const profile = profileFor(cfg, account);
  const aspect = opts.aspect ?? (vs.aspects[0] as Aspect) ?? '9:16';
  const seed = opts.seed ?? `${d.hook}:${opts.format}:${Date.now()}`;
  const script = scriptFromDraft(d, {format: opts.format, duration: opts.duration, cta: profile.cta, linkHint: profile.linkHint, seed, visuals: opts.visuals && opts.visuals !== 'auto' ? opts.visuals : undefined});
  const voiceMode = def.voice;
  // Sound identity: the account's Audio Studio choices, or the machine's choice from the script (mode automatique).
  const audio: AudioSettings = {musicVolume: vs.audio.musicVolume, voiceVolume: vs.audio.voiceVolume, ducking: vs.audio.ducking, fadeIn: vs.audio.fadeIn, fadeOut: vs.audio.fadeOut, sfx: vs.audio.sfx, sfxVolume: vs.audio.sfxVolume, ambience: vs.audio.ambience, pitch: vs.audio.pitch};
  const captions: CaptionSettings = {...vs.captions, style: vs.captions.style === 'auto' ? def.captions : vs.captions.style} as CaptionSettings;
  if (def.voice !== 'voix') captions.style = 'kinetic';
  const text = script.scenes.map((x) => `${x.narration} ${x.text.title ?? ''}`).join(' ');
  const candidates = musicCandidates(opts.format, d.structure, `${d.hook} ${text}`, def.music);
  const fixedMood = !vs.audio.auto && vs.audio.musicCategory !== 'auto' && vs.audio.musicCategory in MUSIC_CATEGORIES ? (vs.audio.musicCategory as MusicMood) : null;
  const mood = fixedMood ?? (choose(db, {dimension: 'music', values: candidates, accountId: account.id, rand: rng(seed + ':music'), epsilon: 0.25}).value as MusicMood);
  const spec: VideoSpec = {
    format: opts.format,
    duration: opts.duration,
    aspect,
    profile: Object.entries(cfg.platforms.videoProfiles).find(([, p]) => p === profile)?.[0] ?? 'tiktok',
    voice: {mode: voiceMode, id: opts.voice ?? vs.voice.id, gender: opts.gender ?? vs.voice.gender, speed: (opts.speed ?? vs.voice.speed) * def.pace, intonation: opts.intonation ?? vs.voice.intonation, language: vs.voice.language, pitch: vs.audio.pitch},
    visuals: opts.visuals && opts.visuals !== 'auto' ? opts.visuals : vs.visuals !== 'auto' ? vs.visuals : def.visuals,
    music: {mode: opts.music ?? vs.music, mood, candidates},
    audio,
    captions,
    template: def.template,
    transitions: def.transitions,
    script,
    production: {steps: {}, notes: [...script.notes]},
  };
  const caption = videoCaption(cfg, account, script, profile);
  const size = cfg.platforms.videoSizes[aspect];
  const id = existingId ?? saveDraft(db, cfg, {...d, template: def.template, caption}, `video-${new Date().toISOString().slice(0, 10)}`);
  db.run(
    "UPDATE slideshows SET kind = 'video', video_json = ?, format = ?, width = ?, height = ?, template = ?, caption = ?, status = 'draft', qc_json = NULL, qc_score = NULL, updated_at = ? WHERE id = ?",
    JSON.stringify(spec),
    aspect,
    size.width,
    size.height,
    def.template,
    caption,
    nowIso(),
    id,
  );
  return id;
}

const workDir = (id: string) => ensureDir(path.join(PATHS.renders, id, 'video'));
const seedNum = (id: string, salt = '') => parseInt(sha256(id + salt).slice(0, 8), 16);

/** Step « voix » : narration of every scene, or an honest switch to the no-voice version when no voice works. */
export async function stepVoice(db: Db, id: string): Promise<string> {
  const {spec} = loadSpec(db, id);
  const prod = spec.production!;
  if (spec.voice.mode !== 'voix') return 'format sans voix';
  const parts = spec.script.scenes.map((s) => s.narration || s.text.title || '…');
  try {
    const v = await synthesize(db, {parts, voice: spec.voice.id, gender: spec.voice.gender, speed: spec.voice.speed, intonation: spec.voice.intonation, language: spec.voice.language, pitch: spec.voice.pitch ?? 0, seed: seedNum(id) % 100000, outDir: workDir(id), ref: id});
    prod.voice = v;
    linkAsset(db, id, v.assetId, 'voix');
    // The French voices come from recordings under CC BY 4.0: the credit goes in the description (studio practice).
    const credit = loadMedia().voices.find((x) => x.id === v.provider)?.credit;
    if (credit) {
      const {row, account} = loadSpec(db, id);
      db.run('UPDATE slideshows SET caption = ? WHERE id = ?', withCredits(row.caption ?? '', [credit], profileFor(cfgFor(), account).captionMax), id);
    }
    prod.notes.push(...v.warnings);
    if (v.mismatch > 0.2) prod.notes.push(`La voix s’écarte du script (${Math.round(v.mismatch * 100)} % de mots mal entendus) : à réécouter.`);
    prod.steps.voice = {at: nowIso(), note: `${v.voice}, ${v.seconds.toFixed(1)} s`};
    saveSpec(db, id, spec);
    return `${v.voice} (${v.seconds.toFixed(1)} s, écart ${Math.round(v.mismatch * 100)} %)`;
  } catch (e) {
    if (!(e instanceof VoiceUnavailable)) throw e;
    spec.voice.mode = 'aucune';
    prod.notes.push(`Version sans voix : ${(e as Error).message}`);
    prod.steps.voice = {at: nowIso(), note: 'aucune voix disponible'};
    saveSpec(db, id, spec);
    return 'aucune voix disponible : version sans voix';
  }
}

function estimatedSeconds(spec: VideoSpec): number {
  if (spec.production?.voice) return spec.production.voice.seconds + 2.2;
  return Math.max(12, spec.duration + 2);
}

/** Step « visuels » : licensed footage, stills or AI shots per scene; motion graphics when nothing suitable exists. */
export async function stepVisuals(db: Db, cfg: AppConfig, id: string): Promise<string> {
  const {spec, account} = loadSpec(db, id);
  const prod = spec.production!;
  const scenes = spec.script.scenes;
  const rand = rng(id + ':visuals');
  const recent = new Set(
    db
      .all(
        "SELECT a.provider || ':' || a.source_id AS k FROM slideshow_assets sa JOIN media_assets a ON a.id = sa.asset_id JOIN slideshows s ON s.id = sa.slideshow_id WHERE s.account_id = ? AND a.kind = 'stock-video' AND s.id != ? ORDER BY s.created_at DESC LIMIT 60",
        account.id,
        id,
      )
      .map((r) => r.k as string),
  );
  const used = new Set<string>();
  const out: SceneVisual[] = [];
  const perScene = estimatedSeconds(spec) / Math.max(1, scenes.length);
  let fallbacks = 0;
  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i];
    const mode = s.visual.mode;
    if (mode === 'motion' || !s.visual.query) {
      out.push({kind: 'motion'});
      continue;
    }
    if (mode === 'ai') {
      if (aiVideoAvailable()) {
        try {
          const clip = await generateAiClip(db, {prompt: s.visual.prompt ?? s.visual.query, seconds: Math.min(8, Math.ceil(perScene + 1)), aspect: spec.aspect, ref: id, outDir: workDir(id)});
          linkAsset(db, id, clip.assetId, `plan ${i + 1}`);
          out.push({kind: 'ai', assetId: clip.assetId, file: clip.file, offset: 0, vertical: spec.aspect === '9:16'});
          continue;
        } catch (e) {
          prod.notes.push(`Plan IA ${i + 1} non généré (${(e as Error).message}) : plan sous licence à la place.`);
        }
      } else if (i === 0) prod.notes.push('Séquences IA : aucun moteur vidéo IA configuré (clé absente) — plans sous licence à la place, rien n’est présenté comme généré par IA.');
    }
    try {
      const clips = await searchStock(db, s.visual.query, {ref: id});
      const noPeople = s.role === 'product' || s.role === 'cta' || s.role === 'proof';
      const avoid = new Set([...recent, ...used]);
      const clip = pickClip(clips, {minSeconds: perScene + 1, aspect: spec.aspect, noPeople, avoid, rand, query: s.visual.query}) ?? pickClip(clips, {minSeconds: 3, aspect: spec.aspect, noPeople, avoid: used, rand, query: s.visual.query});
      if (!clip) throw new Error(`aucun plan adapté pour « ${s.visual.query} »`);
      used.add(`${clip.provider}:${clip.id}`);
      const {file, assetId} = await downloadClip(db, clip, id);
      linkAsset(db, id, assetId, `plan ${i + 1}`);
      const offset = Math.max(0, Math.min(clip.duration - perScene - 1, rand() * Math.max(0, clip.duration - perScene - 1)));
      if (mode === 'images') {
        const still = path.join(workDir(id), `still-${i + 1}.jpg`);
        const size = cfg.platforms.videoSizes[spec.aspect];
        extractStill(file, offset + 0.5, still, size.width, size.height);
        out.push({kind: 'image', assetId, file: still, vertical: clip.height > clip.width, fallbackFrom: mode !== s.visual.mode ? s.visual.mode : undefined});
      } else out.push({kind: 'stock', assetId, file, offset, vertical: clip.height > clip.width, fallbackFrom: mode === 'ai' ? 'ai' : undefined});
    } catch (e) {
      fallbacks++;
      prod.notes.push(`Scène ${i + 1} en animation graphique (${(e as Error).message}).`);
      out.push({kind: 'motion', fallbackFrom: mode});
    }
  }
  prod.visuals = out;
  prod.steps.visuals = {at: nowIso(), note: `${out.filter((v) => v.kind !== 'motion').length} plans sous licence ou IA, ${fallbacks} replis`};
  saveSpec(db, id, spec);
  return prod.steps.visuals.note!;
}

/**
 * Step « musique » : a licensed track allowed on this network when the account asks for one, otherwise original
 * music in the chosen category. The beat grid is fixed now (the edit snaps its cuts to it); the original track is
 * composed again at the edit, with the real cut times, so drums come in after the hook and accents land on cuts.
 */
export function stepMusic(db: Db, id: string): string {
  const {spec, account} = loadSpec(db, id);
  const prod = spec.production!;
  if (spec.music.mode === 'aucune') {
    prod.steps.music = {at: nowIso(), note: 'sans musique'};
    saveSpec(db, id, spec);
    return 'sans musique';
  }
  const seconds = estimatedSeconds(spec) + 1.5;
  if (spec.music.mode === 'licence') {
    const t = pickTrack(spec.music.mood, account.platform, rng(id + ':track'));
    if (t) {
      const assetId = recordAsset(db, {kind: 'music', provider: 'licence', sourceId: t.id, file: trackPath(t), license: t.license, licenseUrl: t.licenseUrl, commercialOk: t.commercial, attribution: t.attribution, meta: {title: t.title, artist: t.artist, proof: t.proof, platforms: t.platforms}});
      linkAsset(db, id, assetId, 'musique');
      prod.musicFile = trackPath(t);
      prod.musicAssetId = assetId;
      prod.beats = [];
      spec.music.trackId = t.id;
      prod.steps.music = {at: nowIso(), note: `${t.title} — ${t.artist} (${t.license})`};
      saveSpec(db, id, spec);
      return prod.steps.music.note!;
    }
    prod.notes.push('Aucune piste sous licence autorisée sur ce réseau pour cette ambiance : musique originale à la place.');
    spec.music.mode = 'original';
  }
  const file = path.join(workDir(id), 'music.wav');
  const seed = seedNum(id, 'music');
  const grid = musicGrid(spec.music.mood, seed, seconds);
  const m = composeMusic(file, {mood: spec.music.mood, seconds, seed, fadeIn: spec.audio?.fadeIn, fadeOut: spec.audio?.fadeOut});
  const assetId = recordAsset(db, {kind: 'music', provider: 'viral-synth', sourceId: `${id}:music`, file, license: 'Création originale de la machine (synthèse note par note, aucun échantillon ni morceau tiers) : publiable sur tous les réseaux', commercialOk: true, meta: {mood: m.mood, category: MUSIC_CATEGORIES[m.mood].label, bpm: m.bpm, seconds, seed}});
  linkAsset(db, id, assetId, 'musique');
  prod.musicFile = file;
  prod.musicAssetId = assetId;
  prod.beats = grid.beats;
  prod.steps.music = {at: nowIso(), note: `${MUSIC_CATEGORIES[m.mood].label} (${m.mood}), ${m.bpm} BPM`};
  saveSpec(db, id, spec);
  return prod.steps.music.note!;
}

export interface RenderOutput {
  file: string;
  cover: string;
  srt?: string;
  duration: number;
  frames: number;
  ms: number;
  lufs: number;
  peak: number;
}

/** Step « montage » : timeline, page, footage frames, sound mix, frame-by-frame render, subtitles, cover. */
export async function stepRender(db: Db, cfg: AppConfig, id: string, opts: {fps?: number; workers?: number; draft?: boolean; aspect?: Aspect; onProgress?: (d: number, t: number) => void} = {}): Promise<RenderOutput> {
  const {row, spec, account} = loadSpec(db, id);
  const prod = spec.production!;
  const def = formatDef(spec.format);
  const aspect = opts.aspect ?? spec.aspect;
  const size = cfg.platforms.videoSizes[aspect];
  const fps = opts.fps ?? (opts.draft ? 24 : 30);
  const dir = workDir(id);
  const sub = aspect === spec.aspect ? '' : `-${aspect.replace(':', 'x')}`;
  const rand = rng(id + ':timeline');
  const voice = spec.voice.mode === 'voix' ? prod.voice : undefined;
  const audio = spec.audio ?? {musicVolume: 0.3, voiceVolume: 1, ducking: 'normal', fadeIn: 0.4, fadeOut: 1.6, sfx: true, sfxVolume: 1, ambience: true, pitch: 0};
  const captions = spec.captions ?? ({style: def.captions, color: '#FFFFFF', size: 1, position: 'bas', animation: 'pop', emphasis: true} as CaptionSettings);
  const tl = buildTimeline({scenes: spec.script.scenes, def, transitions: spec.transitions, voice, beats: prod.beats ?? [], fps, width: size.width, height: size.height, aspect, targetSeconds: spec.duration, rand, captionStyle: captions.style, mood: spec.music.mood, sfx: {enabled: audio.sfx, volume: audio.sfxVolume, ambience: audio.ambience}, format: spec.format});
  // Footage frames for the scenes that use licensed or AI clips.
  const framesRoot = path.join(dir, `frames${sub}`);
  fs.rmSync(framesRoot, {recursive: true, force: true});
  (prod.visuals ?? []).forEach((v, i) => {
    const sc = tl.scenes[i];
    if (!sc) return;
    if ((v.kind === 'stock' || v.kind === 'ai') && v.file && fs.existsSync(v.file)) {
      const inStart = i === 0 ? 0 : sc.start - 0.25;
      const outEnd = i < tl.scenes.length - 1 ? tl.scenes[i + 1].start + 0.25 : tl.duration;
      const framed = aspect === '9:16' ? !v.vertical : aspect === '16:9' ? !!v.vertical : false;
      const out = path.join(framesRoot, `s${i}`);
      const count = extractFrames(v.file, {offset: v.offset ?? 0, seconds: outEnd - inStart + 0.2, fps, width: size.width, height: size.height, framed, outDir: out});
      sc.media = {kind: v.kind, dir: 'file://' + out, count, fps, framed};
    } else if (v.kind === 'image' && v.file && fs.existsSync(v.file)) sc.media = {kind: 'image', image: 'file://' + v.file};
    else sc.media = {kind: 'motion'};
  });
  const tpl = templateById(spec.template ?? def.template);
  const palette = resolvePalette(tpl, account.brand);
  let character: {svg: string; name: string; mode: 'narrator' | 'story'} | undefined;
  if (def.character) {
    const story = spec.script.scenes.map((s) => `${s.text.title ?? ''} ${s.narration}`).join(' ');
    const known = nameInText(story);
    const c = drawCharacter(id, {gender: known?.gender ?? (def.character === 'narrator' ? spec.voice.gender : undefined), name: known?.name, shirt: palette.accent, accent: palette.accent2});
    character = {svg: c.svg, name: c.name, mode: def.character};
    const assetId = recordAsset(db, {kind: 'character', provider: 'viral-characters', sourceId: `${id}:${c.name}`, license: 'Dessin original généré par la machine (personnage fictif)', commercialOk: true, meta: {name: c.name, gender: c.gender}});
    linkAsset(db, id, assetId, 'personnage');
  }
  const total = Math.round(tl.duration * fps);
  const mouth = character && voice ? envelope(voice.file, fps, total, tl.voiceOffset) : undefined;
  const emphasis = [...new Set(spec.script.scenes.flatMap((x) => x.emphasis))];
  const html = buildVideoPage({timeline: tl, def, palette, fonts: tpl.fonts, safe: size.safe, disclosure: cfg.compliance.disclosure.badge, handle: account.brand.handle, character, mouth, seed: seedNum(id, 'page'), captions, emphasis});
  const htmlFile = path.join(dir, `video${sub}.html`);
  fs.writeFileSync(htmlFile, html);
  // Sound.
  const audioFile = path.join(dir, `audio${sub}.wav`);
  let music = spec.music.mode !== 'aucune' && prod.musicFile && fs.existsSync(prod.musicFile) ? prod.musicFile : undefined;
  if (music && spec.music.mode === 'original') {
    // Original music composed on the real cuts: drums after the hook, an accent on each cut, outro under the call to action.
    const cuts = tl.scenes.slice(1).map((x) => x.start);
    const cta = tl.scenes.find((x) => x.role === 'cta');
    const file = path.join(dir, `music${sub}.wav`);
    composeMusic(file, {mood: spec.music.mood, seconds: tl.duration + 0.4, seed: seedNum(id, 'music'), cues: {drop: tl.scenes[1]?.start ?? 2, cuts: cuts.filter((c) => c !== cta?.start), outro: cta?.start}, fadeIn: audio.fadeIn, fadeOut: audio.fadeOut});
    music = file;
  }
  const {lufs, peak} = mixAudio({out: audioFile, duration: tl.duration, voice: voice?.file, voiceOffset: tl.voiceOffset, music, musicFades: spec.music.mode === 'licence' ? {in: audio.fadeIn, out: audio.fadeOut} : undefined, sfx: tl.sfx, musicVolume: audio.musicVolume, voiceVolume: audio.voiceVolume, ducking: audio.ducking});
  // Pictures.
  const file = path.join(dir, `video${sub}.mp4`);
  const cover = path.join(dir, `cover${sub}.jpg`);
  const coverAt = Math.min(tl.scenes[0].end - 0.15, Math.max(1.2, (tl.scenes[0].speechStart ?? 0) + 1.3));
  const r = await renderFrames({html: htmlFile, timeline: tl, pageOpt: null, audio: audioFile, out: file, workers: opts.workers ?? Math.max(2, Math.min(4, os.cpus().length)), preset: opts.draft ? 'veryfast' : 'medium', crf: opts.draft ? 26 : 20, coverAt, coverFile: cover, onProgress: opts.onProgress});
  fs.rmSync(framesRoot, {recursive: true, force: true});
  let srt: string | undefined;
  if (tl.captions.length) {
    srt = path.join(dir, `subtitles${sub}.srt`);
    writeSubtitles(tl.captions, srt, srt.replace(/\.srt$/, '.vtt'));
  }
  fs.writeFileSync(path.join(dir, `timeline${sub}.json`), JSON.stringify(tl));
  const buf = fs.readFileSync(file);
  db.run('DELETE FROM videos WHERE slideshow_id = ? AND aspect = ?', id, aspect);
  db.upsert('videos', {
    id: `vid_${sha256(id + aspect).slice(0, 12)}`,
    slideshow_id: id,
    aspect,
    path: path.relative(PATHS.var, file),
    width: size.width,
    height: size.height,
    fps,
    duration_s: tl.duration,
    bytes: buf.length,
    sha256: sha256(buf),
    poster_path: path.relative(PATHS.var, cover),
    subtitles_path: srt ? path.relative(PATHS.var, srt) : null,
    public_url: null,
    cover_url: null,
    qc_status: null,
    qc_json: null,
    render_ms: r.ms,
    frame_hashes: null,
    cost_eur: (voice?.costEur ?? 0) + 0,
    created_at: nowIso(),
  });
  prod.steps[`render${sub}`] = {at: nowIso(), ms: r.ms, note: `${tl.duration.toFixed(1)} s, ${r.frames} images, ${(buf.length / 1e6).toFixed(1)} Mo`};
  saveSpec(db, id, spec, {render_dir: path.relative(PATHS.var, dir)});
  db.event('render', `Vidéo montée (${tl.duration.toFixed(1)} s, ${aspect}, ${(buf.length / 1e6).toFixed(1)} Mo)`, {ref: id});
  void row;
  return {file, cover, srt, duration: tl.duration, frames: r.frames, ms: r.ms, lufs, peak};
}

/**
 * Adapted copy whose spoken call to action changes (« lien sur ma chaîne » on YouTube): only the last scene is
 * voiced again, with the same voice, and spliced after the original narration. Falls back to a full narration
 * when the original take is not available or the voice differs.
 */
export async function stepVoiceCta(db: Db, id: string): Promise<string> {
  const {spec} = loadSpec(db, id);
  const prod = spec.production!;
  const src = (prod as any).sourceVoice as import('./types.js').VoiceTrack | undefined;
  const scenes = spec.script.scenes;
  const last = scenes.length - 1;
  if (!src || !fs.existsSync(src.file) || src.parts.length !== scenes.length) return stepVoice(db, id);
  const dir = ensureDir(path.join(workDir(id), 'cta'));
  const voiceId = loadMedia().voices.find((v) => v.label === src.voice || v.id === src.provider)?.id ?? src.provider;
  const v = await synthesize(db, {parts: [scenes[last].narration || scenes[last].text.title || '…'], voice: voiceId, gender: spec.voice.gender, speed: spec.voice.speed, intonation: spec.voice.intonation, language: spec.voice.language, pitch: spec.voice.pitch ?? 0, seed: seedNum(id) % 100000, outDir: dir, ref: id});
  if (v.provider !== src.provider) return stepVoice(db, id);
  const a = readWav(src.file);
  const b = readWav(v.file);
  if (a.sampleRate !== b.sampleRate || a.channels !== b.channels) return stepVoice(db, id);
  const offset = src.parts[last].start;
  const cut = Math.round(offset * a.sampleRate) * a.channels;
  const data = new Float32Array(cut + b.data.length);
  data.set(a.data.subarray(0, cut));
  data.set(b.data, cut);
  const file = path.join(workDir(id), 'voice.wav');
  writeWav(file, {sampleRate: a.sampleRate, channels: a.channels, data});
  const seconds = data.length / a.channels / a.sampleRate;
  const words = [...src.words.filter((w) => w.start < offset - 0.02), ...v.words.map((w) => ({text: w.text, start: Math.round((w.start + offset) * 1000) / 1000, end: Math.round((w.end + offset) * 1000) / 1000}))];
  const parts = [...src.parts.slice(0, last), {start: offset, end: Math.round((offset + v.parts[0].end) * 1000) / 1000}];
  prod.voice = {...src, file, seconds, words, parts, mismatch: Math.round(((src.mismatch * last + v.mismatch) / scenes.length) * 1000) / 1000, costEur: v.costEur, assetId: v.assetId, warnings: v.warnings};
  delete (prod as any).sourceVoice;
  linkAsset(db, id, src.assetId, 'voix');
  linkAsset(db, id, v.assetId, 'voix (fin)');
  prod.steps.voice = {at: nowIso(), note: `${src.voice}, fin réenregistrée`};
  saveSpec(db, id, spec);
  return `${src.voice} : fin réenregistrée (${seconds.toFixed(1)} s)`;
}

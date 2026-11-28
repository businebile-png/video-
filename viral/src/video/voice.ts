import fs from 'node:fs';
import path from 'node:path';
import {spawn, spawnSync} from 'node:child_process';
import type {Db} from '../core/db.js';
import {ROOT, ensureDir} from '../core/paths.js';
import {loadMedia, logCall, recordAsset, type VoiceDef} from './media.js';
import {readWav, writeWav, type Pcm} from './wav.js';
import type {VoiceTrack, WordTiming} from './types.js';

/**
 * Narration. Free local voices first (the user's choice in the studio): « Claire » (Chatterbox Multilingual) and
 * « Siwis » (Kokoro), plus « Hugo », a deeper voice derived from Siwis by FFmpeg (no real person imitated).
 * ElevenLabs and Google are wired but only used when asked by name and when their terms allow the use:
 * a free ElevenLabs plan forbids commercial use, Google needs billing. Every take is then transcribed by
 * faster-whisper: word timings for the captions and a check that the voice said the script.
 */

const PY_VOICE = path.join(ROOT, '.venv-voice', 'bin', 'python');
const PY_CB = path.join(ROOT, '.venv-chatterbox', 'bin', 'python');
const MODELS = path.join(ROOT, 'models');
const FILES = {
  kokoroModel: path.join(MODELS, 'kokoro', 'onnx', 'model.onnx'),
  kokoroVoices: path.join(MODELS, 'kokoro', 'voices.npz'),
  chatterbox: path.join(MODELS, 'chatterbox'),
  claireRef: path.join(MODELS, 'voice-refs', 'claire.wav'),
  whisper: path.join(MODELS, 'whisper', 'small'),
};
const SCENE_GAP_MS = 300;

export class VoiceUnavailable extends Error {}

function runPython(python: string, script: string, command: string, job: unknown, workDir: string, timeoutMs: number): Promise<any> {
  const jobFile = path.join(ensureDir(workDir), `${command}-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(jobFile, JSON.stringify(job));
  return new Promise((resolve, reject) => {
    const child = spawn(python, ['-I', path.join(ROOT, 'scripts', script), command, jobFile], {cwd: ROOT, env: {...process.env, HF_HUB_OFFLINE: '1', TOKENIZERS_PARALLELISM: 'false'}});
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      fs.rmSync(jobFile, {force: true});
      if (code !== 0) {
        const tail = err.trim().split('\n').filter((l) => !/warn|deprecat|futurewarning/i.test(l)).slice(-3).join(' ');
        return reject(new Error(`${script} ${command} : ${(tail || `arrêt (code ${code})`).slice(0, 400)}`));
      }
      const last = out.trim().split('\n').pop() ?? '';
      try {
        resolve(JSON.parse(last));
      } catch {
        reject(new Error(`${script} ${command} : réponse illisible`));
      }
    });
  });
}

const statusCache = new Map<string, {ok: boolean; reason?: string; detail?: any}>();

/** Real check of one voice: files present for the local ones, an authenticated request for the paid ones. */
export async function voiceStatus(def: VoiceDef, fresh = false): Promise<{ok: boolean; reason?: string; detail?: any}> {
  if (!fresh && statusCache.has(def.id)) return statusCache.get(def.id)!;
  let st: {ok: boolean; reason?: string; detail?: any};
  const missing = (files: string[]) => files.filter((f) => !fs.existsSync(f)).map((f) => path.relative(ROOT, f));
  if (def.engine === 'chatterbox') {
    const m = missing([PY_CB, PY_VOICE, path.join(FILES.chatterbox, 't3_mtl23ls_v2.safetensors'), path.join(MODELS, 'voice-refs', def.ref ?? 'claire.wav'), path.join(FILES.whisper, 'model.bin')]);
    st = m.length ? {ok: false, reason: `non installée (bash scripts/setup-voice.sh) : ${m.join(', ')}`} : {ok: true};
  } else if (def.engine === 'kokoro') {
    const m = missing([PY_VOICE, FILES.kokoroModel, FILES.kokoroVoices, path.join(FILES.whisper, 'model.bin')]);
    st = m.length ? {ok: false, reason: `non installée (bash scripts/setup-voice.sh) : ${m.join(', ')}`} : {ok: true};
    if (st.ok && def.transform && !/rubberband/.test(spawnSync('ffmpeg', ['-hide_banner', '-filters'], {encoding: 'utf8'}).stdout ?? '')) st = {ok: false, reason: 'FFmpeg sans le filtre rubberband'};
  } else if (def.engine === 'elevenlabs') {
    try {
      const r = await fetch('https://api.elevenlabs.io/v1/user/subscription', {signal: AbortSignal.timeout(15_000)});
      const body: any = await r.json().catch(() => ({}));
      if (r.status === 401) st = {ok: false, reason: `clé refusée (HTTP 401 : ${body?.detail?.message ?? ''}) — la clé doit être envoyée dans l'en-tête xi-api-key`};
      else if (!r.ok) st = {ok: false, reason: `HTTP ${r.status}`};
      else if (String(body.tier ?? '').toLowerCase() === 'free') st = {ok: false, reason: 'plan gratuit : ElevenLabs interdit alors l’usage commercial', detail: {tier: body.tier}};
      else st = {ok: true, detail: {tier: body.tier, remaining: (body.character_limit ?? 0) - (body.character_count ?? 0)}};
    } catch (e: any) {
      st = {ok: false, reason: `injoignable : ${e.message}`};
    }
  } else {
    try {
      const r = await fetch('https://texttospeech.googleapis.com/v1/voices?languageCode=fr-FR', {signal: AbortSignal.timeout(15_000)});
      const body: any = await r.json().catch(() => ({}));
      st = r.ok ? {ok: true, detail: {voices: (body.voices ?? []).length}} : {ok: false, reason: `HTTP ${r.status} : ${body?.error?.message ?? ''}`.trim()};
    } catch (e: any) {
      st = {ok: false, reason: `injoignable : ${e.message}`};
    }
  }
  statusCache.set(def.id, st);
  return st;
}

export interface SynthesisRequest {
  parts: string[];
  voice: string;
  gender: 'female' | 'male';
  speed: number;
  intonation: 'neutre' | 'expressive' | 'calme';
  language: string;
  /** Tone shift in semitones (-4 … +4), pitch only (formants kept). */
  pitch?: number;
  seed: number;
  outDir: string;
  ref: string;
}

/** Sentences of a text, never cut inside an abbreviation, a number or a brand (« Systeme.io », « 2.5 », « etc. »). */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  const parts = text.split(/(?<=[.!?…])\s+(?=[«"A-ZÀ-ÖØ-Þ0-9])/u);
  for (const p of parts) {
    const prev = out[out.length - 1];
    if (prev && /\b(etc|ex|cf|p\. ex|M|Mme|Dr|n°)\.$/i.test(prev)) out[out.length - 1] = `${prev} ${p}`;
    else if (p.trim()) out.push(p.trim());
  }
  return out;
}

/** Order of voices to try. Paid voices only when named explicitly (studio rule: never put Google first unasked). */
export function voiceChain(req: Pick<SynthesisRequest, 'voice' | 'gender' | 'language'>): VoiceDef[] {
  const all = loadMedia().voices;
  const lang = req.language.toLowerCase();
  const speaks = (v: VoiceDef) => v.language.toLowerCase() === lang || (v.languages ?? []).some((l) => l.toLowerCase() === lang);
  // Native voices of the language first, then multilingual ones (which keep their French accent).
  const local = all.filter((v) => (v.engine === 'chatterbox' || v.engine === 'kokoro') && speaks(v)).sort((a, b) => Number(b.language.toLowerCase() === lang) - Number(a.language.toLowerCase() === lang));
  const byGender = (g: string) => local.filter((v) => v.gender === g);
  if (req.voice && req.voice !== 'auto') {
    const named = all.find((v) => v.id === req.voice);
    if (!named) throw new Error(`Voix inconnue : ${req.voice}`);
    const rest = byGender(named.gender === 'any' ? req.gender : named.gender).filter((v) => v.id !== named.id);
    return [named, ...rest];
  }
  const same = byGender(req.gender);
  const other = byGender(req.gender === 'female' ? 'male' : 'female');
  return [...same, ...other];
}

interface RawTake {
  file: string;
  seconds: number;
  partSeconds: number[];
  gapSeconds: number;
  chars: number;
  costEur: number;
  meta: Record<string, unknown>;
}

const EXAGGERATION = {neutre: 0.5, expressive: 0.62, calme: 0.42};

async function takeLocal(def: VoiceDef, req: SynthesisRequest, file: string): Promise<RawTake> {
  const chars = req.parts.join(' ').length;
  if (def.engine === 'chatterbox') {
    const r = await runPython(
      PY_CB,
      'voice_chatterbox.py',
      'tts',
      {
        parts: req.parts,
        out: file,
        modelDir: FILES.chatterbox,
        whisperModel: FILES.whisper,
        reference: path.join(MODELS, 'voice-refs', def.ref ?? 'claire.wav'),
        language: req.language.slice(0, 2).toLowerCase(),
        seed: req.seed,
        exaggeration: EXAGGERATION[req.intonation],
        targetWpm: Math.round(160 * req.speed),
        maxSpeedup: 1.3,
        sceneBreakMs: SCENE_GAP_MS,
        threads: 4,
      },
      req.outDir,
      30 * 60_000,
    );
    return {file, seconds: r.seconds, partSeconds: r.partSeconds, gapSeconds: r.gapSeconds, chars, costEur: 0, meta: {worstError: r.worstError, speedup: r.speedup, elapsedSec: r.elapsedSec}};
  }
  // One TTS part per sentence: a short breath between sentences, a longer pause between scenes, longer after « … ».
  const sentences: string[] = [];
  const gapsMs: number[] = [];
  const owner: number[] = [];
  req.parts.forEach((part, i) => {
    const ss = splitSentences(part);
    (ss.length ? ss : [part]).forEach((x, k, arr) => {
      sentences.push(x);
      owner.push(i);
      gapsMs.push(k < arr.length - 1 ? (x.endsWith('…') ? 420 : 190) : SCENE_GAP_MS);
    });
  });
  const raw = await runPython(
    PY_VOICE,
    'voice_local.py',
    'tts',
    {parts: sentences, gapsMs, out: file, model: FILES.kokoroModel, voices: FILES.kokoroVoices, voice: def.voice ?? 'ff_siwis', speed: req.speed, lang: def.kokoroLang ?? 'fr-fr', sceneBreakMs: SCENE_GAP_MS},
    req.outDir,
    10 * 60_000,
  );
  // Back to one duration per scene (its sentences and the pauses between them).
  const partSeconds = req.parts.map(() => 0);
  (raw.partSeconds as number[]).forEach((d, k) => {
    partSeconds[owner[k]] += d + (k < sentences.length - 1 && owner[k + 1] === owner[k] ? gapsMs[k] / 1000 : 0);
  });
  const r = {...raw, partSeconds, gapSeconds: SCENE_GAP_MS / 1000};
  if (def.transform) {
    const tmp = file.replace(/\.wav$/, '.raw.wav');
    fs.renameSync(file, tmp);
    const t = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', tmp, '-af', `rubberband=pitch=${def.transform.pitch}:formant=${def.transform.formant}:pitchq=quality,highpass=f=70,equalizer=f=220:t=q:w=1:g=2`, file]);
    fs.rmSync(tmp, {force: true});
    if (t.status !== 0) throw new Error(`transformation de la voix impossible : ${t.stderr?.toString().slice(0, 200)}`);
  }
  return {file, seconds: r.seconds, partSeconds: r.partSeconds, gapSeconds: r.gapSeconds, chars, costEur: 0, meta: {languageSwitches: r.languageSwitches}};
}

/** Paid engines: one request per scene, joined with the same pause as the local voices. */
async function takeRemote(def: VoiceDef, req: SynthesisRequest, file: string): Promise<RawTake> {
  const pcs: Pcm[] = [];
  let chars = 0;
  for (const text of req.parts) {
    chars += text.length;
    let wav: Buffer;
    if (def.engine === 'elevenlabs') {
      const voiceId = req.gender === 'male' ? 'pNInz6obpgDQGcFmaJgB' : '21m00Tcm4TlvDq8ikWAM';
      const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=pcm_24000`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({text, model_id: def.model ?? 'eleven_multilingual_v2', voice_settings: {stability: req.intonation === 'expressive' ? 0.35 : 0.55, similarity_boost: 0.75, speed: req.speed}}),
        signal: AbortSignal.timeout(60_000),
      });
      if (!r.ok) throw new Error(`ElevenLabs HTTP ${r.status} : ${(await r.text()).slice(0, 200)}`);
      const raw = Buffer.from(await r.arrayBuffer());
      const data = new Float32Array(raw.length / 2);
      for (let i = 0; i < data.length; i++) data[i] = raw.readInt16LE(i * 2) / 32768;
      pcs.push({sampleRate: 24000, channels: 1, data});
      continue;
    } else {
      const name = def.voices?.[req.gender] ?? 'fr-FR-Neural2-F';
      const r = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({input: {text}, voice: {languageCode: req.language, name}, audioConfig: {audioEncoding: 'LINEAR16', sampleRateHertz: 24000, speakingRate: req.speed, pitch: req.intonation === 'expressive' ? 1 : 0}}),
        signal: AbortSignal.timeout(60_000),
      });
      const body: any = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`Google TTS HTTP ${r.status} : ${body?.error?.message ?? ''}`);
      wav = Buffer.from(body.audioContent, 'base64');
      const tmp = file + '.part.wav';
      fs.writeFileSync(tmp, wav);
      pcs.push(readWav(tmp));
      fs.rmSync(tmp, {force: true});
    }
  }
  const sr = pcs[0]?.sampleRate ?? 24000;
  const gap = Math.round((sr * SCENE_GAP_MS) / 1000);
  const total = pcs.reduce((a, p) => a + p.data.length, 0) + gap * (pcs.length - 1);
  const data = new Float32Array(total);
  let o = 0;
  const partSeconds: number[] = [];
  pcs.forEach((p, i) => {
    data.set(p.data, o);
    o += p.data.length + (i < pcs.length - 1 ? gap : 0);
    partSeconds.push(p.data.length / sr);
  });
  writeWav(file, {sampleRate: sr, channels: 1, data});
  return {file, seconds: total / sr, partSeconds, gapSeconds: gap / sr, chars, costEur: (chars * def.eurPerMChar) / 1e6, meta: {}};
}

// --- Alignment -------------------------------------------------------------------------------------------

const UNITS = ['zero', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize'];
const TENS: Record<number, string> = {20: 'vingt', 30: 'trente', 40: 'quarante', 50: 'cinquante', 60: 'soixante'};
function below100(n: number): string {
  if (n <= 16) return UNITS[n];
  if (n < 20) return 'dix ' + UNITS[n - 10];
  if (n < 70) {
    const t = Math.floor(n / 10) * 10;
    const u = n % 10;
    return TENS[t] + (u === 0 ? '' : u === 1 ? ' et un' : ' ' + UNITS[u]);
  }
  if (n < 80) return 'soixante ' + (n === 71 ? 'et onze' : below100(n - 60));
  return 'quatre vingt' + (n === 80 ? 's' : ' ' + below100(n - 80));
}
function below1000(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const head = h === 0 ? '' : h === 1 ? 'cent' : UNITS[h] + ' cent' + (r === 0 ? 's' : '');
  return `${head} ${r || !head ? below100(r) : ''}`.trim();
}
export function frenchNumber(n: number): string {
  if (n === 0) return 'zero';
  const th = Math.floor(n / 1000);
  const r = n % 1000;
  const head = th === 0 ? '' : th === 1 ? 'mille' : below1000(th) + ' mille';
  return `${head} ${r ? below1000(r) : ''}`.trim();
}
const BRAND = new Set(['systeme', 'system', 'systemio', 'io', 'i', 'o']);
export function spokenTokens(text: string): string[] {
  let t = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  t = t.replace(/(?<=\d)[\s  .,](?=\d{3}\b)/g, '');
  t = t.replace(/\d{1,6}/g, (m) => ` ${frenchNumber(Number(m))} `);
  return t
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w && !BRAND.has(w));
}
function editDistance(a: string[], b: string[]): number {
  const row = Array.from({length: b.length + 1}, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = row[j];
      row[j] = cur;
    }
  }
  return row[b.length];
}

/**
 * Timings of the script's own words (what the captions show) from the transcriber's words: inside each scene,
 * positions are mapped through the characters heard, so every caption word gets a monotonic start and end.
 */
export function alignWords(parts: string[], bounds: Array<{start: number; end: number}>, heard: WordTiming[]): WordTiming[] {
  const out: WordTiming[] = [];
  parts.forEach((part, i) => {
    const b = bounds[i];
    const tokens = part.split(/\s+/).filter(Boolean);
    const mine = heard.filter((w) => (w.start + w.end) / 2 >= b.start - 0.2 && (w.start + w.end) / 2 <= b.end + 0.2);
    const lens = tokens.map((t) => Math.max(1, spokenTokens(t).join('').length || t.length));
    const total = lens.reduce((a, x) => a + x, 0);
    if (!mine.length) {
      let acc = 0;
      tokens.forEach((t, k) => {
        const s = b.start + ((b.end - b.start) * acc) / total;
        acc += lens[k];
        out.push({text: t, start: round3(s), end: round3(b.start + ((b.end - b.start) * acc) / total)});
      });
      return;
    }
    const hl = mine.map((w) => Math.max(1, spokenTokens(w.text).join('').length || w.text.length));
    const htotal = hl.reduce((a, x) => a + x, 0);
    const cum: number[] = [];
    hl.reduce((a, x, k) => ((cum[k] = a), a + x), 0);
    const timeAt = (ratio: number) => {
      const p = Math.min(htotal - 1e-6, Math.max(0, ratio * htotal));
      let k = 0;
      while (k < mine.length - 1 && cum[k + 1] <= p) k++;
      const w = mine[k];
      return w.start + ((p - cum[k]) / hl[k]) * (w.end - w.start);
    };
    let acc = 0;
    tokens.forEach((t, k) => {
      const s = timeAt(acc / total);
      acc += lens[k];
      const e = timeAt(acc / total);
      out.push({text: t, start: round3(s), end: round3(Math.max(e, s + 0.06))});
    });
  });
  return out;
}
const round3 = (x: number) => Math.round(x * 1000) / 1000;

/** Narration for one video: first voice of the chain that works, then transcription and word timings. */
export async function synthesize(db: Db, req: SynthesisRequest): Promise<VoiceTrack> {
  ensureDir(req.outDir);
  const chain = voiceChain(req);
  const warnings: string[] = [];
  for (const def of chain) {
    const st = await voiceStatus(def);
    if (!st.ok) {
      warnings.push(`${def.label} indisponible : ${st.reason}`);
      continue;
    }
    const file = path.join(req.outDir, 'voice.wav');
    const t0 = Date.now();
    let take: RawTake;
    try {
      take = def.engine === 'chatterbox' || def.engine === 'kokoro' ? await takeLocal(def, req, file) : await takeRemote(def, req, file);
    } catch (e: any) {
      logCall(db, {provider: def.id, kind: 'tts', ref: req.ref, ok: false, ms: Date.now() - t0, error: e.message});
      warnings.push(`${def.label} : ${e.message}`);
      continue;
    }
    logCall(db, {provider: def.id, kind: 'tts', ref: req.ref, ok: true, units: take.chars, unit: 'caractères', costEur: take.costEur, ms: Date.now() - t0});
    if (req.pitch && Math.abs(req.pitch) >= 0.25) {
      const tmp = file.replace(/\.wav$/, '.pitch.wav');
      const t = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', file, '-af', `rubberband=pitch=${Math.pow(2, req.pitch / 12).toFixed(4)}:formant=preserved:pitchq=quality`, tmp]);
      if (t.status === 0) fs.renameSync(tmp, file);
      else warnings.push('réglage du ton impossible (FFmpeg rubberband)');
    }
    const stt = await runPython(PY_VOICE, 'voice_local.py', 'stt', {model: FILES.whisper, audio: file, language: req.language.slice(0, 2).toLowerCase()}, req.outDir, 10 * 60_000);
    const bounds: Array<{start: number; end: number}> = [];
    let acc = 0;
    take.partSeconds.forEach((d, i) => {
      bounds.push({start: round3(acc), end: round3(acc + d)});
      acc += d + (i < take.partSeconds.length - 1 ? take.gapSeconds : 0);
    });
    const heard: WordTiming[] = stt.words ?? [];
    const words = alignWords(req.parts, bounds, heard);
    const said = spokenTokens(req.parts.join(' '));
    const mismatch = said.length ? Math.round((editDistance(said, spokenTokens(stt.text ?? '')) / said.length) * 1000) / 1000 : 0;
    const seconds = readWav(file).data.length / 24000 > 0 ? take.seconds : take.seconds;
    const assetId = recordAsset(db, {
      kind: 'voice',
      provider: def.id,
      file,
      license: def.license,
      licenseUrl: def.licenseUrl,
      commercialOk: def.commercial === true || (def.commercial === 'paid-plan' && st.ok),
      attribution: def.credit,
      meta: {voice: def.label, engine: def.engine, seconds, chars: take.chars, mismatch, heard: stt.text, ...take.meta},
      costEur: take.costEur,
    });
    return {provider: def.id, voice: def.label, file, seconds, words, parts: bounds, mismatch, costEur: take.costEur, assetId, warnings};
  }
  throw new VoiceUnavailable(`Aucune voix disponible : ${warnings.join(' ; ') || 'aucune voix pour cette langue'}`);
}

/** A sample sentence per language, read by a voice so the user can listen before choosing. */
const SAMPLE: Record<string, string> = {
  fr: 'Bonjour ! Voici ma voix pour tes vidéos : claire, posée, et facile à suivre jusqu’au bout.',
  en: 'Hi! This is how I sound in your videos: clear, natural and easy to follow to the end.',
  es: '¡Hola! Así suena mi voz en tus vídeos: clara, natural y fácil de seguir hasta el final.',
  it: 'Ciao! Ecco la mia voce per i tuoi video: chiara, naturale e facile da seguire fino alla fine.',
  pt: 'Olá! Esta é a minha voz para os seus vídeos: clara, natural e fácil de acompanhar até o fim.',
  de: 'Hallo! So klingt meine Stimme in deinen Videos: klar, natürlich und leicht zu verstehen.',
};

export async function voicePreview(db: Db, voiceId: string, opts: {language?: string; text?: string; speed?: number; pitch?: number; outDir: string}): Promise<{file: string; seconds: number; voice: string}> {
  const def = loadMedia().voices.find((v) => v.id === voiceId);
  if (!def) throw new Error(`Voix inconnue : ${voiceId}`);
  const language = opts.language ?? def.language;
  const text = opts.text?.trim() || SAMPLE[language.slice(0, 2).toLowerCase()] || SAMPLE.fr;
  const dir = ensureDir(path.join(opts.outDir, `tmp-${voiceId}-${Date.now()}`));
  try {
    const v = await synthesize(db, {parts: [text], voice: voiceId, gender: def.gender === 'male' ? 'male' : 'female', speed: opts.speed ?? 1, intonation: 'expressive', language, pitch: opts.pitch, seed: 7, outDir: dir, ref: `apercu:${voiceId}`});
    if (v.provider !== voiceId) throw new Error(`${def.label} indisponible (${v.warnings.join(' ; ')})`);
    const name = `voice-${voiceId}${language !== def.language ? '-' + language : ''}${opts.text ? '-perso' : ''}.mp3`;
    const out = path.join(ensureDir(opts.outDir), name);
    const t = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', v.file, '-ac', '1', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '96k', out]);
    if (t.status !== 0) throw new Error('conversion MP3 impossible');
    return {file: out, seconds: v.seconds, voice: def.label};
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
}

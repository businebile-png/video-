import fsp from 'node:fs/promises';
import {existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {runOrThrow} from '../core/exec.js';
import {PATHS} from '../core/paths.js';
import type {StudioConfig} from '../schemas/config.js';
import type {TimedWord} from './speech.js';

/**
 * Free local voice (no account, no key): Kokoro-82M for speech, faster-whisper for word timings.
 * Both run on the CPU through scripts/voice_local.py, installed by scripts/setup-voice.sh.
 */
type LocalConfig = StudioConfig['voice']['local'];

const HELPER = path.join(PATHS.root, 'scripts', 'voice_local.py');

function abs(p: string): string {
  return path.isAbsolute(p) ? p : path.join(PATHS.root, p);
}

/** What is missing to run the local voice, with the command that installs it. */
export function localVoiceProblems(cfg: LocalConfig): string[] {
  const missing: string[] = [];
  if (!existsSync(abs(cfg.python))) missing.push('environnement Python de la voix');
  if (!existsSync(abs(cfg.model))) missing.push('modèle de voix Kokoro');
  if (!existsSync(abs(cfg.voices))) missing.push('fichier des voix');
  if (!existsSync(path.join(abs(cfg.whisperModel), 'model.bin'))) missing.push('modèle de transcription');
  return missing;
}

function assertReady(cfg: LocalConfig): void {
  const missing = localVoiceProblems(cfg);
  if (missing.length) throw new Error(`Voix locale incomplète (${missing.join(', ')}) : lancez « bash scripts/setup-voice.sh ».`);
}

async function callHelper<T>(cfg: LocalConfig, mode: 'tts' | 'stt' | 'voices', job: Record<string, unknown>): Promise<T> {
  assertReady(cfg);
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'studio-voice-'));
  const jobFile = path.join(dir, 'job.json');
  try {
    await fsp.writeFile(jobFile, JSON.stringify(job));
    const res = await runOrThrow(abs(cfg.python), ['-I', HELPER, mode, jobFile]);
    const last = res.stdout.trim().split('\n').pop() ?? '';
    return JSON.parse(last) as T;
  } finally {
    await fsp.rm(dir, {recursive: true, force: true});
  }
}

export interface LocalSynthesis {
  seconds: number;
  languageSwitches: string[];
  phonemes: string[];
}

/** Speak each part (one per scene) and join them with a short breath. Writes a 24 kHz WAV. */
export async function localSynthesize(parts: string[], out: string, opts: {voice: string; speed: number}, cfg: LocalConfig): Promise<LocalSynthesis> {
  return callHelper<LocalSynthesis>(cfg, 'tts', {
    model: abs(cfg.model),
    voices: abs(cfg.voices),
    voice: opts.voice,
    speed: Math.round(opts.speed * 1000) / 1000,
    lang: cfg.lang,
    sceneBreakMs: cfg.sceneBreakMs,
    parts,
    out: path.resolve(out),
  });
}

/** Word-timed transcription of an audio file, in French. */
export async function localTranscribe(file: string, cfg: LocalConfig): Promise<{text: string; words: TimedWord[]}> {
  const res = await callHelper<{text: string; words: TimedWord[]}>(cfg, 'stt', {model: abs(cfg.whisperModel), audio: path.resolve(file), language: 'fr'});
  return {text: res.text, words: res.words.filter((w) => w.text.length > 0 && w.end >= w.start)};
}

/** Voices available in the voices file; French ones start with "f". */
export async function localListVoices(cfg: LocalConfig): Promise<string[]> {
  return (await callHelper<{voices: string[]}>(cfg, 'voices', {voices: abs(cfg.voices)})).voices;
}

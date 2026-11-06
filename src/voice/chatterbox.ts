import fsp from 'node:fs/promises';
import {existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {runOrThrow} from '../core/exec.js';
import {PATHS} from '../core/paths.js';
import type {StudioConfig} from '../schemas/config.js';

/**
 * Voice « Claire »: Chatterbox Multilingual (MIT) on the CPU, timbre from a SIWIS reference recording
 * (CC BY 4.0). Installed by scripts/setup-voice.sh; run through scripts/voice_chatterbox.py.
 */
type ChatterboxConfig = StudioConfig['voice']['chatterbox'];

const HELPER = path.join(PATHS.root, 'scripts', 'voice_chatterbox.py');
const MODEL_FILES = ['ve.pt', 't3_mtl23ls_v2.safetensors', 's3gen.pt', 'grapheme_mtl_merged_expanded_v1.json', 'conds.pt'];

function abs(p: string): string {
  return path.isAbsolute(p) ? p : path.join(PATHS.root, p);
}

/** What is missing to speak with Claire, with the command that installs it. */
export function chatterboxProblems(cfg: ChatterboxConfig, whisperModel: string): string[] {
  const missing: string[] = [];
  if (!existsSync(abs(cfg.python))) missing.push('environnement Python de Claire');
  if (MODEL_FILES.some((f) => !existsSync(path.join(abs(cfg.modelDir), f)))) missing.push('modèle Chatterbox');
  if (!existsSync(abs(cfg.reference))) missing.push('enregistrement de référence');
  if (!existsSync(path.join(abs(whisperModel), 'model.bin'))) missing.push('modèle de transcription');
  return missing;
}

export interface ChatterboxSentence {
  scene: number;
  sentence: string;
  takes: number;
  error: number;
  heard: string;
}

export interface ChatterboxSynthesis {
  seconds: number;
  paceBefore: number;
  speedup: number;
  elapsedSec: number;
  worstError: number;
  sentences: ChatterboxSentence[];
}

/** One part per scene; sentences are generated and checked one by one, retaken when they drift from the text. */
export async function chatterboxSynthesize(
  parts: string[],
  out: string,
  opts: {seed: number},
  cfg: ChatterboxConfig,
  whisperModel: string,
): Promise<ChatterboxSynthesis> {
  const missing = chatterboxProblems(cfg, whisperModel);
  if (missing.length) throw new Error(`Voix Claire incomplète (${missing.join(', ')}) : lancez « bash scripts/setup-voice.sh ».`);
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'studio-claire-'));
  const jobFile = path.join(dir, 'job.json');
  try {
    await fsp.writeFile(
      jobFile,
      JSON.stringify({
        modelDir: abs(cfg.modelDir),
        reference: abs(cfg.reference),
        whisperModel: abs(whisperModel),
        exaggeration: cfg.exaggeration,
        cfg: cfg.cfgWeight,
        temperature: cfg.temperature,
        maxTakes: cfg.maxTakes,
        sentenceBreakMs: cfg.sentenceBreakMs,
        sceneBreakMs: cfg.sceneBreakMs,
        targetWpm: cfg.targetWpm,
        maxSpeedup: cfg.maxSpeedup,
        seed: opts.seed,
        parts,
        out: path.resolve(out),
      }),
    );
    const res = await runOrThrow(abs(cfg.python), ['-I', HELPER, 'tts', jobFile], {env: {...process.env, HF_HUB_OFFLINE: '1', TOKENIZERS_PARALLELISM: 'false'}});
    const last = res.stdout.trim().split('\n').pop() ?? '';
    return JSON.parse(last) as ChatterboxSynthesis;
  } finally {
    await fsp.rm(dir, {recursive: true, force: true});
  }
}

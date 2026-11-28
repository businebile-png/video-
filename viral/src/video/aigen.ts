import fs from 'node:fs';
import path from 'node:path';
import type {Db} from '../core/db.js';
import {sleep} from '../core/util.js';
import {loadMedia, logCall, recordAsset, type AiVideoDef} from './media.js';

/**
 * AI video engines (Google Veo through the Gemini API, Runway Gen-4 Turbo). Both are paid; neither has a key in
 * this environment, so neither has ever been called for real: they are only tried when a key exists, inside the
 * batch budget, and a scene falls back to licensed footage otherwise. A clip counts as generated only when the
 * MP4 file exists on disk and plays (ffprobe); nothing is ever presented as AI-generated without that file.
 */

function keyFor(def: AiVideoDef): string | null {
  for (const k of def.keyEnv) if (process.env[k]?.trim()) return process.env[k]!.trim();
  return null;
}

export function aiVideoProviders(): Array<AiVideoDef & {configured: boolean}> {
  return loadMedia().aiVideo.map((d) => ({...d, configured: !!keyFor(d)}));
}

export function aiVideoAvailable(): boolean {
  return aiVideoProviders().some((p) => p.configured) && process.env.VIRAL_AI_VIDEO !== '0';
}

export interface AiClipRequest {
  prompt: string;
  seconds: number;
  aspect: '9:16' | '1:1' | '16:9';
  ref: string;
  outDir: string;
  /** Still to animate (Runway works from an image). */
  image?: string;
  maxCostEur?: number;
}

async function veo(def: AiVideoDef, key: string, r: AiClipRequest, file: string): Promise<void> {
  const base = 'https://generativelanguage.googleapis.com/v1beta';
  const start = await fetch(`${base}/models/${def.model}:predictLongRunning`, {
    method: 'POST',
    headers: {'x-goog-api-key': key, 'content-type': 'application/json'},
    body: JSON.stringify({instances: [{prompt: r.prompt}], parameters: {aspectRatio: r.aspect === '16:9' ? '16:9' : '9:16', personGeneration: 'dont_allow'}}),
    signal: AbortSignal.timeout(60_000),
  });
  const op: any = await start.json().catch(() => ({}));
  if (!start.ok || !op.name) throw new Error(`Veo HTTP ${start.status} : ${op?.error?.message ?? 'réponse inattendue'}`);
  for (let i = 0; i < 60; i++) {
    await sleep(10_000);
    const s: any = await (await fetch(`${base}/${op.name}`, {headers: {'x-goog-api-key': key}, signal: AbortSignal.timeout(30_000)})).json();
    if (s.error) throw new Error(`Veo : ${s.error.message}`);
    if (s.done) {
      const uri = s.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
      if (!uri) throw new Error('Veo : aucune vidéo dans la réponse');
      const v = await fetch(uri, {headers: {'x-goog-api-key': key}, signal: AbortSignal.timeout(120_000)});
      if (!v.ok) throw new Error(`Veo : téléchargement HTTP ${v.status}`);
      fs.writeFileSync(file, Buffer.from(await v.arrayBuffer()));
      return;
    }
  }
  throw new Error('Veo : délai dépassé (10 min)');
}

async function runway(def: AiVideoDef, key: string, r: AiClipRequest, file: string): Promise<void> {
  if (!r.image || !fs.existsSync(r.image)) throw new Error('Runway anime une image : aucune image de départ');
  const headers = {Authorization: `Bearer ${key}`, 'X-Runway-Version': '2024-11-06', 'content-type': 'application/json'};
  const start = await fetch('https://api.dev.runwayml.com/v1/image_to_video', {
    method: 'POST',
    headers,
    body: JSON.stringify({model: def.model, promptImage: `data:image/jpeg;base64,${fs.readFileSync(r.image).toString('base64')}`, promptText: r.prompt.slice(0, 900), ratio: r.aspect === '16:9' ? '1280:720' : '720:1280', duration: r.seconds > 5 ? 10 : 5}),
    signal: AbortSignal.timeout(60_000),
  });
  const task: any = await start.json().catch(() => ({}));
  if (!start.ok || !task.id) throw new Error(`Runway HTTP ${start.status} : ${task?.error ?? 'réponse inattendue'}`);
  for (let i = 0; i < 60; i++) {
    await sleep(8_000);
    const s: any = await (await fetch(`https://api.dev.runwayml.com/v1/tasks/${task.id}`, {headers, signal: AbortSignal.timeout(30_000)})).json();
    if (s.status === 'FAILED' || s.status === 'CANCELLED') throw new Error(`Runway : ${s.failure ?? s.status}`);
    if (s.status === 'SUCCEEDED' && s.output?.[0]) {
      const v = await fetch(s.output[0], {signal: AbortSignal.timeout(120_000)});
      if (!v.ok) throw new Error(`Runway : téléchargement HTTP ${v.status}`);
      fs.writeFileSync(file, Buffer.from(await v.arrayBuffer()));
      return;
    }
  }
  throw new Error('Runway : délai dépassé (8 min)');
}

/** First configured engine that returns a playable file within the budget. */
export async function generateAiClip(db: Db, r: AiClipRequest): Promise<{file: string; assetId: string; provider: string; costEur: number}> {
  const errors: string[] = [];
  for (const def of aiVideoProviders().filter((p) => p.configured)) {
    const seconds = Math.min(def.maxSeconds, Math.max(4, r.seconds));
    const cost = seconds * def.eurPerSecond;
    if (r.maxCostEur !== undefined && cost > r.maxCostEur) {
      errors.push(`${def.label} : budget insuffisant (${cost.toFixed(2)} € pour ${seconds} s)`);
      continue;
    }
    const file = path.join(r.outDir, `ai-${def.id}-${Date.now()}.mp4`);
    const t0 = Date.now();
    try {
      await (def.id === 'veo' ? veo : runway)(def, keyFor(def)!, {...r, seconds}, file);
      const {spawnSync} = await import('node:child_process');
      const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], {encoding: 'utf8'});
      if (probe.status !== 0 || !(Number(probe.stdout) > 0)) throw new Error('fichier reçu illisible');
      logCall(db, {provider: def.id, kind: 'ai-video', ref: r.ref, ok: true, units: seconds, unit: 'secondes', costEur: cost, ms: Date.now() - t0});
      const assetId = recordAsset(db, {kind: 'ai-video', provider: def.id, file, license: def.license, licenseUrl: def.licenseUrl, commercialOk: def.commercial, meta: {prompt: r.prompt, seconds, model: def.model}, costEur: cost});
      return {file, assetId, provider: def.id, costEur: cost};
    } catch (e: any) {
      fs.rmSync(file, {force: true});
      logCall(db, {provider: def.id, kind: 'ai-video', ref: r.ref, ok: false, ms: Date.now() - t0, error: e.message});
      errors.push(`${def.label} : ${e.message}`);
    }
  }
  throw new Error(errors.join(' ; ') || 'aucun moteur vidéo IA configuré');
}

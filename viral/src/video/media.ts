import fs from 'node:fs';
import path from 'node:path';
import type {Db} from '../core/db.js';
import {PATHS} from '../core/paths.js';
import {id as newId, nowIso, parseJson, sha256} from '../core/util.js';

/** Catalogue of voices, stock libraries and AI video engines (config/media.json). */
export interface VoiceDef {
  id: string;
  label: string;
  engine: 'chatterbox' | 'kokoro' | 'elevenlabs' | 'google';
  voice?: string;
  voices?: Record<string, string>;
  model?: string;
  language: string;
  gender: 'female' | 'male' | 'any';
  accent: string;
  transform?: {pitch: number; formant: 'shifted' | 'preserved'};
  host?: string;
  license: string;
  licenseUrl: string;
  credit?: string;
  commercial: true | 'paid-plan';
  eurPerMChar: number;
  notes?: string;
}
export interface StockDef {
  id: string;
  label: string;
  keyEnv?: string;
  host: string;
  license: string;
  licenseUrl: string;
  commercial: boolean;
  attribution: boolean;
  cacheHours?: number;
  disabled?: string;
}
export interface AiVideoDef {
  id: string;
  label: string;
  keyEnv: string[];
  host: string;
  model: string;
  eurPerSecond: number;
  maxSeconds: number;
  license: string;
  licenseUrl: string;
  commercial: boolean;
  tested: boolean;
}
export interface MediaConfig {
  checkedOn: string;
  voices: VoiceDef[];
  stock: StockDef[];
  aiVideo: AiVideoDef[];
  music: {default: string; licensedDir: string; rules: string};
}

let cached: MediaConfig | null = null;
export function loadMedia(): MediaConfig {
  if (!cached) cached = JSON.parse(fs.readFileSync(path.join(PATHS.config, 'media.json'), 'utf8')) as MediaConfig;
  return cached;
}

export function voiceDef(id: string): VoiceDef {
  const v = loadMedia().voices.find((x) => x.id === id);
  if (!v) throw new Error(`Voix inconnue : ${id} (voix : ${loadMedia().voices.map((x) => x.id).join(', ')})`);
  return v;
}

/** Rights record of one media file used in a video (voice take, music, clip, still, character…). */
export interface AssetInput {
  kind: 'voice' | 'music' | 'sfx' | 'stock-video' | 'image' | 'ai-video' | 'character' | 'font';
  provider: string;
  sourceId?: string;
  sourceUrl?: string;
  author?: string;
  authorUrl?: string;
  file?: string;
  license: string;
  licenseUrl?: string;
  commercialOk: boolean;
  attribution?: string;
  meta?: unknown;
  costEur?: number;
}

export function recordAsset(db: Db, a: AssetInput): string {
  // One row per source file: the same Pixabay clip used twice keeps one rights record.
  if (a.sourceId) {
    const prev = db.get<{id: string}>('SELECT id FROM media_assets WHERE provider = ? AND source_id = ? AND kind = ?', a.provider, a.sourceId, a.kind);
    if (prev) {
      if (a.file) db.run('UPDATE media_assets SET path = ? WHERE id = ?', path.relative(PATHS.var, a.file), prev.id);
      return prev.id;
    }
  }
  const id = newId('ast');
  db.upsert('media_assets', {
    id,
    kind: a.kind,
    provider: a.provider,
    source_id: a.sourceId ?? null,
    source_url: a.sourceUrl ?? null,
    author: a.author ?? null,
    author_url: a.authorUrl ?? null,
    path: a.file ? path.relative(PATHS.var, a.file) : null,
    license: a.license,
    license_url: a.licenseUrl ?? null,
    commercial_ok: a.commercialOk ? 1 : 0,
    attribution: a.attribution ?? null,
    meta_json: a.meta === undefined ? null : JSON.stringify(a.meta),
    cost_eur: a.costEur ?? 0,
    sha256: a.file && fs.existsSync(a.file) ? sha256(fs.readFileSync(a.file)) : null,
    created_at: nowIso(),
  });
  return id;
}

export function linkAsset(db: Db, slideshowId: string, assetId: string, role: string): void {
  db.upsert('slideshow_assets', {slideshow_id: slideshowId, asset_id: assetId, role}, ['slideshow_id', 'asset_id', 'role']);
}

export function assetsOf(db: Db, slideshowId: string) {
  return db
    .all(
      `SELECT a.*, sa.role FROM slideshow_assets sa JOIN media_assets a ON a.id = sa.asset_id WHERE sa.slideshow_id = ? ORDER BY sa.role`,
      slideshowId,
    )
    .map((r): Record<string, any> => ({...r, meta: parseJson(r.meta_json, null), commercial_ok: !!r.commercial_ok}));
}

/** Every call to a voice, stock or AI video provider (success or failure), with its cost. */
export function logCall(db: Db, c: {provider: string; kind: string; ref?: string; ok: boolean; units?: number; unit?: string; costEur?: number; ms?: number; error?: string}): void {
  db.run(
    'INSERT INTO provider_calls(at, provider, kind, ref, ok, units, unit, cost_eur, ms, error) VALUES (?,?,?,?,?,?,?,?,?,?)',
    nowIso(),
    c.provider,
    c.kind,
    c.ref ?? null,
    c.ok ? 1 : 0,
    c.units ?? null,
    c.unit ?? null,
    c.costEur ?? 0,
    c.ms ?? null,
    c.error ? c.error.slice(0, 500) : null,
  );
}

export function providerCosts(db: Db, sinceIso?: string) {
  return db.all(
    `SELECT provider, kind, COUNT(*) AS calls, SUM(ok) AS ok, ROUND(SUM(cost_eur), 4) AS cost_eur, SUM(units) AS units, MAX(unit) AS unit, MAX(at) AS last_at
     FROM provider_calls ${sinceIso ? 'WHERE at >= ?' : ''} GROUP BY provider, kind ORDER BY provider`,
    ...(sinceIso ? [sinceIso] : []),
  );
}

/** Errors worth retrying (network, rate limit, server side); everything else fails the step at once. */
export function isTransient(e: unknown): boolean {
  const m = String((e as any)?.message ?? e);
  return /ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|fetch failed|timeout|HTTP 429|HTTP 5\d\d|temporarily|503|502|504/i.test(m);
}

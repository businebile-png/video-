import type {Db} from '../core/db.js';
import type {AppConfig} from '../core/config.js';
import {getAccount, videoSettings} from '../core/accounts.js';
import {id as newId, nowIso, parseJson, rng, sleep} from '../core/util.js';
import {choose} from '../analytics/learn.js';
import {AiRouter} from '../ai/router.js';
import {VIDEO_FORMATS, formatDef} from './formats.js';
import {isTransient} from './media.js';
import {createProject, stepMusic, stepRender, stepVisuals, stepVoice} from './produce.js';
import {runVideoQc} from './qc.js';
import {draftsForVideos} from './script.js';
import type {Aspect, DurationTarget, VideoFormatId, VisualMode} from './types.js';
import {DURATIONS} from './types.js';

/**
 * The production line. A batch = N videos for one account. Each video goes through the same steps, stored as it
 * goes (a stopped batch resumes where it was): concept + script → voice → visuals → music → edit/render → QC →
 * library (to review or approved, per account). Transient errors (network, rate limits) are retried with a
 * growing pause; a failed video never stops the batch. Paid calls are counted against the batch budget and
 * refused beyond it; only one batch runs at a time.
 */

export const STEPS = ['script', 'voix', 'visuels', 'musique', 'montage', 'controle'] as const;
export type Step = (typeof STEPS)[number];

export interface BatchRequest {
  accountId: string;
  quantity: number;
  niche?: string;
  formats?: VideoFormatId[];
  durations?: DurationTarget[];
  aspect?: Aspect;
  voice?: string;
  visuals?: VisualMode | 'auto';
  music?: 'original' | 'licence' | 'aucune';
  engine?: 'auto' | 'ai' | 'composer';
  budgetEur?: number;
  topic?: string;
  draft?: boolean;
}

/** Plan of a batch: which format and duration each video gets (learned preferences + exploration). */
export function planBatch(db: Db, req: BatchRequest): Array<{format: VideoFormatId; duration: DurationTarget}> {
  const account = getAccount(db, req.accountId);
  const vs = videoSettings(account);
  const allowed = (req.formats?.length ? req.formats : vs.formats.length ? (vs.formats as VideoFormatId[]) : (Object.keys(VIDEO_FORMATS) as VideoFormatId[])).filter((f) => VIDEO_FORMATS[f]);
  const rand = rng(`${req.accountId}:${Date.now()}`);
  const out: Array<{format: VideoFormatId; duration: DurationTarget}> = [];
  const counts = new Map<string, number>();
  for (let i = 0; i < req.quantity; i++) {
    // Thompson sampling on what worked for this account, with a penalty so one format never takes the whole batch.
    const format = choose(db, {dimension: 'video_format', values: allowed, accountId: req.accountId, rand, epsilon: 0.2, penalty: (v) => (counts.get(v) ?? 0) * 6}).value as VideoFormatId;
    counts.set(format, (counts.get(format) ?? 0) + 1);
    const def = formatDef(format);
    const wanted = (req.durations?.length ? req.durations : (vs.durations as DurationTarget[])).filter((d) => DURATIONS.includes(d));
    const fits = def.durations.filter((d) => !wanted.length || wanted.includes(d));
    const pool = fits.length ? fits : def.durations;
    out.push({format, duration: pool[Math.floor(rand() * pool.length)]});
  }
  return out;
}

export function createBatch(db: Db, req: BatchRequest): {batchId: string; jobs: number; plan: Array<{format: string; duration: number}>} {
  const account = getAccount(db, req.accountId);
  if (!videoSettings(account).enabled) throw new Error(`Vidéos désactivées pour ${account.id}`);
  if (req.quantity < 1 || req.quantity > 1000) throw new Error('Quantité entre 1 et 1000');
  const plan = planBatch(db, req);
  const batchId = newId('vb');
  const now = nowIso();
  db.tx(() => {
    db.upsert('video_batches', {id: batchId, account_id: req.accountId, niche: req.niche ?? account.niche, quantity: req.quantity, params_json: JSON.stringify(req), status: 'queued', budget_eur: req.budgetEur ?? 0, spent_eur: 0, done: 0, failed: 0, note: null, created_at: now, updated_at: now});
    plan.forEach((p, i) =>
      db.upsert('video_jobs', {id: newId('vj'), batch_id: batchId, account_id: req.accountId, slideshow_id: null, position: i, params_json: JSON.stringify(p), status: 'queued', step: null, progress: 0, attempts: 0, error: null, cost_eur: 0, log_json: '[]', started_at: null, finished_at: null, created_at: now, updated_at: now}),
    );
  });
  db.event('factory', `Lot de ${req.quantity} vidéos créé pour ${account.id}`, {ref: batchId, data: plan});
  return {batchId, jobs: plan.length, plan};
}

function jobLog(db: Db, jobId: string, line: string): void {
  const j = db.get<{log_json: string}>('SELECT log_json FROM video_jobs WHERE id = ?', jobId);
  const log = parseJson<string[]>(j?.log_json, []);
  log.push(`${nowIso().slice(11, 19)} ${line}`);
  db.run('UPDATE video_jobs SET log_json = ?, updated_at = ? WHERE id = ?', JSON.stringify(log.slice(-80)), nowIso(), jobId);
}

const LOCK = 'factory_lock';

function takeLock(db: Db, batchId: string): void {
  const lock = db.setting<{batchId: string; pid: number; at: string} | null>(LOCK, null);
  if (lock && lock.batchId !== batchId && Date.now() - Date.parse(lock.at) < 20 * 60_000) {
    let alive = false;
    try {
      process.kill(lock.pid, 0);
      alive = true;
    } catch {
      alive = false;
    }
    if (alive) throw new Error(`Un autre lot tourne déjà (${lock.batchId}) : une seule production à la fois.`);
  }
  db.setSetting(LOCK, {batchId, pid: process.pid, at: nowIso()});
}

export interface RunOptions {
  maxJobs?: number;
  workers?: number;
  fps?: number;
  log?: (line: string) => void;
}

/** Runs (or resumes) a batch until every job is done, failed or the budget is spent. */
export async function runBatch(db: Db, cfg: AppConfig, batchId: string, opts: RunOptions = {}): Promise<{done: number; failed: number; remaining: number; spentEur: number; status: string}> {
  const batch = db.get('SELECT * FROM video_batches WHERE id = ?', batchId);
  if (!batch) throw new Error(`Lot inconnu : ${batchId}`);
  if (batch.status === 'cancelled') throw new Error('Lot annulé');
  const req = parseJson<BatchRequest>(batch.params_json, {} as BatchRequest);
  const log = opts.log ?? (() => {});
  takeLock(db, batchId);
  db.run("UPDATE video_batches SET status = 'running', updated_at = ? WHERE id = ?", nowIso(), batchId);
  const router = new AiRouter(db, cfg);
  let handled = 0;
  try {
    for (;;) {
      const fresh = db.get<any>('SELECT status, spent_eur, budget_eur FROM video_batches WHERE id = ?', batchId)!;
      if (fresh.status === 'cancelled' || fresh.status === 'paused') break;
      const job = db.get("SELECT * FROM video_jobs WHERE batch_id = ? AND status IN ('queued', 'running', 'retry') ORDER BY position LIMIT 1", batchId);
      if (!job || (opts.maxJobs !== undefined && handled >= opts.maxJobs)) break;
      handled++;
      db.setSetting(LOCK, {batchId, pid: process.pid, at: nowIso()});
      await runJob(db, cfg, router, batch, req, job, opts, log);
      const counts = db.get<any>("SELECT SUM(status = 'done') AS done, SUM(status = 'failed') AS failed, ROUND(SUM(cost_eur), 4) AS spent FROM video_jobs WHERE batch_id = ?", batchId)!;
      db.run('UPDATE video_batches SET done = ?, failed = ?, spent_eur = ?, updated_at = ? WHERE id = ?', counts.done ?? 0, counts.failed ?? 0, counts.spent ?? 0, nowIso(), batchId);
    }
  } finally {
    db.setSetting(LOCK, null);
  }
  const c = db.get<any>("SELECT SUM(status = 'done') AS done, SUM(status = 'failed') AS failed, SUM(status IN ('queued', 'running', 'retry')) AS remaining, ROUND(SUM(cost_eur), 4) AS spent FROM video_jobs WHERE batch_id = ?", batchId)!;
  const cur = db.get<any>('SELECT status FROM video_batches WHERE id = ?', batchId)!.status;
  const status = cur === 'cancelled' || cur === 'paused' ? cur : c.remaining > 0 ? 'queued' : 'done';
  db.run('UPDATE video_batches SET status = ?, done = ?, failed = ?, spent_eur = ?, updated_at = ? WHERE id = ?', status, c.done ?? 0, c.failed ?? 0, c.spent ?? 0, nowIso(), batchId);
  return {done: c.done ?? 0, failed: c.failed ?? 0, remaining: c.remaining ?? 0, spentEur: c.spent ?? 0, status};
}

async function runJob(db: Db, cfg: AppConfig, router: AiRouter, batch: any, req: BatchRequest, job: any, opts: RunOptions, log: (l: string) => void): Promise<void> {
  const p = parseJson<{format: VideoFormatId; duration: DurationTarget}>(job.params_json, {} as any);
  const set = (fields: Record<string, unknown>) => {
    const keys = Object.keys(fields);
    db.run(`UPDATE video_jobs SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, ...Object.values(fields), nowIso(), job.id);
  };
  set({status: 'running', started_at: job.started_at ?? nowIso()});
  let slideshowId: string | null = job.slideshow_id;
  const step = async (name: Step, progress: number, fn: () => Promise<string | void> | string | void) => {
    const already = parseJson<string[]>(db.get('SELECT log_json FROM video_jobs WHERE id = ?', job.id)?.log_json, []).some((l) => l.includes(`✓ ${name}`));
    if (already && name !== 'controle') return;
    set({step: name, progress});
    for (let attempt = 1; ; attempt++) {
      try {
        const t0 = Date.now();
        const note = await fn();
        jobLog(db, job.id, `✓ ${name}${note ? ` — ${note}` : ''} (${Math.round((Date.now() - t0) / 1000)} s)`);
        return;
      } catch (e) {
        const transient = isTransient(e);
        jobLog(db, job.id, `✗ ${name} (essai ${attempt}) : ${(e as Error).message}`);
        if (!transient || attempt >= 3) throw e;
        set({attempts: (db.get('SELECT attempts FROM video_jobs WHERE id = ?', job.id)?.attempts ?? 0) + 1, status: 'retry'});
        await sleep(2000 * 2 ** attempt);
        set({status: 'running'});
      }
    }
  };
  try {
    await step('script', 0.05, async () => {
      if (slideshowId) return 'déjà écrit';
      const account = getAccount(db, req.accountId);
      const got = await draftsForVideos(db, cfg, {account, format: p.format, duration: p.duration, quantity: 1, seed: `${job.id}`, topic: req.topic, engine: req.engine}, router);
      const d = got.drafts[0];
      if (!d) throw new Error(`plus de contenu vérifié inédit pour le format ${formatDef(p.format).label} sur ce compte (aucune répétition autorisée)`);
      slideshowId = createProject(db, cfg, d, {format: p.format, duration: p.duration, aspect: req.aspect, voice: req.voice, visuals: req.visuals, music: req.music, seed: job.id});
      set({slideshow_id: slideshowId});
      return `${d.hook} (${got.engine})`;
    });
    const id = slideshowId!;
    await step('voix', 0.2, () => stepVoice(db, id));
    await step('visuels', 0.35, async () => {
      const spent = db.get<any>('SELECT spent_eur, budget_eur FROM video_batches WHERE id = ?', batch.id)!;
      if ((spent.budget_eur ?? 0) <= spent.spent_eur) process.env.VIRAL_AI_VIDEO = '0';
      return stepVisuals(db, cfg, id);
    });
    await step('musique', 0.45, () => stepMusic(db, id));
    await step('montage', 0.5, async () => {
      const r = await stepRender(db, cfg, id, {fps: opts.fps, workers: opts.workers, draft: req.draft, onProgress: (d, t) => d % 30 === 0 && set({progress: 0.5 + 0.42 * (d / t)})});
      return `${r.duration.toFixed(1)} s, ${r.frames} images, ${(r.ms / 1000).toFixed(0)} s de rendu, ${r.lufs} LUFS`;
    });
    await step('controle', 0.95, () => {
      const q = runVideoQc(db, cfg, id);
      if (!q.ok) throw new Error(`contrôle qualité : ${q.errors.map((e) => e.message).join(' ; ')}`);
      return `contrôle réussi (${q.score}/100, ${q.warnings.length} remarque(s))`;
    });
    const cost = db.get("SELECT ROUND(COALESCE(SUM(cost_eur), 0), 4) AS c FROM provider_calls WHERE ref = ?", id)?.c ?? 0;
    set({status: 'done', progress: 1, finished_at: nowIso(), cost_eur: cost, error: null});
    log(`✓ ${id} prête`);
  } catch (e) {
    const cost = slideshowId ? (db.get("SELECT ROUND(COALESCE(SUM(cost_eur), 0), 4) AS c FROM provider_calls WHERE ref = ?", slideshowId)?.c ?? 0) : 0;
    set({status: 'failed', error: (e as Error).message.slice(0, 500), finished_at: nowIso(), cost_eur: cost});
    log(`✗ vidéo ${job.position + 1} : ${(e as Error).message}`);
  }
}

export function cancelBatch(db: Db, batchId: string): void {
  db.run("UPDATE video_batches SET status = 'cancelled', updated_at = ? WHERE id = ?", nowIso(), batchId);
  db.run("UPDATE video_jobs SET status = 'cancelled', updated_at = ? WHERE batch_id = ? AND status IN ('queued', 'retry')", nowIso(), batchId);
}

export function retryFailed(db: Db, batchId: string): number {
  return db.run("UPDATE video_jobs SET status = 'queued', error = NULL, updated_at = ? WHERE batch_id = ? AND status = 'failed'", nowIso(), batchId).changes;
}

export function batchStatus(db: Db, batchId?: string): any[] {
  const batches = batchId ? db.all('SELECT * FROM video_batches WHERE id = ?', batchId) : db.all('SELECT * FROM video_batches ORDER BY created_at DESC LIMIT 20');
  return batches.map((b): any => ({
    ...b,
    params: parseJson(b.params_json, {}),
    jobs: db.all('SELECT id, position, slideshow_id, status, step, progress, attempts, error, cost_eur, log_json, started_at, finished_at FROM video_jobs WHERE batch_id = ? ORDER BY position', b.id).map((j): any => ({...j, log: parseJson<string[]>(j.log_json, [])})),
  }));
}

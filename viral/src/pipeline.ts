import fs from 'node:fs';
import path from 'node:path';
import type {Db} from './core/db.js';
import type {AppConfig} from './core/config.js';
import {listAccounts, syncAccountsFromConfig} from './core/accounts.js';
import {PATHS, ensureDir} from './core/paths.js';
import {id as newId, nowIso} from './core/util.js';
import {generate} from './generate/generate.js';
import {renderMany} from './render/renderer.js';
import {runQc, type QcReport} from './qc/qc.js';
import {importFile} from './intel/collectors/importers.js';
import {savePosts} from './intel/store.js';
import {refreshIntelligence, syncMeta, syncZernio} from './analytics/sync.js';
import {autoSchedule} from './publish/scheduler.js';
import {runDue} from './publish/runner.js';
import {AiRouter} from './ai/router.js';

/** Render + quality control for a list of slideshows; returns a compact summary. */
export async function processSlideshows(db: Db, cfg: AppConfig, ids: string[], onProgress?: (msg: string) => void) {
  const rendered = await renderMany(db, cfg, ids, (d, t, r) => onProgress?.(`rendu ${d}/${t}${r instanceof Error ? ` : erreur ${r.message}` : ''}`));
  const qc: Record<string, QcReport> = {};
  for (const id of ids) qc[id] = runQc(db, cfg, id);
  const passed = Object.values(qc).filter((r) => r.ok).length;
  return {rendered: rendered.length, passed, failed: ids.length - passed, qc};
}

/** Imports every new file dropped in var/imports (exports written by Claude sessions or other tools). */
export function ingestImportsFolder(db: Db, cfg: AppConfig): Array<{file: string; kind: string; inserted: number; updated: number}> {
  ensureDir(PATHS.imports);
  const done = new Set(db.setting<string[]>('imports.done', []));
  const out: Array<{file: string; kind: string; inserted: number; updated: number}> = [];
  for (const f of fs.readdirSync(PATHS.imports).filter((x) => /\.(json|jsonl|csv)$/.test(x)).sort()) {
    const full = path.join(PATHS.imports, f);
    const key = `${f}:${fs.statSync(full).size}`;
    if (done.has(key)) continue;
    try {
      const {kind, posts} = importFile(full, listAccounts(db));
      const r = savePosts(db, posts);
      out.push({file: f, kind, inserted: r.inserted, updated: r.updated});
      done.add(key);
    } catch (e) {
      db.event('import', `Import impossible (${f}) : ${(e as Error).message}`, {level: 'error'});
    }
  }
  db.setSetting('imports.done', [...done]);
  return out;
}

export interface PipelineOptions {
  perAccount: number;
  accounts?: string[];
  publish?: boolean;
  dryRun?: boolean;
  log?: (msg: string) => void;
}

/**
 * One full turn of the loop: ANALYSER → COMPRENDRE → GÉNÉRER → (contrôler) → PROGRAMMER → PUBLIER → MESURER → OPTIMISER.
 * Safe to run on a schedule: limits, approvals and QC gates apply at every step.
 */
export async function runPipeline(db: Db, cfg: AppConfig, opts: PipelineOptions) {
  const log = opts.log ?? (() => {});
  const runId = newId('run');
  db.upsert('runs', {id: runId, kind: 'pipeline', started_at: nowIso(), status: 'running', summary_json: null});
  const summary: any = {};
  try {
    syncAccountsFromConfig(db, cfg);
    log('1. Analyser : imports et collecte');
    summary.imports = ingestImportsFolder(db, cfg);
    if (process.env.ZERNIO_API_KEY) summary.zernio = await syncZernio(db, cfg).catch((e) => ({error: (e as Error).message}));
    if (process.env.INSTAGRAM_ACCESS_TOKEN || process.env.THREADS_ACCESS_TOKEN) summary.meta = await syncMeta(db, cfg).catch((e) => ({error: (e as Error).message}));
    log('2. Comprendre : scores, mécanismes, tendances, apprentissage');
    summary.intel = refreshIntelligence(db, cfg);
    log('3. Générer');
    const router = new AiRouter(db, cfg);
    const accounts = listAccounts(db, true).filter((a) => !opts.accounts || opts.accounts.includes(a.id));
    const ids: string[] = [];
    summary.generate = [];
    for (const a of accounts) {
      const r = await generate(db, cfg, {accountId: a.id, quantity: opts.perAccount}, router);
      ids.push(...r.slideshowIds);
      summary.generate.push({account: a.id, engine: r.engine, count: r.slideshowIds.length, notes: r.notes});
    }
    log(`4. Rendre et contrôler ${ids.length} carrousels`);
    const processed = await processSlideshows(db, cfg, ids, log);
    summary.qc = {rendered: processed.rendered, passed: processed.passed, failed: processed.failed};
    log('5. Programmer (comptes sans validation humaine ou déjà validés)');
    summary.scheduled = autoSchedule(db, cfg, {horizonDays: 14});
    if (opts.publish) {
      log('6. Publier ce qui est dû');
      summary.publish = await runDue(db, cfg, {dryRun: opts.dryRun});
    }
    db.run("UPDATE runs SET status = 'ok', finished_at = ?, summary_json = ? WHERE id = ?", nowIso(), JSON.stringify(summary), runId);
  } catch (e) {
    db.run("UPDATE runs SET status = 'error', finished_at = ?, summary_json = ? WHERE id = ?", nowIso(), JSON.stringify({...summary, error: (e as Error).message}), runId);
    throw e;
  }
  return {runId, ...summary};
}

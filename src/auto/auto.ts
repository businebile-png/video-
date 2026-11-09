import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {PATHS, runPaths} from '../core/paths.js';
import {exists, readJson, readJsonIfExists, writeJson} from '../core/fsx.js';
import {loadConfig, loadEditorial} from '../core/config.js';
import {upsertHistory} from '../core/stores.js';
import {runOrThrow} from '../core/exec.js';
import {createPlan} from '../editorial/plan.js';
import {nextSlots} from '../publish/publish.js';
import {writeScript} from './writer.js';
import {correctionNotes, reviewWithLlm} from './reviewer.js';
import {chooseFootageWithLlm} from './footage.js';
import {log} from '../core/log.js';
import type {ScoreReport} from '../qc/score.js';

/**
 * Production without Claude (GitHub Actions, free AI): the same studio commands as a Claude session, in the
 * same order, with the same locks. A video that reaches the threshold goes to `queue/<runId>.json` (public
 * repository) with its publication slot; the scheduling task only has to hand it to Metricool.
 */

export const QUEUE_DIR = path.join(PATHS.root, 'queue');

/** Run one studio command in a child process, its output streamed to the job log. */
function studio(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(PATHS.root, 'node_modules', 'tsx', 'dist', 'cli.mjs'), path.join(PATHS.root, 'src', 'cli.ts'), ...args], {cwd: PATHS.root, stdio: 'inherit', env: process.env});
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`« ${args.join(' ')} » a échoué (code ${code})`))));
  });
}

interface QueueEntry {
  runId: string;
  autoSlot: {iso: string; label: string};
  [k: string]: unknown;
}

export function queueEntries(): QueueEntry[] {
  if (!fs.existsSync(QUEUE_DIR)) return [];
  return fs
    .readdirSync(QUEUE_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(QUEUE_DIR, f), 'utf8')) as QueueEntry);
}

/** First publication time at least 2 h away that no queued video holds. */
export function pickSlot(slots: Array<{iso: string; label: string}>, taken: string[], now = new Date()): {iso: string; label: string} | null {
  const seen = new Set<string>();
  for (const s of slots) {
    if (seen.has(s.iso)) continue;
    seen.add(s.iso);
    if (Date.parse(s.iso) - now.getTime() < 2 * 3_600_000) continue;
    if (taken.some((t) => Date.parse(t) === Date.parse(s.iso))) continue;
    return {iso: s.iso, label: s.label};
  }
  return null;
}

/**
 * Remove what Metricool no longer needs: queued videos whose slot is over by 6 hours (scheduled or missed)
 * and their MP4 (it carries the user's song, which must not stay in the public repository).
 */
export async function cleanQueue(now = new Date()): Promise<string[]> {
  const removed: string[] = [];
  for (const e of queueEntries()) {
    if (now.getTime() - Date.parse(e.autoSlot.iso) < 6 * 3_600_000) continue;
    for (const f of [path.join(QUEUE_DIR, `${e.runId}.json`), path.join(PATHS.root, 'videos', `${e.runId}.mp4`), path.join(PATHS.root, 'videos', `${e.runId}.jpg`)]) {
      if (fs.existsSync(f)) {
        await runOrThrow('git', ['rm', '-q', '--', path.relative(PATHS.root, f)], {cwd: PATHS.root});
        removed.push(path.relative(PATHS.root, f));
      }
    }
  }
  return removed;
}

/** Voice, then the shots chosen by eye on the contact sheets (as a Claude session did), then the rest of the studio. */
async function produceVideo(runId: string): Promise<void> {
  await studio(['voice', runId]);
  await studio(['footage:search', runId]);
  try {
    await chooseFootageWithLlm(runId);
  } catch (e) {
    log.warn(`Choix des plans par l’IA impossible (${(e as Error).message.slice(0, 160)}) : classement automatique.`);
  }
  await studio(['produce', runId]);
}

export interface AutoResult {
  runId: string;
  status: 'prete' | 'bloquee';
  score: number | null;
  slot: {iso: string; label: string} | null;
  message: string;
}

export async function autoProduce(opts: {maxCorrections?: number; musicFile?: string | null} = {}): Promise<AutoResult> {
  const config = await loadConfig();
  const editorial = await loadEditorial();
  const maxCorrections = opts.maxCorrections ?? 2;

  // Facts: re-read the official pages; a fact whose excerpt disappeared can no longer be cited (the lint refuses it).
  try {
    await studio(['facts:refresh']);
    await studio(['facts:verify']);
  } catch (e) {
    log.warn(`Faits non rafraîchis (${(e as Error).message}) : seuls les faits encore valides seront cités.`);
  }

  const taken = queueEntries().map((e) => e.autoSlot.iso);
  const slot = pickSlot(nextSlots(config, new Date(), 3).filter((s) => s.network === 'tiktok'), taken);
  const plan = await createPlan(config, editorial);
  const runId = plan.runId;
  const p = runPaths(runId);
  await upsertHistory({runId, date: plan.date, category: plan.category.id, artDirection: plan.artDirection, voiceId: plan.voiceId, status: 'created'});
  log.ok(`Production ${runId} (${plan.category.label}) pour ${slot?.label ?? 'le prochain créneau libre'}`);

  await writeScript(runId);
  await produceVideo(runId);
  let report: ScoreReport | null = null;
  for (let round = 0; ; round++) {
    await reviewWithLlm(runId);
    await studio(['score', runId]);
    report = await readJson<ScoreReport>(p.score);
    if (report.decision === 'publishable') break;
    if (round >= maxCorrections) {
      const message = `Vidéo ${runId} non publiée : ${report.summary}`;
      await upsertHistory({runId, status: 'rejected', reason: report.summary});
      log.warn(message);
      return {runId, status: 'bloquee', score: report.total, slot: null, message};
    }
    log.info(`Correction ${round + 1}/${maxCorrections} : ${report.summary}`);
    await writeScript(runId, {notes: await correctionNotes(runId)});
    await fsp.rm(p.footageSelection, {force: true});
    await produceVideo(runId);
  }

  // The user's song, under the voice, a different excerpt each time; dropped if the mix breaks a check.
  let music: {title: string; start: number; end: number} | null = null;
  if (opts.musicFile && fs.existsSync(opts.musicFile) && config.music.userTrack) {
    await studio(['music:overlay', runId, '--file', opts.musicFile]);
    await studio(['qc', runId]);
    await studio(['score', runId]);
    report = await readJson<ScoreReport>(p.score);
    if (report.decision !== 'publishable') {
      log.warn('Le mixage avec la musique fait échouer un contrôle : la vidéo part sans musique.');
      await fsp.copyFile(path.join(p.renderDir, 'final-sans-musique.mp4'), p.final);
      await fsp.rm(path.join(p.dir, 'music', 'overlay.json'), {force: true});
      await studio(['qc', runId]);
      await studio(['score', runId]);
      report = await readJson<ScoreReport>(p.score);
    } else {
      const ov = await readJson<{title: string; start: number; end: number}>(path.join(p.dir, 'music', 'overlay.json'));
      music = {title: ov.title, start: ov.start, end: ov.end};
    }
  }
  if (report.decision !== 'publishable') {
    const message = `Vidéo ${runId} non publiée : ${report.summary}`;
    await upsertHistory({runId, status: 'rejected', reason: report.summary});
    return {runId, status: 'bloquee', score: report.total, slot: null, message};
  }

  await studio(['publish:prepare', runId, '--networks', 'tiktok,instagram']);
  await studio(['media:push', runId]);
  const media = await readJson<{publicUrl: string; coverUrl: string; verified: boolean | null}>(path.join(p.publishDir, 'media.json'));
  if (media.verified === false) throw new Error(`Vidéo en ligne injoignable : ${media.publicUrl}`);
  await studio(['panel:export', runId, '--preview-url', media.publicUrl, '--cover-url', media.coverUrl]);
  const doc = await readJson<Record<string, unknown>>(path.join(p.dir, 'panel', 'video.json'));
  const review = await readJsonIfExists<{model?: string}>(p.review, {});
  const finalSlot = slot ?? pickSlot(nextSlots(config, new Date(), 4).filter((s) => s.network === 'tiktok'), taken);
  if (!finalSlot) throw new Error('Aucun créneau libre dans les 4 prochains jours.');
  const entry = {
    ...doc,
    status: 'prete',
    autoSlot: finalSlot,
    music,
    producedBy: {pipeline: 'github-actions', writer: process.env.STUDIO_LLM_MODEL || 'gemini-2.5-flash', reviewer: review.model ?? null},
    queuedAt: new Date().toISOString(),
  };
  await fsp.mkdir(QUEUE_DIR, {recursive: true});
  await writeJson(path.join(QUEUE_DIR, `${runId}.json`), entry);
  await upsertHistory({runId, status: 'rendered', score: report.total, decision: report.decision, reason: null});
  const message = `Vidéo « ${String(doc.title ?? runId)} » prête : ${report.total}/100, publication prévue ${finalSlot.label}.`;
  log.ok(message);
  return {runId, status: 'prete', score: report.total, slot: finalSlot, message};
}

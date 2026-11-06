import {runPaths} from './paths.js';
import {exists, readJsonIfExists, writeJson} from './fsx.js';
import {attachRunLog, log} from './log.js';

export type StepName =
  | 'plan'
  | 'script'
  | 'voice'
  | 'footage-search'
  | 'footage-select'
  | 'footage-fetch'
  | 'music'
  | 'timeline'
  | 'render'
  | 'qc'
  | 'score'
  | 'publish-prepare'
  | 'panel-export';

export interface StepState {
  status: 'running' | 'done' | 'failed' | 'skipped';
  at: string;
  attempts: number;
  note?: string;
  error?: string;
}

export interface RunState {
  runId: string;
  createdAt: string;
  seed: number;
  steps: Partial<Record<StepName, StepState>>;
}

export async function loadState(runId: string): Promise<RunState> {
  const p = runPaths(runId);
  if (!exists(p.state)) throw new Error(`Production inconnue : ${runId} (lancer « npm run studio -- new » d’abord).`);
  return readJsonIfExists<RunState>(p.state, {runId, createdAt: new Date().toISOString(), seed: 1, steps: {}});
}

export async function saveState(state: RunState): Promise<void> {
  await writeJson(runPaths(state.runId).state, state);
}

/**
 * Wrap a production step: logs, records success/failure in state.json so a
 * failed run can be resumed from the failing step instead of starting over.
 */
export async function step<T>(runId: string, name: StepName, fn: () => Promise<T>, note?: (r: T) => string): Promise<T> {
  const p = runPaths(runId);
  attachRunLog(p.logs);
  const state = await loadState(runId);
  const prev = state.steps[name];
  state.steps[name] = {status: 'running', at: new Date().toISOString(), attempts: (prev?.attempts ?? 0) + 1};
  await saveState(state);
  log.step(`${name} — ${runId}`);
  try {
    const result = await fn();
    const fresh = await loadState(runId);
    fresh.steps[name] = {status: 'done', at: new Date().toISOString(), attempts: state.steps[name]!.attempts, note: note?.(result)};
    await saveState(fresh);
    return result;
  } catch (err) {
    const fresh = await loadState(runId);
    fresh.steps[name] = {status: 'failed', at: new Date().toISOString(), attempts: state.steps[name]!.attempts, error: (err as Error).message.slice(0, 2000)};
    await saveState(fresh);
    log.error(`${name} a échoué : ${(err as Error).message}`);
    throw err;
  }
}

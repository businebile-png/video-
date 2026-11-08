import fs from 'node:fs';
import {runPaths} from './paths.js';
import {readJsonIfExists} from './fsx.js';
import {loadState, saveState, type RunState, type StepName} from './run.js';

/**
 * How far a production (or one of its corrections) has gone, computed from what is really on disk:
 * the steps recorded in state.json, the script check and the independent review. The production writes
 * this payload to its panel journal after every studio command, so the percentage moves on its own.
 */

export const CORRECTION_STEPS = ['script', 'voice', 'footage', 'edit', 'render', 'qc', 'review', 'score'] as const;
export type CorrectionStep = (typeof CORRECTION_STEPS)[number];

export const STEP_LABELS: Record<CorrectionStep, string> = {
  script: 'Script',
  voice: 'Voix',
  footage: 'Plans vidéo',
  edit: 'Montage',
  render: 'Rendu',
  qc: 'Contrôle technique',
  review: 'Relecture indépendante',
  score: 'Note',
};

/** Share of a correction's time each step takes (the voice and the review are the long ones). */
const WEIGHTS: Record<CorrectionStep, number> = {script: 5, voice: 30, footage: 10, edit: 10, render: 15, qc: 5, review: 20, score: 5};

const STATE_STEP: Partial<Record<CorrectionStep, StepName>> = {voice: 'voice', footage: 'footage-fetch', edit: 'timeline', render: 'render', qc: 'qc', score: 'score'};

export interface CorrectionState {
  attempt: number;
  max: number;
  startedAt: string;
  lastScore: number | null;
  steps: CorrectionStep[];
  reason?: string;
}

export type RunStateWithCorrection = RunState & {correction?: CorrectionState};

export interface JournalProgress {
  progress: number;
  stage: string;
  updatedAt: string;
  correction?: {
    attempt: number;
    max: number;
    progress: number;
    step: string;
    lastScore: number | null;
    startedAt: string;
    steps: Array<{id: CorrectionStep; label: string; done: boolean; running: boolean}>;
  } | null;
}

function mtime(file: string): number {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

function stepStatus(state: RunState, runId: string, s: CorrectionStep, since: number): {done: boolean; running: boolean} {
  const p = runPaths(runId);
  if (s === 'script') return {done: mtime(p.lint) > since, running: false};
  if (s === 'review') return {done: mtime(`${p.qcDir}/review.json`) > since, running: false};
  const st = state.steps[STATE_STEP[s]!];
  const at = st ? Date.parse(st.at) : 0;
  return {done: Boolean(st && st.status === 'done' && at > since), running: Boolean(st && st.status === 'running' && at > since)};
}

/** Start (or start the next) correction of a production: what will be redone, and the score it starts from. */
export async function startCorrection(runId: string, opts: {score?: number | null; steps?: CorrectionStep[]; reason?: string; max?: number} = {}): Promise<CorrectionState> {
  const state = (await loadState(runId)) as RunStateWithCorrection;
  const p = runPaths(runId);
  const scored = await readJsonIfExists<{total?: number} | null>(`${p.qcDir}/score.json`, null);
  const correction: CorrectionState = {
    attempt: (state.correction?.attempt ?? 0) + 1,
    max: opts.max ?? state.correction?.max ?? 3,
    startedAt: new Date().toISOString(),
    lastScore: opts.score ?? scored?.total ?? state.correction?.lastScore ?? null,
    steps: opts.steps?.length ? opts.steps : [...CORRECTION_STEPS],
    reason: opts.reason,
  };
  state.correction = correction;
  await saveState(state);
  return correction;
}

/** The journal fields (progress, stage, correction) for a production, from what is on disk now. */
export async function journalProgress(runId: string): Promise<JournalProgress> {
  const state = (await loadState(runId)) as RunStateWithCorrection;
  const now = new Date().toISOString();
  const c = state.correction;
  if (c) {
    const since = Date.parse(c.startedAt);
    const steps = c.steps.map((id) => ({id, label: STEP_LABELS[id], ...stepStatus(state, runId, id, since)}));
    const total = steps.reduce((n, s) => n + WEIGHTS[s.id], 0) || 1;
    // A step under way counts for 40 % of its share: the bar moves as soon as the long voice step starts.
    const done = steps.reduce((n, s) => n + (s.done ? WEIGHTS[s.id] : s.running ? WEIGHTS[s.id] * 0.4 : 0), 0);
    const allDone = steps.every((s) => s.done);
    const pct = allDone ? 100 : Math.min(99, Math.round((done / total) * 100));
    const current = steps.find((s) => !s.done);
    const step = current ? current.label : 'Terminée';
    return {
      progress: Math.min(95, 80 + (c.attempt - 1) * 5 + Math.round(pct / 20)),
      stage: current ? `Correction ${c.attempt}/${c.max} : ${current.label.toLowerCase()}` : `Correction ${c.attempt}/${c.max} terminée`,
      updatedAt: now,
      correction: {attempt: c.attempt, max: c.max, progress: pct, step, lastScore: c.lastScore, startedAt: c.startedAt, steps},
    };
  }
  // First pass: the milestones the panel already knows (25 script … 97 deposited).
  const s = state.steps;
  const doneStep = (n: StepName) => s[n]?.status === 'done';
  const milestones: Array<[boolean, number, string]> = [
    [doneStep('panel-export'), 97, 'Dépôt dans le panneau'],
    [doneStep('score'), 90, 'Relecture et note'],
    [doneStep('qc'), 78, 'Contrôle technique'],
    [doneStep('render'), 72, 'Montage et rendu'],
    [doneStep('timeline'), 62, 'Montage'],
    [doneStep('footage-fetch'), 55, 'Plans vidéo'],
    [doneStep('voice'), 45, 'Voix'],
    [mtime(runPaths(runId).lint) > 0, 25, 'Script'],
  ];
  const reached = milestones.find(([ok]) => ok);
  const running = (Object.entries(s) as Array<[StepName, {status: string}]>).find(([, v]) => v.status === 'running');
  const runningLabel: Partial<Record<StepName, string>> = {voice: 'Voix', 'footage-fetch': 'Plans vidéo', 'footage-search': 'Recherche de plans', timeline: 'Montage', render: 'Rendu', qc: 'Contrôle technique', score: 'Note', 'publish-prepare': 'Légendes et créneaux', 'panel-export': 'Dépôt dans le panneau'};
  return {
    progress: reached ? reached[1] : 15,
    stage: running ? `${runningLabel[running[0]] ?? running[0]} en cours` : reached ? reached[2] : 'Préparation',
    updatedAt: now,
    correction: null,
  };
}

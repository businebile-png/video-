import fs from 'node:fs';
import path from 'node:path';
import {afterAll, describe, expect, it} from 'vitest';
import {runPaths} from '../src/core/paths.js';
import {journalProgress, startCorrection} from '../src/core/progress.js';

const ID = 'test-progress-vitest';
const p = runPaths(ID);
const iso = (minutes: number) => new Date(Date.now() + minutes * 60000).toISOString();

function writeState(steps: Record<string, {status: string; at: string; attempts: number}>, extra: Record<string, unknown> = {}) {
  fs.mkdirSync(p.qcDir, {recursive: true});
  const prev = fs.existsSync(p.state) ? JSON.parse(fs.readFileSync(p.state, 'utf8')) : {};
  fs.writeFileSync(p.state, JSON.stringify({...prev, runId: ID, createdAt: iso(-90), seed: 1, steps, ...extra}));
}

afterAll(() => fs.rmSync(path.dirname(p.state), {recursive: true, force: true}));

describe('avancement dans le journal', () => {
  it('suit la première version par grandes étapes', async () => {
    writeState({voice: {status: 'done', at: iso(-60), attempts: 1}, 'footage-fetch': {status: 'running', at: iso(-1), attempts: 1}});
    const j = await journalProgress(ID);
    expect(j.progress).toBe(45);
    expect(j.stage).toBe('Plans vidéo en cours');
    expect(j.correction).toBeNull();
  });

  it('fait avancer une correction à chaque étape refaite, la note de départ en tête', async () => {
    writeState({voice: {status: 'done', at: iso(-60), attempts: 1}, render: {status: 'done', at: iso(-40), attempts: 1}, score: {status: 'done', at: iso(-20), attempts: 1}});
    fs.writeFileSync(path.join(p.qcDir, 'score.json'), JSON.stringify({total: 71}));
    const c = await startCorrection(ID, {steps: ['voice', 'edit', 'render', 'qc', 'review', 'score']});
    expect(c.attempt).toBe(1);
    expect(c.lastScore).toBe(71);
    let j = await journalProgress(ID);
    expect(j.correction!.progress).toBe(0);
    expect(j.stage).toBe('Correction 1/3 : voix');
    // The voice is being redone: the bar already moves.
    const state = JSON.parse(fs.readFileSync(p.state, 'utf8'));
    state.steps.voice = {status: 'running', at: iso(1), attempts: 2};
    fs.writeFileSync(p.state, JSON.stringify(state));
    j = await journalProgress(ID);
    expect(j.correction!.progress).toBeGreaterThan(0);
    // Voice done, montage done: further along, next step named; earlier steps (before the correction) do not count.
    state.steps.voice = {status: 'done', at: iso(2), attempts: 2};
    state.steps.timeline = {status: 'done', at: iso(3), attempts: 2};
    fs.writeFileSync(p.state, JSON.stringify(state));
    j = await journalProgress(ID);
    expect(j.correction!.steps.filter((s) => s.done).map((s) => s.id)).toEqual(['voice', 'edit']);
    expect(j.correction!.step).toBe('Rendu');
    expect(j.progress).toBeGreaterThanOrEqual(80);
    expect(j.progress).toBeLessThanOrEqual(95);
    // A second correction starts from the new score and counts again from zero (what was done before it no longer counts).
    state.steps.voice.at = iso(-1);
    state.steps.timeline.at = iso(-1);
    fs.writeFileSync(p.state, JSON.stringify(state));
    fs.utimesSync(path.join(p.qcDir, 'score.json'), new Date(Date.now() - 60000), new Date(Date.now() - 60000));
    const c2 = await startCorrection(ID, {score: 76});
    expect(c2.attempt).toBe(2);
    j = await journalProgress(ID);
    expect(j.correction!.progress).toBe(0);
    expect(j.correction!.lastScore).toBe(76);
  });
});

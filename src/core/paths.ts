import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Repository root (two levels above src/core). */
export const ROOT = path.resolve(here, '..', '..');

export const PATHS = {
  root: ROOT,
  config: path.join(ROOT, 'config', 'studio.json'),
  editorial: path.join(ROOT, 'config', 'editorial.json'),
  data: path.join(ROOT, 'data'),
  history: path.join(ROOT, 'data', 'history.json'),
  publications: path.join(ROOT, 'data', 'publications.json'),
  footageUsage: path.join(ROOT, 'data', 'footage-usage.json'),
  metrics: path.join(ROOT, 'data', 'metrics.json'),
  affiliate: path.join(ROOT, 'data', 'affiliate.json'),
  panelInbox: path.join(ROOT, 'data', 'panel'),
  insights: path.join(ROOT, 'data', 'insights.json'),
  statsDir: path.join(ROOT, 'data', 'stats'),
  factsDb: path.join(ROOT, 'data', 'facts', 'systeme-io.json'),
  factsSources: path.join(ROOT, 'data', 'facts', 'sources.json'),
  factsSnapshots: path.join(ROOT, 'data', 'facts', 'snapshots'),
  archive: path.join(ROOT, 'data', 'archive'),
  capturesDir: path.join(ROOT, 'assets', 'systeme'),
  capturesManifest: path.join(ROOT, 'assets', 'systeme', 'manifest.json'),
  musicDir: path.join(ROOT, 'assets', 'music'),
  musicManifest: path.join(ROOT, 'assets', 'music', 'manifest.json'),
  sfxDir: path.join(ROOT, 'assets', 'sfx'),
  runs: path.join(ROOT, 'runs'),
  cache: path.join(ROOT, '.cache'),
  remotionEntry: path.join(ROOT, 'remotion', 'index.ts'),
  remotionDir: path.join(ROOT, 'remotion'),
  dashboard: path.join(ROOT, 'dashboard', 'index.html'),
  mediaStaging: path.join(ROOT, 'media-staging'),
} as const;

export function runDir(runId: string): string {
  if (!/^[a-z0-9][a-z0-9-]{2,80}$/.test(runId)) {
    throw new Error(`Identifiant de production invalide : « ${runId} » (lettres minuscules, chiffres et tirets uniquement).`);
  }
  return path.join(PATHS.runs, runId);
}

/** Well-known file locations inside a run directory. */
export function runPaths(runId: string) {
  const dir = runDir(runId);
  return {
    dir,
    state: path.join(dir, 'state.json'),
    logs: path.join(dir, 'logs.jsonl'),
    plan: path.join(dir, 'plan.json'),
    planMd: path.join(dir, 'plan.md'),
    script: path.join(dir, 'script.json'),
    lint: path.join(dir, 'script-lint.json'),
    voiceDir: path.join(dir, 'voice'),
    voiceReport: path.join(dir, 'voice', 'report.json'),
    voiceWords: path.join(dir, 'voice', 'words.json'),
    voiceWav: path.join(dir, 'voice', 'voice.wav'),
    footageDir: path.join(dir, 'footage'),
    footageCandidates: path.join(dir, 'footage', 'candidates.json'),
    footageSelection: path.join(dir, 'footage', 'selection.json'),
    footageLicenses: path.join(dir, 'footage', 'licenses.json'),
    musicDir: path.join(dir, 'music'),
    musicChoice: path.join(dir, 'music', 'choice.json'),
    timeline: path.join(dir, 'timeline.json'),
    publicDir: path.join(dir, 'public'),
    renderDir: path.join(dir, 'render'),
    rawRender: path.join(dir, 'render', 'raw.mp4'),
    final: path.join(dir, 'render', 'final.mp4'),
    cover: path.join(dir, 'render', 'cover.jpg'),
    qcDir: path.join(dir, 'qc'),
    qcTechnical: path.join(dir, 'qc', 'technical.json'),
    review: path.join(dir, 'qc', 'review.json'),
    score: path.join(dir, 'qc', 'score.json'),
    publishDir: path.join(dir, 'publish'),
  };
}

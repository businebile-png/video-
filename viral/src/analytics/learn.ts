import type {Db} from '../core/db.js';
import {gaussian} from '../core/util.js';
import {parseJson} from '../core/util.js';
import {hourBucket, slideBucket} from '../intel/features.js';

/**
 * Virality feedback loop: what our OWN publications teach us.
 * Every own post with a score feeds per-dimension statistics (Welford mean / variance), globally and per account.
 * The generator and the scheduler then choose with Thompson sampling: the observed mean, pulled toward a prior
 * (the market pattern for that value, else 50) when we have few posts, plus an exploration bonus that shrinks
 * as evidence grows. ANALYSER → COMPRENDRE → GÉNÉRER → PUBLIER → MESURER → OPTIMISER.
 */

export const LEARN_DIMENSIONS = ['topic', 'structure', 'hook_type', 'template', 'slides', 'hour', 'weekday', 'cta', 'format'] as const;
export type LearnDimension = (typeof LEARN_DIMENSIONS)[number];

interface Stat {
  n: number;
  mean: number;
  m2: number;
}

function addSample(s: Stat, x: number): Stat {
  const n = s.n + 1;
  const d = x - s.mean;
  const mean = s.mean + d / n;
  return {n, mean, m2: s.m2 + d * (x - mean)};
}

/** Rebuilds the learning table from every scored own post (idempotent: safe to run after each analytics sync). */
export function rebuildLearning(db: Db): {samples: number; rows: number} {
  const posts = db.all(
    `SELECT p.id, p.account_id, p.score, p.published_at, p.hook_type, p.topic, p.structure, p.media_type, p.slide_count, p.cta_type,
            s.template, s.structure AS ss_structure, s.topic AS ss_topic, s.hook_type AS ss_hook, s.cta AS ss_cta, s.slides_json
       FROM posts p LEFT JOIN slideshows s ON s.id = p.slideshow_id
      WHERE p.is_own = 1 AND p.score IS NOT NULL`,
  );
  const stats = new Map<string, Stat>();
  const add = (scope: string, dim: string, value: string | null | undefined, x: number) => {
    if (!value) return;
    const k = `${scope}\u0000${dim}\u0000${value}`;
    stats.set(k, addSample(stats.get(k) ?? {n: 0, mean: 0, m2: 0}, x));
  };
  for (const p of posts) {
    const slides = p.slides_json ? parseJson<any[]>(p.slides_json, []).length : p.slide_count;
    const {hour, weekday} = hourBucket(p.published_at);
    const dims: Record<string, string | null> = {
      topic: p.ss_topic ?? p.topic,
      structure: p.ss_structure ?? p.structure,
      hook_type: p.ss_hook ?? p.hook_type,
      template: p.template ?? null,
      slides: p.slides_json ? slideBucket(slides, 'carousel') : null,
      hour,
      weekday,
      cta: p.ss_cta ?? p.cta_type,
      format: p.slides_json ? 'carousel' : p.media_type,
    };
    for (const scope of ['global', p.account_id ? `account:${p.account_id}` : null]) {
      if (!scope) continue;
      for (const [dim, value] of Object.entries(dims)) add(scope, dim, value, p.score);
    }
  }
  const now = new Date().toISOString();
  db.tx(() => {
    db.run('DELETE FROM learning');
    for (const [k, s] of stats) {
      const [scope, dimension, value] = k.split('\u0000');
      db.run('INSERT INTO learning(scope, dimension, value, n, mean, m2, updated_at) VALUES (?,?,?,?,?,?,?)', scope, dimension, value, s.n, s.mean, s.m2, now);
    }
  });
  return {samples: posts.length, rows: stats.size};
}

export interface Preference {
  value: string;
  n: number;
  observed: number | null;
  prior: number;
  expected: number;
  sample: number;
}

const PRIOR_K = 5;

/** Market prior for a dimension value (pattern detector output), on the 0-100 score scale. */
function marketPrior(db: Db, dimension: string, value: string, platform: string): number | null {
  const dimMap: Record<string, string> = {hook_type: 'hook_type', structure: 'structure', topic: 'topic', slides: 'slides', hour: 'hour', weekday: 'weekday', cta: 'cta_type', format: 'format'};
  const d = dimMap[dimension];
  if (!d) return null;
  const r =
    db.get<{shrunk_score: number}>('SELECT shrunk_score FROM patterns WHERE platform = ? AND dimension = ? AND value = ?', `market:${platform}`, d, value) ??
    db.get<{shrunk_score: number}>('SELECT shrunk_score FROM patterns WHERE platform = ? AND dimension = ? AND value = ?', 'market:all', d, value);
  return r?.shrunk_score ?? null;
}

/**
 * Thompson-sampled preferences for candidate values of one dimension.
 * Account statistics win over global ones when the account has at least 3 samples for the value.
 */
export function preferences(db: Db, opts: {dimension: LearnDimension; values: string[]; accountId?: string; platform?: string; rand: () => number}): Preference[] {
  return opts.values.map((value) => {
    const acc = opts.accountId ? db.get<Stat & {n: number}>('SELECT n, mean, m2 FROM learning WHERE scope = ? AND dimension = ? AND value = ?', `account:${opts.accountId}`, opts.dimension, value) : undefined;
    const glob = db.get<Stat>('SELECT n, mean, m2 FROM learning WHERE scope = ? AND dimension = ? AND value = ?', 'global', opts.dimension, value);
    const s = acc && acc.n >= 3 ? acc : glob ?? acc;
    const prior = marketPrior(db, opts.dimension, value, opts.platform ?? 'all') ?? 50;
    const n = s?.n ?? 0;
    const observed = s && s.n > 0 ? s.mean : null;
    const expected = observed === null ? prior : (n * observed + PRIOR_K * prior) / (n + PRIOR_K);
    const sd = s && s.n > 1 ? Math.sqrt(s.m2 / (s.n - 1)) : 15;
    const spread = Math.max(4, sd) / Math.sqrt(n + 1) + 8 / Math.sqrt(n + 1);
    return {value, n, observed, prior, expected, sample: expected + spread * gaussian(opts.rand)};
  });
}

/** Picks one value: Thompson sampling, with a floor of uniform exploration (epsilon). */
export function choose(db: Db, opts: {dimension: LearnDimension; values: string[]; accountId?: string; platform?: string; rand: () => number; epsilon?: number; penalty?: (v: string) => number}): {value: string; prefs: Preference[]} {
  const prefs = preferences(db, opts);
  if (prefs.length === 0) throw new Error(`Aucune valeur possible pour ${opts.dimension}`);
  if (opts.rand() < (opts.epsilon ?? 0.15)) return {value: prefs[Math.floor(opts.rand() * prefs.length)].value, prefs};
  const scored = prefs.map((p) => ({p, s: p.sample - (opts.penalty?.(p.value) ?? 0)}));
  scored.sort((a, b) => b.s - a.s);
  return {value: scored[0].p.value, prefs};
}

export function learningTable(db: Db, scope = 'global') {
  return db
    .all('SELECT dimension, value, n, mean, m2 FROM learning WHERE scope = ? ORDER BY dimension, mean DESC', scope)
    .map((r) => ({dimension: r.dimension, value: r.value, n: r.n, mean: Math.round(r.mean * 10) / 10, sd: r.n > 1 ? Math.round(Math.sqrt(r.m2 / (r.n - 1)) * 10) / 10 : null}));
}

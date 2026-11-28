import type {Db} from '../core/db.js';
import {mean, round, stdev} from '../core/text.js';
import {parseJson} from '../core/util.js';
import {HOOK_LABELS, type HookType} from './features.js';

/** Dimensions the Viral Pattern Detector compares. */
export const DIMENSIONS: Record<string, {label: string; get: (p: any) => string[]}> = {
  hook_type: {label: 'Type d’accroche', get: (p) => (p.hook_type ? [p.hook_type] : [])},
  structure: {label: 'Structure narrative', get: (p) => (p.structure ? [p.structure] : [])},
  cta_type: {label: 'Appel à l’action', get: (p) => (p.cta_type ? [p.cta_type] : [])},
  topic: {label: 'Sujet', get: (p) => (p.topic ? [p.topic] : [])},
  emotion: {label: 'Émotion / levier', get: (p) => parseJson<string[]>(p.emotions_json, [])},
  slides: {label: 'Nombre de slides', get: (p) => [parseJson<any>(p.features_json, {}).slideBucket ?? 'inconnu']},
  format: {label: 'Format', get: (p) => [p.media_type ?? 'inconnu']},
  hour: {label: 'Heure de publication (Paris)', get: (p) => {
    const h = parseJson<any>(p.features_json, {}).hourBucket;
    return h ? [h] : [];
  }},
  weekday: {label: 'Jour', get: (p) => {
    const w = parseJson<any>(p.features_json, {}).weekday;
    return w ? [w] : [];
  }},
  hook_length: {label: 'Longueur de l’accroche', get: (p) => {
    const w = parseJson<any>(p.features_json, {}).hookWords ?? 0;
    return [w <= 6 ? '≤ 6 mots' : w <= 12 ? '7-12 mots' : w <= 20 ? '13-20 mots' : '> 20 mots'];
  }},
  hashtags: {label: 'Nombre de hashtags', get: (p) => {
    const h = parseJson<any>(p.features_json, {}).hashtagCount ?? 0;
    return [h === 0 ? '0' : h <= 3 ? '1-3' : h <= 6 ? '4-6' : '7+'];
  }},
};

export interface Pattern {
  platform: string;
  dimension: string;
  value: string;
  n: number;
  authors: number;
  mean_score: number;
  shrunk_score: number;
  lift: number;
  ci_low: number;
  ci_high: number;
  top_share: number;
  examples: Array<{id: string; author: string; hook: string; score: number; url: string | null}>;
}

const SHRINK_K = 8;

/**
 * For every dimension and value: how many posts, by how many different accounts, their mean score,
 * a shrunk mean (pulled toward the platform mean when the sample is small), the lift against the mean,
 * a 90 % confidence interval, and how over-represented the value is among the top quarter of posts.
 */
export function computePatterns(db: Db, opts: {own?: boolean} = {}): Pattern[] {
  const posts = db.all(
    `SELECT id, platform, author, url, hook, hook_type, structure, cta_type, topic, emotions_json, media_type, features_json, score FROM posts WHERE score IS NOT NULL AND is_own = ?`,
    opts.own ? 1 : 0,
  );
  const platforms = [...new Set(posts.map((p) => p.platform)), 'all'];
  const out: Pattern[] = [];
  for (const platform of platforms) {
    const list = platform === 'all' ? posts : posts.filter((p) => p.platform === platform);
    if (list.length < 5) continue;
    const globalMean = mean(list.map((p) => p.score));
    const sortedScores = list.map((p) => p.score).sort((a, b) => b - a);
    const topCut = sortedScores[Math.max(0, Math.floor(list.length / 4) - 1)];
    const top = list.filter((p) => p.score >= topCut);
    for (const [dimension, def] of Object.entries(DIMENSIONS)) {
      const groups = new Map<string, any[]>();
      for (const p of list) for (const v of def.get(p)) groups.set(v, [...(groups.get(v) ?? []), p]);
      for (const [value, items] of groups) {
        const scores = items.map((p) => p.score);
        const m = mean(scores);
        const sd = stdev(scores);
        const shrunk = (items.length * m + SHRINK_K * globalMean) / (items.length + SHRINK_K);
        const half = items.length > 1 ? (1.645 * sd) / Math.sqrt(items.length) : 30;
        const shareAll = items.length / list.length;
        const shareTop = top.filter((p) => def.get(p).includes(value)).length / Math.max(1, top.length);
        out.push({
          platform,
          dimension,
          value,
          n: items.length,
          authors: new Set(items.map((p) => p.author)).size,
          mean_score: round(m, 1),
          shrunk_score: round(shrunk, 1),
          lift: round(shrunk / globalMean, 3),
          ci_low: round(m - half, 1),
          ci_high: round(m + half, 1),
          top_share: round(shareAll > 0 ? shareTop / shareAll : 0, 2),
          examples: [...items]
            .sort((a, b) => b.score - a.score)
            .slice(0, 3)
            .map((p) => ({id: p.id, author: p.author, hook: p.hook, score: p.score, url: p.url})),
        });
      }
    }
  }
  return out;
}

export function savePatterns(db: Db, patterns: Pattern[], scope: 'market' | 'own' = 'market'): void {
  const now = new Date().toISOString();
  db.tx(() => {
    db.run('DELETE FROM patterns WHERE platform LIKE ?', `${scope}:%`);
    for (const p of patterns) {
      db.upsert(
        'patterns',
        {
          platform: `${scope}:${p.platform}`,
          dimension: p.dimension,
          value: p.value,
          n: p.n,
          authors: p.authors,
          mean_score: p.mean_score,
          shrunk_score: p.shrunk_score,
          lift: p.lift,
          ci_low: p.ci_low,
          ci_high: p.ci_high,
          top_share: p.top_share,
          examples_json: JSON.stringify(p.examples),
          updated_at: now,
        },
        ['platform', 'dimension', 'value'],
      );
    }
  });
}

export function loadPatterns(db: Db, scope: 'market' | 'own' = 'market', platform = 'all'): Pattern[] {
  return db
    .all('SELECT * FROM patterns WHERE platform = ? ORDER BY dimension, shrunk_score DESC', `${scope}:${platform}`)
    .map((r) => ({...r, platform: platform, examples: parseJson(r.examples_json, [])}) as unknown as Pattern);
}

/** Values shared by at least `minAuthors` different accounts among winners: formats that repeat across competitors. */
export function crossCompetitorPatterns(patterns: Pattern[], minAuthors = 3): Pattern[] {
  return patterns.filter((p) => p.authors >= minAuthors && p.lift > 1 && p.top_share >= 1).sort((a, b) => b.lift - a.lift);
}

export function patternLabel(p: Pattern): string {
  const dim = DIMENSIONS[p.dimension]?.label ?? p.dimension;
  const value = p.dimension === 'hook_type' ? HOOK_LABELS[p.value as HookType] ?? p.value : p.value;
  return `${dim} : ${value}`;
}

/** Short French summary of what works, used in AI prompts and on the dashboard. */
export function insightsText(patterns: Pattern[], max = 8): string[] {
  const usable = patterns.filter((p) => p.n >= 3 && !['inconnu', 'aucun'].includes(p.value));
  const lines: string[] = [];
  for (const dim of ['hook_type', 'structure', 'cta_type', 'emotion', 'topic', 'hook_length', 'slides', 'hour']) {
    const best = usable.filter((p) => p.dimension === dim).sort((a, b) => b.shrunk_score - a.shrunk_score)[0];
    if (!best || best.lift <= 1.02) continue;
    lines.push(`${patternLabel(best)} — score moyen ${best.mean_score}/100 (×${best.lift.toFixed(2)} vs moyenne, ${best.n} posts, ${best.authors} comptes)`);
  }
  return lines.slice(0, max);
}

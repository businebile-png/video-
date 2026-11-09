import path from 'node:path';
import {PATHS} from '../core/paths.js';
import {readJson, readJsonIfExists, writeJson} from '../core/fsx.js';
import {loadAffiliate, loadHistory, loadPublications, upsertHistory, upsertPublication} from '../core/stores.js';
import {StatsImportSchema, type PostMetrics} from '../schemas/records.js';
import {normalize} from '../core/text.js';

export interface VideoMetrics {
  runId: string;
  network: 'tiktok' | 'instagram';
  permalink: string | null;
  metrics: PostMetrics['metrics'];
  collectedAt: string;
}

/**
 * Import post metrics gathered by the daily agent (Metricool analytics), match them to our
 * videos via the publication ledger (permalink, then time + caption), and confirm publications.
 */
export async function importStats(file: string): Promise<{matched: VideoMetrics[]; unmatched: number}> {
  const data = StatsImportSchema.parse(await readJson(file));
  const pubs = await loadPublications();
  const store = await readJsonIfExists<Record<string, VideoMetrics>>(PATHS.metrics, {});
  const matched: VideoMetrics[] = [];
  let unmatched = 0;
  for (const post of data.posts) {
    const candidates = pubs.filter((p) => p.network === post.network);
    let pub = post.runId ? candidates.find((p) => p.runId === post.runId) : undefined;
    if (!pub && post.permalink) pub = candidates.find((p) => p.permalink === post.permalink);
    if (!pub && post.runId) {
      // Matched upstream (panel publications) but absent from this clone's ledger: keep the numbers anyway.
      const vm: VideoMetrics = {runId: post.runId, network: post.network, permalink: post.permalink, metrics: post.metrics, collectedAt: data.collectedAt};
      store[`${post.runId}:${post.network}`] = vm;
      matched.push(vm);
      continue;
    }
    if (!pub) {
      const t = Date.parse(post.publishedAt);
      const cap = normalize(post.caption).slice(0, 60);
      pub = candidates.find((p) => Math.abs(Date.parse(p.scheduledFor) - t) < 90 * 60_000 && (!cap || normalize(p.captionStart).slice(0, 40).length === 0 || cap.includes(normalize(p.captionStart).slice(0, 30))));
    }
    if (!pub) {
      unmatched++;
      continue;
    }
    const vm: VideoMetrics = {runId: pub.runId, network: post.network, permalink: post.permalink, metrics: post.metrics, collectedAt: data.collectedAt};
    store[`${pub.runId}:${post.network}`] = vm;
    matched.push(vm);
    if (pub.status !== 'published') {
      await upsertPublication({...pub, status: 'published', permalink: post.permalink ?? pub.permalink, confirmedAt: data.collectedAt, recordedAt: new Date().toISOString()});
      await upsertHistory({runId: pub.runId, status: 'published'});
    }
  }
  await writeJson(PATHS.metrics, store);
  await writeJson(path.join(PATHS.statsDir, `${data.collectedAt.slice(0, 10)}.json`), data);
  return {matched, unmatched};
}

export interface VideoPerformance {
  runId: string;
  hook: string | null;
  hookStyle: string | null;
  category: string;
  durationSec: number | null;
  views: number;
  /** Average share of the video watched (%), from watch time / duration or Instagram retention. */
  watchPct: number | null;
  /** TikTok: viewers who watched to the end (%). */
  completionRate: number | null;
  /** (shares + saves) per 100 views. */
  sharePer100: number | null;
  /** Comments per 1 000 views. */
  commentsPer1000: number | null;
  /** TikTok: share of views from the For You feed (%). */
  forYouPct: number | null;
}

export interface Insights {
  updatedAt: string;
  categoryIndex: Record<string, number>;
  /** Hook styles whose videos were watched longer / shared more (≥ 2 videos with views); 1 = neutral. */
  hookStyleIndex: Record<string, number>;
  videos: VideoPerformance[];
  categories: Array<{category: string; videos: number; avgViews: number | null; avgWatchSec: number | null; engagementRate: number | null; estClicks: number | null; estPaid: number | null}>;
  note: string;
}

/**
 * Category performance index for the planner. Clicks and sign-ups only exist per day in the
 * affiliate dashboard (link in bio), so they are attributed to the videos of the previous
 * 72 h in proportion to their views: an estimate, labelled as such.
 */
export async function computeInsights(): Promise<Insights> {
  const history = await loadHistory();
  const metrics = Object.values(await readJsonIfExists<Record<string, VideoMetrics>>(PATHS.metrics, {}));
  const affiliate = await loadAffiliate();
  const pubs = await loadPublications();
  const viewsByRun = new Map<string, number>();
  for (const m of metrics) viewsByRun.set(m.runId, (viewsByRun.get(m.runId) ?? 0) + (m.metrics.views ?? 0));
  const estClicks = new Map<string, number>();
  const estPaid = new Map<string, number>();
  for (const day of affiliate) {
    if (day.clicks === null && day.paidSubscriptions === null) continue;
    const dayT = Date.parse(day.date);
    const window = pubs.filter((p) => p.status === 'published' && dayT - Date.parse(p.scheduledFor) >= -86_400_000 && dayT - Date.parse(p.scheduledFor) <= 3 * 86_400_000);
    const totalViews = window.reduce((n, p) => n + (viewsByRun.get(p.runId) ?? 0), 0);
    for (const p of window) {
      const share = totalViews > 0 ? (viewsByRun.get(p.runId) ?? 0) / totalViews : 1 / window.length;
      estClicks.set(p.runId, (estClicks.get(p.runId) ?? 0) + (day.clicks ?? 0) * share);
      estPaid.set(p.runId, (estPaid.get(p.runId) ?? 0) + (day.paidSubscriptions ?? 0) * share);
    }
  }
  const byCat = new Map<string, string[]>();
  for (const h of history.filter((h) => h.status === 'published')) byCat.set(h.category, [...(byCat.get(h.category) ?? []), h.runId]);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const categories = [...byCat.entries()].map(([category, runs]) => {
    const ms = metrics.filter((m) => runs.includes(m.runId));
    const views = ms.map((m) => m.metrics.views ?? 0);
    const watch = ms.map((m) => m.metrics.avgWatchTimeSec).filter((x): x is number => x !== null);
    const eng = ms
      .filter((m) => (m.metrics.views ?? 0) > 0)
      .map((m) => ((m.metrics.likes ?? 0) + (m.metrics.comments ?? 0) + (m.metrics.shares ?? 0) + (m.metrics.saves ?? 0)) / (m.metrics.views ?? 1));
    const clicks = runs.map((r) => estClicks.get(r) ?? 0);
    const paid = runs.map((r) => estPaid.get(r) ?? 0);
    return {category, videos: runs.length, avgViews: avg(views), avgWatchSec: avg(watch), engagementRate: avg(eng), estClicks: avg(clicks), estPaid: avg(paid)};
  });
  // Index: paid subscriptions first (the business goal), then clicks, then engagement; neutral (1) without data.
  const index: Record<string, number> = {};
  const maxPaid = Math.max(0, ...categories.map((c) => c.estPaid ?? 0));
  const maxClicks = Math.max(0, ...categories.map((c) => c.estClicks ?? 0));
  const maxEng = Math.max(0, ...categories.map((c) => c.engagementRate ?? 0));
  for (const c of categories) {
    if (c.videos < 2) continue;
    const paidPart = maxPaid > 0 ? (c.estPaid ?? 0) / maxPaid : 0.5;
    const clickPart = maxClicks > 0 ? (c.estClicks ?? 0) / maxClicks : 0.5;
    const engPart = maxEng > 0 ? (c.engagementRate ?? 0) / maxEng : 0.5;
    index[c.category] = Math.round((0.5 + 0.6 * paidPart + 0.3 * clickPart + 0.15 * engPart) * 100) / 100;
  }
  const videos = videoPerformance(history, metrics);
  const insights: Insights = {
    updatedAt: new Date().toISOString(),
    categoryIndex: index,
    hookStyleIndex: hookStyleIndex(videos),
    videos,
    categories,
    note: 'Estimations : le lien est en bio, aucune plateforme ne dit quelle vidéo a amené quel clic ou quel abonnement. Répartition au prorata des vues sur 72 h ; l’indice privilégie les abonnements payants.',
  };
  await writeJson(PATHS.insights, insights);
  return insights;
}

const mean = (xs: Array<number | null | undefined>): number | null => {
  const v = xs.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const round1 = (x: number | null) => (x === null ? null : Math.round(x * 10) / 10);

/** One line per video with real numbers (both networks pooled): what the next script can learn from. */
export function videoPerformance(history: Array<{runId: string; hook: string | null; hookStyle: string | null; category: string; durationSec: number | null}>, metrics: VideoMetrics[]): VideoPerformance[] {
  const out: VideoPerformance[] = [];
  for (const h of history) {
    const ms = metrics.filter((m) => m.runId === h.runId);
    if (!ms.length) continue;
    const views = ms.reduce((n, m) => n + (m.metrics.views ?? 0), 0);
    const watch = ms.map((m) => {
      const r = (m.metrics as {retentionPct?: number | null}).retentionPct;
      if (typeof r === 'number') return r;
      return m.metrics.avgWatchTimeSec !== null && h.durationSec ? Math.min(100, (100 * m.metrics.avgWatchTimeSec) / h.durationSec) : null;
    });
    const sum = (k: 'shares' | 'saves' | 'comments') => ms.reduce((n, m) => n + (m.metrics[k] ?? 0), 0);
    const anyShare = ms.some((m) => m.metrics.shares !== null || m.metrics.saves !== null);
    const anyComment = ms.some((m) => m.metrics.comments !== null);
    out.push({
      runId: h.runId,
      hook: h.hook,
      hookStyle: h.hookStyle,
      category: h.category,
      durationSec: h.durationSec,
      views,
      watchPct: round1(mean(watch)),
      completionRate: round1(mean(ms.filter((m) => m.network === 'tiktok').map((m) => m.metrics.completionRate))),
      sharePer100: views > 0 && anyShare ? round1((100 * (sum('shares') + sum('saves'))) / views) : null,
      commentsPer1000: views > 0 && anyComment ? round1((1000 * sum('comments')) / views) : null,
      forYouPct: round1(mean(ms.filter((m) => m.network === 'tiktok').map((m) => (m.metrics as {forYouPct?: number | null}).forYouPct))),
    });
  }
  return out.sort((a, b) => b.runId.localeCompare(a.runId));
}

/** Watch time first (what both platforms rank on), then shares/saves, then reach; neutral (1) without enough data. */
export function hookStyleIndex(videos: VideoPerformance[]): Record<string, number> {
  const by = new Map<string, VideoPerformance[]>();
  for (const v of videos) if (v.hookStyle && v.views > 0) by.set(v.hookStyle, [...(by.get(v.hookStyle) ?? []), v]);
  const rows = [...by.entries()].filter(([, vs]) => vs.length >= 2).map(([style, vs]) => ({style, watch: mean(vs.map((v) => v.watchPct)), share: mean(vs.map((v) => v.sharePer100)), views: mean(vs.map((v) => v.views)) ?? 0}));
  const maxW = Math.max(0, ...rows.map((r) => r.watch ?? 0));
  const maxS = Math.max(0, ...rows.map((r) => r.share ?? 0));
  const maxV = Math.max(0, ...rows.map((r) => r.views));
  const index: Record<string, number> = {};
  for (const r of rows) {
    const w = maxW > 0 ? (r.watch ?? 0) / maxW : 0.5;
    const sh = maxS > 0 ? (r.share ?? 0) / maxS : 0.5;
    const v = maxV > 0 ? r.views / maxV : 0.5;
    index[r.style] = Math.round((0.55 + 0.5 * w + 0.3 * sh + 0.15 * v) * 100) / 100;
  }
  return index;
}

/** Plain-French lines for the writer's brief: the best and the weakest videos, with their real numbers. */
export function performanceLines(insights: Partial<Insights>): string[] | null {
  const vids = (insights.videos ?? []).filter((v) => v.views > 0);
  if (!vids.length) return null;
  const describe = (v: VideoPerformance) =>
    [
      `${v.runId} (${v.hookStyle ?? 'style inconnu'}, ${v.durationSec ? Math.round(v.durationSec) + ' s' : 'durée inconnue'}) « ${v.hook ?? ''} »`,
      `${v.views} vues`,
      v.watchPct !== null ? `regardée à ${v.watchPct} % en moyenne` : null,
      v.completionRate !== null ? `${v.completionRate} % jusqu’au bout (TikTok)` : null,
      v.sharePer100 !== null ? `${v.sharePer100} partages ou enregistrements pour 100 vues` : null,
      v.forYouPct !== null ? `${v.forYouPct} % des vues venues de « Pour toi »` : null,
    ]
      .filter(Boolean)
      .join(' · ');
  const ranked = [...vids].sort((a, b) => (b.watchPct ?? -1) - (a.watchPct ?? -1) || b.views - a.views);
  const lines = [`Meilleure rétention : ${describe(ranked[0]!)}`];
  if (ranked.length > 1) lines.push(`Plus faible : ${describe(ranked[ranked.length - 1]!)}`);
  const styles = Object.entries(insights.hookStyleIndex ?? {}).sort((a, b) => b[1] - a[1]);
  if (styles.length) lines.push(`Styles d’accroche par efficacité (indice, 1 = neutre) : ${styles.map(([s, i]) => `${s} ${i}`).join(', ')}`);
  else lines.push('Pas encore 2 vidéos par style d’accroche : varier les styles pour apprendre ce qui retient ton audience.');
  return lines;
}

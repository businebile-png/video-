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
    let pub = post.permalink ? candidates.find((p) => p.permalink === post.permalink) : undefined;
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

export interface Insights {
  updatedAt: string;
  categoryIndex: Record<string, number>;
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
  const insights: Insights = {
    updatedAt: new Date().toISOString(),
    categoryIndex: index,
    categories,
    note: 'Estimations : le lien est en bio, aucune plateforme ne dit quelle vidéo a amené quel clic ou quel abonnement. Répartition au prorata des vues sur 72 h ; l’indice privilégie les abonnements payants.',
  };
  await writeJson(PATHS.insights, insights);
  return insights;
}

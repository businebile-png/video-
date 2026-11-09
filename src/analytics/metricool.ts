import fsp from 'node:fs/promises';
import path from 'node:path';
import {PATHS} from '../core/paths.js';
import {exists, readJson, writeJson} from '../core/fsx.js';
import {normalize, similarity} from '../core/text.js';
import type {PostMetrics} from '../schemas/records.js';

/**
 * Metricool analytics rows (getAnalyticsDataByMetrics) → numbers per video, ready for the panel's
 * `videos/<runId>.metrics` and for `stats:import`. The scheduling session (the one with the Metricool
 * connector) runs this at every pass, so production sessions learn from real results through the panel.
 */

export interface MetricoolTable {
  metrics: string[];
  rows: Array<Array<string | number | null>>;
}

export interface MetricoolExport {
  collectedAt: string;
  tiktok?: MetricoolTable;
  instagram?: MetricoolTable;
}

/** Field ids to request, in this order (see getAnalyticsAvailableMetrics). */
export const METRICOOL_FIELDS = {
  tiktok: ['TKPO02', 'TKPO03', 'TKPO05', 'TKPO06', 'TKPO07', 'TKPO08', 'TKPO09', 'TKPO10', 'TKPO11', 'TKPO13', 'TKPO15', 'TKPO16', 'TKPO21'],
  instagram: ['IGRE02', 'IGRE03', 'IGRE06', 'IGRE07', 'IGRE10', 'IGRE11', 'IGRE12', 'IGRE21', 'IGRE23', 'IGRE24', 'IGRE27', 'IGRE28'],
} as const;

type Field = 'publishedAt' | 'permalink' | 'caption' | 'durationSec' | keyof PostMetrics['metrics'];

const MAP: Record<string, Field> = {
  TKPO02: 'publishedAt',
  TKPO03: 'permalink',
  TKPO05: 'caption',
  TKPO06: 'durationSec',
  TKPO07: 'views',
  TKPO08: 'likes',
  TKPO09: 'comments',
  TKPO10: 'shares',
  TKPO11: 'reach',
  TKPO13: 'completionRate',
  TKPO15: 'avgWatchTimeSec',
  TKPO16: 'forYouPct',
  TKPO21: 'searchPct',
  IGRE02: 'publishedAt',
  IGRE03: 'caption',
  IGRE06: 'permalink',
  IGRE07: 'comments',
  IGRE10: 'likes',
  IGRE11: 'reach',
  IGRE12: 'saves',
  IGRE21: 'shares',
  IGRE23: 'views',
  IGRE24: 'avgWatchTimeSec',
  IGRE27: 'retentionPct',
  IGRE28: 'hookRatePct',
};

/** "20261108112223" (Metricool, UTC) or any date Date.parse understands → ISO; null when unreadable. */
export function metricoolDate(v: unknown): string | null {
  const s = String(v ?? '').trim();
  const m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.').replace(/[%\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Rates may come as fractions (0.12) or percentages (12): stored as percentages. */
const pct = (n: number | null) => (n !== null && n > 0 && n <= 1 ? Math.round(n * 10000) / 100 : n);

export interface MetricoolPost {
  network: 'tiktok' | 'instagram';
  publishedAt: string | null;
  permalink: string | null;
  caption: string;
  durationSec: number | null;
  metrics: PostMetrics['metrics'];
}

export function parseTable(network: 'tiktok' | 'instagram', table: MetricoolTable): MetricoolPost[] {
  return table.rows.map((row) => {
    const rec: Record<string, unknown> = {};
    table.metrics.forEach((id, i) => {
      const field = MAP[id];
      if (field) rec[field] = row[i] ?? null;
    });
    const metrics: PostMetrics['metrics'] = {
      views: num(rec.views),
      reach: num(rec.reach),
      likes: num(rec.likes),
      comments: num(rec.comments),
      shares: num(rec.shares),
      saves: num(rec.saves),
      avgWatchTimeSec: num(rec.avgWatchTimeSec),
      completionRate: pct(num(rec.completionRate)),
      retentionPct: pct(num(rec.retentionPct)),
      hookRatePct: pct(num(rec.hookRatePct)),
      forYouPct: pct(num(rec.forYouPct)),
      searchPct: pct(num(rec.searchPct)),
      profileVisits: null,
      linkClicks: null,
    };
    const permalink = rec.permalink ? String(rec.permalink).split('?')[0]! : null;
    return {network, publishedAt: metricoolDate(rec.publishedAt), permalink, caption: String(rec.caption ?? ''), durationSec: num(rec.durationSec), metrics};
  });
}

type Raw = Record<string, unknown>;

export interface PanelVideo {
  runId: string;
  publications?: Record<string, {scheduledFor?: string; permalink?: string | null; status?: string} | undefined>;
  posts?: Array<{network: string; text: string; date?: string}>;
}

/**
 * The video a post belongs to: same permalink, else the caption we sent (it is unique: hook + disclosure),
 * else the publication time (±3 h of the scheduled slot). Null when nothing is convincing.
 */
/** Stable id inside a post URL: TikTok video number or Instagram shortcode (the handle in the URL can change). */
export function postKey(url: string | null | undefined): string | null {
  const s = String(url ?? '');
  const m = s.match(/\/video\/(\d+)/) ?? s.match(/\/(?:reel|reels|p)\/([A-Za-z0-9_-]+)/);
  return m ? m[1]! : s.split('?')[0] || null;
}

export function matchPost(post: MetricoolPost, videos: PanelVideo[]): string | null {
  const net = post.network;
  const key = postKey(post.permalink);
  if (key) {
    const hit = videos.find((v) => postKey(v.publications?.[net]?.permalink) === key);
    if (hit) return hit.runId;
  }
  const cap = normalize(post.caption).slice(0, 400);
  let best: {runId: string; sim: number} | null = null;
  for (const v of videos) {
    for (const p of (v.posts ?? []).filter((x) => x.network === net)) {
      const sim = similarity(cap, normalize(p.text).slice(0, 400));
      if (!best || sim > best.sim) best = {runId: v.runId, sim};
    }
  }
  if (best && best.sim >= 0.6) return best.runId;
  if (post.publishedAt) {
    const t = Date.parse(post.publishedAt);
    const near = videos
      .map((v) => ({runId: v.runId, at: Date.parse(v.publications?.[net]?.scheduledFor ?? '')}))
      .filter((x) => Number.isFinite(x.at) && Math.abs(x.at - t) <= 3 * 3_600_000)
      .sort((a, b) => Math.abs(a.at - t) - Math.abs(b.at - t));
    if (near[0]) return near[0].runId;
  }
  return null;
}

export interface MetricsUpdate {
  /** `videos/<runId>` field `metrics`, both networks, for ArtifactData update. */
  panel: Record<string, {metrics: Raw}>;
  /** Posts the platform shows as live: the panel publication can be confirmed (`published`, permalink). */
  confirmations: Array<{runId: string; network: 'tiktok' | 'instagram'; permalink: string | null; publishedAt: string | null}>;
  unmatched: Array<{network: string; publishedAt: string | null; permalink: string | null; captionStart: string}>;
  statsFile: string;
}

async function loadPanelVideos(dir: string): Promise<PanelVideo[]> {
  if (!exists(dir)) return [];
  const out: PanelVideo[] = [];
  for (const name of (await fsp.readdir(dir)).filter((n) => n.endsWith('.json'))) {
    const raw = await readJson<Raw>(path.join(dir, name));
    const v = (raw && typeof raw === 'object' && 'data' in raw && raw.data && typeof raw.data === 'object' ? raw.data : raw) as Raw;
    const runId = String(v.runId ?? name.replace(/\.json$/, ''));
    out.push({runId, publications: (v.publications ?? {}) as PanelVideo['publications'], posts: (Array.isArray(v.posts) ? v.posts : []) as PanelVideo['posts']});
  }
  return out;
}

export async function convertMetricool(file: string, videosDir: string): Promise<MetricsUpdate> {
  const data = await readJson<MetricoolExport>(file);
  const videos = await loadPanelVideos(videosDir);
  const posts = [...(data.tiktok ? parseTable('tiktok', data.tiktok) : []), ...(data.instagram ? parseTable('instagram', data.instagram) : [])];
  const panel: MetricsUpdate['panel'] = {};
  const confirmations: MetricsUpdate['confirmations'] = [];
  const unmatched: MetricsUpdate['unmatched'] = [];
  const stats: Array<Raw> = [];
  for (const post of posts) {
    const runId = matchPost(post, videos);
    if (!runId) {
      unmatched.push({network: post.network, publishedAt: post.publishedAt, permalink: post.permalink, captionStart: post.caption.slice(0, 80)});
      continue;
    }
    const doc = (panel[runId] ??= {metrics: {updatedAt: data.collectedAt}});
    doc.metrics[post.network] = {...post.metrics, permalink: post.permalink, publishedAt: post.publishedAt, durationSec: post.durationSec};
    confirmations.push({runId, network: post.network, permalink: post.permalink, publishedAt: post.publishedAt});
    stats.push({network: post.network, runId, permalink: post.permalink, postId: null, publishedAt: post.publishedAt ?? data.collectedAt, caption: post.caption, metrics: post.metrics});
  }
  const statsFile = path.join(PATHS.cache, 'stats.json');
  await writeJson(statsFile, {collectedAt: data.collectedAt, source: 'metricool', posts: stats});
  const result: MetricsUpdate = {panel, confirmations, unmatched, statsFile};
  await writeJson(path.join(PATHS.cache, 'metrics-update.json'), result);
  return result;
}

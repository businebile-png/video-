import type {Db} from '../core/db.js';
import type {AppConfig} from '../core/config.js';
import {extractFeatures} from './features.js';
import {scorePosts, type ScoreInput} from './scoring.js';
import {median, mean, round} from '../core/text.js';
import {id as newId, parseJson} from '../core/util.js';

/** A post from any source, before analysis. Metrics are null when the source does not provide them. */
export interface NormalizedPost {
  platform: string;
  externalId: string;
  author: string | null;
  isOwn?: boolean;
  accountId?: string | null;
  slideshowId?: string | null;
  /** Id given by the publishing tool (e.g. Zernio post id), used to link analytics to our slideshows. */
  providerPostId?: string | null;
  url?: string | null;
  publishedAt?: string | null;
  source: string;
  query?: string | null;
  language?: string | null;
  mediaType?: 'carousel' | 'video' | 'image' | 'text' | null;
  slideCount?: number | null;
  durationS?: number | null;
  text: string;
  hook?: string | null;
  views?: number | null;
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;
  saves?: number | null;
  followers?: number | null;
  isPaid?: boolean;
}

export interface SaveReport {
  received: number;
  inserted: number;
  updated: number;
  skipped: number;
}

const n = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x) : typeof x === 'string' && x.trim() !== '' && Number.isFinite(Number(x)) ? Math.round(Number(x)) : null);

export function savePosts(db: Db, posts: NormalizedPost[]): SaveReport {
  const report: SaveReport = {received: posts.length, inserted: 0, updated: 0, skipped: 0};
  const now = new Date().toISOString();
  db.tx(() => {
    for (const p of posts) {
      if (!p.externalId || !p.platform) {
        report.skipped++;
        continue;
      }
      const existing = db.get<{id: string}>('SELECT id FROM posts WHERE platform = ? AND external_id = ?', p.platform, p.externalId);
      const id = existing?.id ?? newId('post');
      const row = {
        id,
        platform: p.platform,
        external_id: p.externalId,
        author: p.author?.replace(/^@/, '').toLowerCase() ?? null,
        is_own: p.isOwn ? 1 : 0,
        account_id: p.accountId ?? null,
        slideshow_id: p.slideshowId ?? null,
        provider_post_id: p.providerPostId ?? null,
        url: p.url ?? null,
        published_at: p.publishedAt ?? null,
        collected_at: now,
        source: p.source,
        query: p.query ?? null,
        language: p.language ?? null,
        media_type: p.mediaType ?? null,
        slide_count: n(p.slideCount),
        duration_s: typeof p.durationS === 'number' ? p.durationS : null,
        text: p.text ?? '',
        hook: p.hook ?? null,
        views: n(p.views),
        likes: n(p.likes),
        comments: n(p.comments),
        shares: n(p.shares),
        saves: n(p.saves),
        followers: n(p.followers),
        is_paid: p.isPaid ? 1 : 0,
      };
      if (existing) {
        const cols = Object.keys(row).filter((c) => c !== 'id');
        db.run(`UPDATE posts SET ${cols.map((c) => `${c} = COALESCE(?, ${c})`).join(', ')} WHERE id = ?`, ...cols.map((c) => (row as any)[c]), id);
        report.updated++;
      } else {
        db.upsert('posts', row);
        report.inserted++;
      }
      if (p.isOwn) {
        db.upsert(
          'post_metrics',
          {post_id: id, captured_at: now.slice(0, 13), views: row.views, likes: row.likes, comments: row.comments, shares: row.shares, saves: row.saves},
          ['post_id', 'captured_at'],
        );
      }
    }
  });
  return report;
}

/**
 * Recomputes features and scores of every stored post, then the competitor table.
 * Own posts and competitor posts are scored in separate pools so our small accounts do not drag the niche baseline.
 */
export function analyzePosts(db: Db, cfg: AppConfig): {posts: number; competitors: number} {
  const rows = db.all('SELECT id, platform, author, is_own, text, hook, media_type, slide_count, published_at, views, likes, comments, shares, saves, followers FROM posts');
  const pools = new Map<string, ScoreInput[]>();
  db.tx(() => {
    for (const r of rows) {
      const f = extractFeatures({text: r.text, hook: r.hook, media_type: r.media_type, slide_count: r.slide_count, published_at: r.published_at}, cfg.niche);
      db.run(
        'UPDATE posts SET hook = ?, hook_type = ?, structure = ?, cta_type = ?, topic = ?, emotions_json = ?, hashtags_json = ?, features_json = ? WHERE id = ?',
        f.hook,
        f.hookType,
        f.structure,
        f.ctaType,
        f.topic,
        JSON.stringify(f.emotions),
        JSON.stringify(f.hashtags),
        JSON.stringify(f),
        r.id,
      );
      const pool = `${r.is_own ? 'own' : 'market'}:${r.platform}`;
      const list = pools.get(pool) ?? [];
      list.push({key: r.id, platform: pool, author: r.author, views: r.views, likes: r.likes, comments: r.comments, shares: r.shares, saves: r.saves, followers: r.followers});
      pools.set(pool, list);
    }
    for (const list of pools.values()) {
      const scores = scorePosts(list);
      for (const [key, s] of scores) {
        db.run('UPDATE posts SET score = ?, relative_perf = ?, engagement_rate = ?, score_parts_json = ? WHERE id = ?', s.score, s.parts.relativePerf, s.parts.engagementRate, JSON.stringify(s.parts), key);
      }
    }
  });
  const competitors = refreshCompetitors(db, cfg);
  return {posts: rows.length, competitors};
}

export function refreshCompetitors(db: Db, cfg: AppConfig): number {
  const groups = db.all<{platform: string; author: string}>("SELECT DISTINCT platform, author FROM posts WHERE is_own = 0 AND author IS NOT NULL AND author != ''");
  const seeds = cfg.niche.competitorSeeds;
  const now = new Date().toISOString();
  db.tx(() => {
    for (const g of groups) {
      const posts = db.all('SELECT views, likes, comments, shares, saves, followers, score, collected_at FROM posts WHERE platform = ? AND author = ? AND is_own = 0', g.platform, g.author);
      const views = posts.map((p) => p.views).filter((v) => v !== null);
      const eng = posts.map((p) => (p.likes ?? 0) + 2 * (p.comments ?? 0) + 3 * (p.shares ?? 0) + 2 * (p.saves ?? 0));
      const scores = posts.map((p) => p.score).filter((s) => s !== null);
      const followers = Math.max(0, ...posts.map((p) => p.followers ?? 0)) || null;
      const existing = db.get<{id: string; first_seen: string; tracked: number}>('SELECT id, first_seen, tracked FROM competitors WHERE platform = ? AND handle = ?', g.platform, g.author);
      db.upsert(
        'competitors',
        {
          id: existing?.id ?? newId('comp'),
          platform: g.platform,
          handle: g.author,
          display_name: g.author,
          followers,
          niche: cfg.niche.id,
          source: 'collecte',
          posts_count: posts.length,
          median_views: views.length ? median(views) : null,
          median_engagement: eng.length ? median(eng) : null,
          avg_score: scores.length ? round(mean(scores), 1) : null,
          top_score: scores.length ? Math.max(...scores) : null,
          tracked: existing?.tracked ?? ((seeds[g.platform] ?? []).includes(g.author) ? 1 : 0),
          first_seen: existing?.first_seen ?? now,
          last_seen: now,
        },
        ['platform', 'handle'],
      );
    }
  });
  return groups.length;
}

export interface PostFilter {
  platform?: string;
  own?: boolean;
  hookType?: string;
  topic?: string;
  author?: string;
  minScore?: number;
  q?: string;
  sort?: 'score' | 'views' | 'date' | 'engagement';
  limit?: number;
  offset?: number;
}

export function queryPosts(db: Db, f: PostFilter = {}) {
  const where: string[] = [];
  const params: any[] = [];
  if (f.platform) (where.push('platform = ?'), params.push(f.platform));
  if (f.own !== undefined) (where.push('is_own = ?'), params.push(f.own ? 1 : 0));
  if (f.hookType) (where.push('hook_type = ?'), params.push(f.hookType));
  if (f.topic) (where.push('topic = ?'), params.push(f.topic));
  if (f.author) (where.push('author = ?'), params.push(f.author.toLowerCase()));
  if (f.minScore !== undefined) (where.push('score >= ?'), params.push(f.minScore));
  if (f.q) (where.push('(text LIKE ? OR author LIKE ?)'), params.push(`%${f.q}%`, `%${f.q}%`));
  const order = {score: 'score DESC', views: 'views DESC', date: 'published_at DESC', engagement: 'engagement_rate DESC'}[f.sort ?? 'score'];
  const sql = `SELECT id, platform, external_id, author, is_own, account_id, url, published_at, source, query, language, media_type, slide_count, substr(text, 1, 400) AS text, hook, views, likes, comments, shares, saves, followers, hook_type, structure, cta_type, topic, emotions_json, score, relative_perf, engagement_rate FROM posts ${
    where.length ? 'WHERE ' + where.join(' AND ') : ''
  } ORDER BY ${order} NULLS LAST LIMIT ? OFFSET ?`;
  const total = db.get<{n: number}>(`SELECT COUNT(*) AS n FROM posts ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`, ...params)!.n;
  const items = db.all(sql, ...params, f.limit ?? 50, f.offset ?? 0).map((r) => ({...r, emotions: parseJson(r.emotions_json, [] as string[])}) as Record<string, any>);
  return {total, items};
}

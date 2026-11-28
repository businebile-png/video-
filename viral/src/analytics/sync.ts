import type {Db} from '../core/db.js';
import type {AppConfig} from '../core/config.js';
import {listAccounts} from '../core/accounts.js';
import {nowIso} from '../core/util.js';
import {fromZernioAnalytics, importFile} from '../intel/collectors/importers.js';
import {analyzePosts, savePosts, type NormalizedPost} from '../intel/store.js';
import {computePatterns, savePatterns} from '../intel/patterns.js';
import {detectTrends, saveTrends} from '../intel/trends.js';
import {rebuildLearning} from './learn.js';

/**
 * Feedback loop entry points: fetch the statistics of our own publications (Zernio REST, Meta insights, or an
 * export written by a Claude session through the Zernio / Metricool connectors), link them to the slideshows
 * that produced them, re-score, and rebuild the learning tables used by the generator and the scheduler.
 */

export function linkOwnPosts(db: Db): number {
  const rows = db.all("SELECT id, slideshow_id, account_id, provider_post_id, permalink FROM schedule WHERE provider_post_id IS NOT NULL OR permalink IS NOT NULL");
  let n = 0;
  for (const r of rows) {
    const res = db.run(
      'UPDATE posts SET slideshow_id = ?, account_id = COALESCE(account_id, ?) WHERE is_own = 1 AND slideshow_id IS NULL AND (external_id = ? OR (url IS NOT NULL AND url = ?))',
      r.slideshow_id,
      r.account_id,
      r.provider_post_id ?? '',
      r.permalink ?? '',
    );
    n += res.changes;
    // Zernio post ids differ from the platform's id: the analytics record keeps both.
    if (r.provider_post_id) n += db.run('UPDATE posts SET slideshow_id = ? WHERE is_own = 1 AND slideshow_id IS NULL AND provider_post_id = ?', r.slideshow_id, r.provider_post_id).changes;
  }
  return n;
}

export function refreshIntelligence(db: Db, cfg: AppConfig) {
  const analyzed = analyzePosts(db, cfg);
  savePatterns(db, computePatterns(db, {own: false}), 'market');
  savePatterns(db, computePatterns(db, {own: true}), 'own');
  saveTrends(db, detectTrends(db));
  const linked = linkOwnPosts(db);
  const learning = rebuildLearning(db);
  db.setSetting('intel.refreshedAt', nowIso());
  return {...analyzed, linked, learning};
}

export function importAnalyticsFile(db: Db, cfg: AppConfig, file: string) {
  const accounts = listAccounts(db);
  const {kind, posts} = importFile(file, accounts, 'auto');
  const saved = savePosts(db, posts);
  const refreshed = refreshIntelligence(db, cfg);
  db.event('analytics', `Statistiques importées (${kind}) : ${saved.inserted} nouvelles, ${saved.updated} mises à jour`, {data: saved});
  return {kind, saved, refreshed};
}

/** Zernio REST analytics for every connected profile (needs a valid ZERNIO_API_KEY). */
export async function syncZernio(db: Db, cfg: AppConfig, days = 60): Promise<{posts: number; error?: string}> {
  const key = process.env.ZERNIO_API_KEY ?? 'proxy';
  const accounts = listAccounts(db).filter((a) => a.provider === 'zernio');
  const profiles = [...new Set(accounts.map((a) => a.providerProfileId).filter(Boolean))];
  const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const all: NormalizedPost[] = [];
  for (const profileId of profiles) {
    for (let page = 1; page <= 10; page++) {
      const res = await fetch(`https://zernio.com/api/v1/analytics?${new URLSearchParams({profileId: profileId!, fromDate: from, limit: '40', page: String(page)})}`, {headers: {Authorization: `Bearer ${key}`}});
      if (res.status === 401) return {posts: 0, error: 'clé API Zernio refusée'};
      if (res.status === 429) return {posts: all.length, error: 'limite de requêtes Zernio atteinte : reprise au prochain passage'};
      if (!res.ok) return {posts: all.length, error: `HTTP ${res.status}`};
      const data = await res.json();
      all.push(...fromZernioAnalytics(data, accounts));
      if (page >= (data.pagination?.pages ?? 1)) break;
    }
  }
  savePosts(db, all);
  refreshIntelligence(db, cfg);
  return {posts: all.length};
}

/** Instagram and Threads insights of our published carousels (official APIs, own tokens). */
export async function syncMeta(db: Db, cfg: AppConfig): Promise<{updated: number; skipped: string[]}> {
  const skipped: string[] = [];
  const rows = db.all("SELECT s.*, x.hook, x.caption FROM schedule s JOIN slideshows x ON x.id = s.slideshow_id WHERE s.status = 'published' AND s.provider = 'meta' AND s.provider_post_id IS NOT NULL");
  const posts: NormalizedPost[] = [];
  for (const r of rows) {
    try {
      if (r.platform === 'instagram') {
        const t = process.env.INSTAGRAM_ACCESS_TOKEN;
        if (!t) throw new Error('INSTAGRAM_ACCESS_TOKEN absent');
        const res = await fetch(`https://graph.instagram.com/v24.0/${r.provider_post_id}/insights?metric=reach,likes,comments,shares,saved,views&access_token=${t}`);
        const d = await res.json();
        const v = Object.fromEntries((d.data ?? []).map((m: any) => [m.name, m.values?.[0]?.value ?? m.total_value?.value]));
        posts.push({platform: 'instagram', externalId: r.provider_post_id, author: null, isOwn: true, accountId: r.account_id, slideshowId: r.slideshow_id, url: r.permalink, publishedAt: r.published_at, source: 'meta:insights', mediaType: 'carousel', text: r.caption, views: v.views ?? v.reach ?? null, likes: v.likes ?? null, comments: v.comments ?? null, shares: v.shares ?? null, saves: v.saved ?? null});
      } else if (r.platform === 'threads') {
        const t = process.env.THREADS_ACCESS_TOKEN;
        if (!t) throw new Error('THREADS_ACCESS_TOKEN absent');
        const res = await fetch(`https://graph.threads.net/v1.0/${r.provider_post_id}/insights?metric=views,likes,replies,reposts,quotes,shares&access_token=${t}`);
        const d = await res.json();
        const v = Object.fromEntries((d.data ?? []).map((m: any) => [m.name, m.values?.[0]?.value ?? m.total_value?.value]));
        posts.push({platform: 'threads', externalId: r.provider_post_id, author: null, isOwn: true, accountId: r.account_id, slideshowId: r.slideshow_id, url: r.permalink, publishedAt: r.published_at, source: 'meta:insights', mediaType: 'carousel', text: r.caption, views: v.views ?? null, likes: v.likes ?? null, comments: v.replies ?? null, shares: (v.reposts ?? 0) + (v.quotes ?? 0) + (v.shares ?? 0), saves: null});
      }
    } catch (e) {
      skipped.push(`${r.id} : ${(e as Error).message}`);
    }
  }
  if (posts.length) {
    savePosts(db, posts);
    refreshIntelligence(db, cfg);
  }
  return {updated: posts.length, skipped};
}

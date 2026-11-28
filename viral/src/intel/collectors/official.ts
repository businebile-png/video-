import type {NormalizedPost} from '../store.js';

/**
 * Collectors that call the platforms' OFFICIAL APIs with the user's own credentials.
 * They only read public data the API is designed to expose, and stop on the first rate-limit answer.
 *
 *  - YouTube Data API v3 (key YOUTUBE_API_KEY, free quota 10 000 units/day: search = 100 units, videos.list = 1).
 *  - Instagram Graph API with Facebook Login (META_GRAPH_TOKEN + IG_BUSINESS_ID):
 *      Business Discovery (public posts of other business/creator accounts, likes and comments counts)
 *      and Hashtag Search (30 distinct hashtags per 7 days). Not available with an "Instagram Login" token.
 *  - Threads API keyword search (THREADS_ACCESS_TOKEN with the threads_keyword_search permission).
 */

export class ApiLimitReached extends Error {}

async function getJson(url: string, headers: Record<string, string> = {}): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const res = await fetch(url, {headers, signal: ctrl.signal});
    const text = await res.text();
    let body: any;
    try {
      body = JSON.parse(text);
    } catch {
      body = {raw: text.slice(0, 300)};
    }
    if (res.status === 429 || body?.error?.code === 4 || body?.error?.code === 17 || body?.error?.code === 32 || /quota/i.test(body?.error?.message ?? '')) {
      throw new ApiLimitReached(`Limite de l'API atteinte (${res.status}) : ${body?.error?.message ?? ''}`);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} : ${body?.error?.message ?? text.slice(0, 200)}`);
    return body;
  } finally {
    clearTimeout(t);
  }
}

function isoDuration(d: string | undefined): number | null {
  if (!d) return null;
  const m = d.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return null;
  return (+(m[1] ?? 0)) * 3600 + (+(m[2] ?? 0)) * 60 + +(m[3] ?? 0);
}

export async function youtubeSearch(query: string, opts: {apiKey: string; maxResults?: number; publishedAfter?: string; regionCode?: string; lang?: string}): Promise<NormalizedPost[]> {
  const base = 'https://www.googleapis.com/youtube/v3';
  const qs = new URLSearchParams({
    part: 'snippet',
    q: query,
    type: 'video',
    videoDuration: 'short',
    order: 'viewCount',
    maxResults: String(Math.min(50, opts.maxResults ?? 50)),
    regionCode: opts.regionCode ?? 'FR',
    relevanceLanguage: opts.lang ?? 'fr',
    key: opts.apiKey,
  });
  if (opts.publishedAfter) qs.set('publishedAfter', opts.publishedAfter);
  const search = await getJson(`${base}/search?${qs}`);
  const ids: string[] = (search.items ?? []).map((i: any) => i.id?.videoId).filter(Boolean);
  if (!ids.length) return [];
  const vids = await getJson(`${base}/videos?${new URLSearchParams({part: 'snippet,statistics,contentDetails', id: ids.join(','), key: opts.apiKey})}`);
  return (vids.items ?? []).map((v: any) => ({
    platform: 'youtube',
    externalId: v.id,
    author: v.snippet?.channelTitle ?? null,
    url: `https://www.youtube.com/shorts/${v.id}`,
    publishedAt: v.snippet?.publishedAt ?? null,
    source: 'youtube-data-api',
    query,
    language: v.snippet?.defaultAudioLanguage ?? v.snippet?.defaultLanguage ?? null,
    mediaType: 'video',
    durationS: isoDuration(v.contentDetails?.duration),
    text: `${v.snippet?.title ?? ''}\n${v.snippet?.description ?? ''}`.trim(),
    hook: v.snippet?.title ?? null,
    views: Number(v.statistics?.viewCount ?? NaN),
    likes: Number(v.statistics?.likeCount ?? NaN),
    comments: Number(v.statistics?.commentCount ?? NaN),
  }));
}

const IG_FIELDS = 'caption,like_count,comments_count,media_type,media_product_type,timestamp,permalink,children{media_type}';

function igMedia(m: any, author: string | null, followers: number | null, source: string, query?: string): NormalizedPost {
  const carousel = m.media_type === 'CAROUSEL_ALBUM';
  return {
    platform: 'instagram',
    externalId: String(m.id),
    author,
    url: m.permalink ?? null,
    publishedAt: m.timestamp ?? null,
    source,
    query: query ?? null,
    mediaType: carousel ? 'carousel' : m.media_type === 'VIDEO' ? 'video' : 'image',
    slideCount: carousel ? (m.children?.data?.length ?? null) : null,
    text: m.caption ?? '',
    likes: m.like_count ?? null,
    comments: m.comments_count ?? null,
    followers,
  };
}

export async function instagramBusinessDiscovery(handle: string, opts: {token: string; igUserId: string; limit?: number; version?: string}): Promise<NormalizedPost[]> {
  const v = opts.version ?? 'v24.0';
  const fields = `business_discovery.username(${handle}){username,followers_count,media_count,media.limit(${Math.min(50, opts.limit ?? 50)}){${IG_FIELDS}}}`;
  const data = await getJson(`https://graph.facebook.com/${v}/${opts.igUserId}?${new URLSearchParams({fields, access_token: opts.token})}`);
  const bd = data.business_discovery ?? {};
  return (bd.media?.data ?? []).map((m: any) => igMedia(m, bd.username ?? handle, bd.followers_count ?? null, 'instagram-graph:business-discovery'));
}

export async function instagramHashtagTop(tag: string, opts: {token: string; igUserId: string; version?: string}): Promise<NormalizedPost[]> {
  const v = opts.version ?? 'v24.0';
  const q = tag.replace(/^#/, '');
  const found = await getJson(`https://graph.facebook.com/${v}/ig_hashtag_search?${new URLSearchParams({user_id: opts.igUserId, q, access_token: opts.token})}`);
  const hid = found.data?.[0]?.id;
  if (!hid) return [];
  const media = await getJson(`https://graph.facebook.com/${v}/${hid}/top_media?${new URLSearchParams({user_id: opts.igUserId, fields: IG_FIELDS, access_token: opts.token})}`);
  return (media.data ?? []).map((m: any) => igMedia(m, null, null, 'instagram-graph:hashtag', `#${q}`));
}

export async function threadsKeywordSearch(query: string, opts: {token: string}): Promise<NormalizedPost[]> {
  const data = await getJson(
    `https://graph.threads.net/v1.0/keyword_search?${new URLSearchParams({q: query, search_type: 'TOP', fields: 'id,text,media_type,permalink,timestamp,username,children', access_token: opts.token})}`,
  );
  return (data.data ?? []).map((t: any) => ({
    platform: 'threads',
    externalId: String(t.id),
    author: t.username ?? null,
    url: t.permalink ?? null,
    publishedAt: t.timestamp ?? null,
    source: 'threads-api:keyword-search',
    query,
    mediaType: t.media_type === 'CAROUSEL_ALBUM' ? 'carousel' : t.media_type === 'IMAGE' ? 'image' : t.media_type === 'VIDEO' ? 'video' : 'text',
    slideCount: t.children?.data?.length ?? null,
    text: t.text ?? '',
  }));
}

export interface CollectPlan {
  youtube?: string[];
  instagramHandles?: string[];
  instagramHashtags?: string[];
  threads?: string[];
}

/** Runs every official collector whose credentials are present; reports what was skipped and why. */
export async function collectOfficial(plan: CollectPlan, env: NodeJS.ProcessEnv = process.env): Promise<{posts: NormalizedPost[]; log: string[]}> {
  const posts: NormalizedPost[] = [];
  const log: string[] = [];
  const run = async (label: string, fn: () => Promise<NormalizedPost[]>) => {
    try {
      const got = await fn();
      posts.push(...got);
      log.push(`${label} : ${got.length} publications`);
    } catch (e) {
      log.push(`${label} : ${(e as Error).message}`);
      if (e instanceof ApiLimitReached) throw e;
    }
  };
  try {
    if (plan.youtube?.length) {
      if (!env.YOUTUBE_API_KEY) log.push('YouTube Data API : ignoré (YOUTUBE_API_KEY absente)');
      else for (const q of plan.youtube) await run(`YouTube « ${q} »`, () => youtubeSearch(q, {apiKey: env.YOUTUBE_API_KEY!}));
    }
    const igReady = env.META_GRAPH_TOKEN && env.IG_BUSINESS_ID;
    if (plan.instagramHandles?.length || plan.instagramHashtags?.length) {
      if (!igReady) log.push('Instagram Graph API : ignoré (META_GRAPH_TOKEN et IG_BUSINESS_ID nécessaires, connexion Facebook)');
      else {
        for (const h of plan.instagramHandles ?? []) await run(`Instagram @${h}`, () => instagramBusinessDiscovery(h, {token: env.META_GRAPH_TOKEN!, igUserId: env.IG_BUSINESS_ID!}));
        for (const t of plan.instagramHashtags ?? []) await run(`Instagram ${t}`, () => instagramHashtagTop(t, {token: env.META_GRAPH_TOKEN!, igUserId: env.IG_BUSINESS_ID!}));
      }
    }
    if (plan.threads?.length) {
      if (!env.THREADS_ACCESS_TOKEN) log.push('Threads API : ignoré (THREADS_ACCESS_TOKEN absente)');
      else for (const q of plan.threads) await run(`Threads « ${q} »`, () => threadsKeywordSearch(q, {token: env.THREADS_ACCESS_TOKEN!}));
    }
  } catch (e) {
    if (e instanceof ApiLimitReached) log.push('Arrêt : limite d’API atteinte, reprise au prochain passage (aucun contournement).');
    else throw e;
  }
  return {posts, log};
}

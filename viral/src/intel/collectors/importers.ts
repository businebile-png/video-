import fs from 'node:fs';
import path from 'node:path';
import type {NormalizedPost} from '../store.js';
import type {Account} from '../../core/accounts.js';

/**
 * Importers for data that a Claude session fetched through a connector (MCP tools cannot be called from code):
 *  - Firecrawl / ScrapeCreators public posts (TikTok search & profiles, Instagram profiles, Threads, YouTube),
 *  - Zernio post analytics of our own accounts,
 *  - Metricool competitor posts (Instagram) and own analytics rows,
 *  - any JSON / JSON-lines / CSV export with the usual column names.
 * Each importer only maps fields; nothing is fetched here.
 */

export type ImportKind = 'auto' | 'scrapecreators' | 'zernio-analytics' | 'metricool-competitors' | 'generic';

const iso = (sec: number | string | null | undefined): string | null => {
  if (sec === null || sec === undefined || sec === '') return null;
  if (typeof sec === 'number') return new Date(sec < 1e12 ? sec * 1000 : sec).toISOString();
  const d = new Date(sec);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** Reads a file holding JSON, JSON lines, an MCP tool result ({result: "<json>"}) or CSV. */
export function readAnyJson(file: string): unknown {
  const raw = fs.readFileSync(file, 'utf8').trim();
  if (file.endsWith('.csv')) return parseCsv(raw);
  if (file.endsWith('.jsonl') || (raw.startsWith('{') && raw.includes('}\n{'))) {
    return raw
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));
  }
  let data: any = JSON.parse(raw);
  if (data && typeof data.result === 'string') {
    try {
      data = JSON.parse(data.result);
    } catch {
      /* plain text result */
    }
  }
  return data;
}

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (field += '"'), i++;
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',' || c === ';') cur.push(field), (field = '');
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      cur.push(field), rows.push(cur), (cur = []), (field = '');
    } else field += c;
  }
  if (field || cur.length) cur.push(field), rows.push(cur);
  const [head, ...body] = rows.filter((r) => r.some((x) => x.trim()));
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), r[i] ?? ''])));
}

function tiktokItem(it: any, query?: string): NormalizedPost | null {
  // Accepts both the raw ScrapeCreators record and the compact shape written by our jq extraction.
  const idv = it.aweme_id ?? it.id;
  if (!idv) return null;
  const st = it.statistics ?? it;
  const images = it.image_post_info?.images;
  const slides = Array.isArray(images) ? images.length : typeof it.slides === 'number' ? it.slides : 0;
  const author = it.author?.unique_id ?? (typeof it.author === 'string' ? it.author : null);
  return {
    platform: 'tiktok',
    externalId: String(idv),
    author,
    url: it.url ?? (author ? `https://www.tiktok.com/@${author}/${slides > 0 ? 'photo' : 'video'}/${idv}` : null),
    publishedAt: iso(it.create_time ?? it.t),
    source: 'firecrawl:scrapecreators',
    query: it.query ?? query ?? null,
    language: it.desc_language ?? it.lang ?? null,
    mediaType: slides > 0 ? 'carousel' : 'video',
    slideCount: slides > 0 ? slides : null,
    durationS: typeof (it.video?.duration ?? it.dur) === 'number' ? (it.video?.duration ?? it.dur) / 1000 : null,
    text: it.desc ?? '',
    views: st.play_count ?? st.views ?? null,
    likes: st.digg_count ?? st.likes ?? null,
    comments: st.comment_count ?? st.comments ?? null,
    shares: st.share_count ?? st.shares ?? null,
    saves: st.collect_count ?? st.saves ?? null,
    followers: it.author?.follower_count ?? it.followers ?? null,
    isPaid: !!(it.is_paid_partnership ?? it.paid ?? it.is_ad),
  };
}

function instagramItem(it: any): NormalizedPost | null {
  const idv = it.id ?? it.pk ?? it.code;
  if (!idv) return null;
  const carousel = it.media_type === 8 || it.carousel_media_count > 0 || Array.isArray(it.carousel_media);
  const slides = it.carousel_media_count ?? it.carousel_media?.length ?? null;
  const author = it.user?.username ?? it.owner?.username ?? null;
  return {
    platform: 'instagram',
    externalId: String(idv),
    author,
    url: it.url ?? (it.code ? `https://www.instagram.com/p/${it.code}/` : null),
    publishedAt: iso(it.taken_at),
    source: 'firecrawl:scrapecreators',
    mediaType: carousel ? 'carousel' : it.media_type === 2 ? 'video' : 'image',
    slideCount: carousel ? slides : null,
    text: it.caption?.text ?? (typeof it.caption === 'string' ? it.caption : ''),
    views: it.play_count ?? it.ig_play_count ?? null,
    likes: it.like_count ?? null,
    comments: it.comment_count ?? null,
    shares: null,
    saves: null,
    followers: it.user?.follower_count ?? null,
    isPaid: !!it.is_paid_partnership,
  };
}

function threadsItem(it: any): NormalizedPost | null {
  const p = it.post ?? it;
  const idv = p.id ?? p.pk ?? p.code;
  if (!idv) return null;
  const author = p.user?.username ?? null;
  return {
    platform: 'threads',
    externalId: String(idv),
    author,
    url: p.code && author ? `https://www.threads.com/@${author}/post/${p.code}` : null,
    publishedAt: iso(p.taken_at),
    source: 'firecrawl:scrapecreators',
    mediaType: p.carousel_media?.length ? 'carousel' : p.image_versions2 ? 'image' : 'text',
    slideCount: p.carousel_media?.length ?? null,
    text: p.caption?.text ?? p.text ?? '',
    views: p.view_counts ?? null,
    likes: p.like_count ?? null,
    comments: p.text_post_app_info?.direct_reply_count ?? p.direct_reply_count ?? null,
    shares: p.text_post_app_info?.reshare_count ?? p.reshare_count ?? null,
    saves: null,
  };
}

/** ScrapeCreators responses: search_item_list / aweme_list (TikTok), items (Instagram), threads / posts (Threads). */
export function fromScrapeCreators(data: any, hint?: {platform?: string; query?: string}): NormalizedPost[] {
  const rows: any[] = Array.isArray(data) ? data : [data];
  const out: NormalizedPost[] = [];
  for (const d of rows) {
    if (!d || typeof d !== 'object') continue;
    if (Array.isArray(d.search_item_list) || Array.isArray(d.aweme_list)) {
      for (const it of d.search_item_list ?? d.aweme_list) {
        const p = tiktokItem(it, hint?.query);
        if (p) out.push(p);
      }
    } else if (Array.isArray(d.items) && (hint?.platform ?? 'instagram') === 'instagram') {
      for (const it of d.items) {
        const p = instagramItem(it);
        if (p) out.push(p);
      }
    } else if (Array.isArray(d.threads) || Array.isArray(d.posts)) {
      for (const it of d.threads ?? d.posts) {
        const p = threadsItem(it);
        if (p) out.push(p);
      }
    } else if (d.aweme_id || (d.id && (d.desc !== undefined || d.views !== undefined))) {
      const p = tiktokItem(d, hint?.query);
      if (p) out.push(p);
    }
  }
  return out;
}

/** Zernio GET /v1/analytics (or the MCP analytics_get_analytics result): our own published posts. */
export function fromZernioAnalytics(data: any, accounts: Account[]): NormalizedPost[] {
  const posts: any[] = data?.posts ?? (Array.isArray(data) ? data : []);
  const out: NormalizedPost[] = [];
  for (const p of posts) {
    const platform = p.platform ?? p.platforms?.[0]?.platform;
    const pa = p.platforms?.find((x: any) => x.platform === platform) ?? p.platforms?.[0] ?? {};
    const acc = accounts.find((a) => a.platform === platform && (a.providerAccountId === (pa.accountId?._id ?? pa.accountId) || a.provider === 'zernio'));
    const a = p.analytics ?? {};
    const externalId = pa.platformPostId ?? p.platformPostId ?? p._id;
    if (!platform || !externalId) continue;
    out.push({
      platform,
      externalId: String(externalId),
      author: acc?.handle ?? pa.accountId?.username ?? null,
      isOwn: true,
      accountId: acc?.id ?? null,
      providerPostId: p._id ?? null,
      url: p.platformPostUrl ?? pa.platformPostUrl ?? null,
      publishedAt: iso(p.publishedAt ?? p.scheduledFor),
      source: 'zernio:analytics',
      mediaType: p.mediaType === 'image' || (p.mediaItems?.length ?? 0) > 1 ? 'carousel' : p.mediaType === 'video' ? 'video' : (p.mediaType ?? null),
      slideCount: p.mediaItems?.length > 1 ? p.mediaItems.length : null,
      text: p.content ?? '',
      views: a.views ?? a.impressions ?? null,
      likes: a.likes ?? null,
      comments: a.comments ?? null,
      shares: a.shares ?? null,
      saves: a.saves ?? null,
    });
  }
  return out;
}

/** Metricool getAnalyticsDataByMetrics rows for IG competitor posts (fields IGCP01…IGCP11). */
export function fromMetricoolCompetitors(data: any): NormalizedPost[] {
  const rows: any[] = data?.rows ?? (Array.isArray(data) ? data : []);
  return rows
    .map((r) => {
      const get = (k: string) => r[k] ?? r[k.toLowerCase()];
      const idv = get('IGCP02') ?? r.postId;
      if (!idv) return null;
      return {
        platform: 'instagram',
        externalId: String(idv),
        author: get('IGCP01') ?? r.screenName ?? null,
        url: get('IGCP11') ?? r.url ?? null,
        publishedAt: iso(get('IGCP06') ?? get('IGCP05') ?? r.timestamp),
        source: 'metricool:competitors',
        mediaType: null,
        text: get('IGCP04') ?? r.content ?? '',
        likes: Number(get('IGCP07') ?? r.likes ?? NaN),
        comments: Number(get('IGCP08') ?? r.comments ?? NaN),
      } as NormalizedPost;
    })
    .filter((p): p is NormalizedPost => !!p);
}

/** Any export with usual column names (platform, id, author, text/caption, views, likes, comments, shares, saves, slides, date). */
export function fromGeneric(data: any, platform?: string): NormalizedPost[] {
  const rows: any[] = Array.isArray(data) ? data : data?.items ?? data?.posts ?? data?.data ?? [];
  return rows
    .map((r) => {
      const idv = r.external_id ?? r.externalId ?? r.id ?? r.post_id ?? r.url;
      const pf = (r.platform ?? platform ?? '').toLowerCase();
      if (!idv || !pf) return null;
      const num = (x: any) => (x === undefined || x === '' ? null : Number(String(x).replace(/\s/g, '')));
      return {
        platform: pf,
        externalId: String(idv),
        author: r.author ?? r.account ?? r.username ?? r.handle ?? null,
        url: r.url ?? null,
        publishedAt: iso(r.published_at ?? r.publishedAt ?? r.date ?? r.timestamp),
        source: r.source ?? 'import',
        mediaType: r.media_type ?? r.mediaType ?? (num(r.slides ?? r.slide_count) ? 'carousel' : null),
        slideCount: num(r.slides ?? r.slide_count),
        text: r.text ?? r.caption ?? r.content ?? r.desc ?? '',
        hook: r.hook ?? null,
        views: num(r.views ?? r.plays ?? r.impressions),
        likes: num(r.likes),
        comments: num(r.comments),
        shares: num(r.shares),
        saves: num(r.saves),
        followers: num(r.followers),
      } as NormalizedPost;
    })
    .filter((p): p is NormalizedPost => !!p);
}

export function detectKind(data: any): Exclude<ImportKind, 'auto'> {
  const first = Array.isArray(data) ? data[0] : data;
  if (!first) return 'generic';
  if (first.search_item_list || first.aweme_list || first.aweme_id || (first.desc !== undefined && first.id)) return 'scrapecreators';
  if (data?.posts && data?.overview) return 'zernio-analytics';
  if (data?.rows && (data.rows[0]?.IGCP02 || data.rows.length === 0)) return 'metricool-competitors';
  if (first.items && first.user) return 'scrapecreators';
  return 'generic';
}

export function importFile(file: string, accounts: Account[], kind: ImportKind = 'auto', hint: {platform?: string; query?: string} = {}): {kind: string; posts: NormalizedPost[]} {
  const data = readAnyJson(file);
  const k = kind === 'auto' ? detectKind(data) : kind;
  const posts =
    k === 'scrapecreators'
      ? fromScrapeCreators(data, hint)
      : k === 'zernio-analytics'
        ? fromZernioAnalytics(data, accounts)
        : k === 'metricool-competitors'
          ? fromMetricoolCompetitors(data)
          : fromGeneric(data, hint.platform);
  return {kind: `${k}:${path.basename(file)}`, posts};
}

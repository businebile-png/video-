import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {HttpError, httpJson} from '../core/http.js';
import {PATHS} from '../core/paths.js';
import {exists, readJson, writeJson} from '../core/fsx.js';
import type {PexelsSearch, PexelsVideo} from './pexels.js';

/**
 * Pixabay videos (free, commercial use allowed, no attribution required).
 * The key only travels as the `key` query parameter (no header form), so it comes from the
 * PIXABAY_API_KEY environment variable; error messages mask it (redactUrl).
 * Pixabay asks API users to cache searches for 24 h: done under .cache/pixabay.
 */
const API = 'https://pixabay.com/api/videos/';
const CACHE_HOURS = 24;

interface Rendition {
  url: string;
  width: number;
  height: number;
  size: number;
  thumbnail?: string;
}

export interface PixabayHit {
  id: number;
  pageURL: string;
  type: string;
  tags: string;
  duration: number;
  videos: Partial<Record<'large' | 'medium' | 'small' | 'tiny', Rendition>>;
  user_id: number;
  user: string;
}

interface PixabayResponse {
  total: number;
  totalHits: number;
  hits: PixabayHit[];
}

const RENDITIONS = ['large', 'medium', 'small', 'tiny'] as const;

/** Same shape as a Pexels video, so selection, contact sheets and licences work unchanged. */
export function pixabayToVideo(hit: PixabayHit): PexelsVideo | null {
  const files = RENDITIONS.map((q) => [q, hit.videos?.[q]] as const).filter(
    (entry): entry is readonly [(typeof RENDITIONS)[number], Rendition] => Boolean(entry[1]?.url && entry[1].width && entry[1].height),
  );
  if (files.length === 0) return null;
  const [, best] = files[0]!;
  const thumbnail = hit.videos.medium?.thumbnail || hit.videos.large?.thumbnail || hit.videos.small?.thumbnail || '';
  return {
    id: hit.id,
    width: best.width,
    height: best.height,
    url: hit.pageURL,
    image: thumbnail,
    duration: hit.duration,
    user: {id: hit.user_id, name: hit.user, url: `https://pixabay.com/users/${encodeURIComponent(hit.user)}-${hit.user_id}/`},
    video_files: files.map(([quality, r], i) => ({id: i, quality, file_type: 'video/mp4', width: r.width, height: r.height, fps: null, link: r.url})),
    video_pictures: thumbnail ? [{id: 0, picture: thumbnail, nr: 0}] : [],
    keywords: (hit.tags ?? '')
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean),
  };
}

function keyOrThrow(): string {
  const key = process.env.PIXABAY_API_KEY?.trim();
  if (!key) {
    throw new Error(
      'Clé Pixabay absente : créez une clé gratuite (https://pixabay.com/api/docs/) puis ajoutez la variable ' +
        'PIXABAY_API_KEY dans les réglages de l’environnement (Environment variables) — voir l’onglet Démarrage du panneau.',
    );
  }
  return key;
}

/** Search films (no animations), safe content only; orientation is not a Pixabay filter (vertical clips are scored higher later). */
export async function searchPixabay(query: string, opts: {perPage?: number; page?: number} = {}): Promise<PexelsSearch> {
  const perPage = Math.min(200, Math.max(3, opts.perPage ?? 20));
  const page = opts.page ?? 1;
  const params = {q: query.slice(0, 100), video_type: 'film', safesearch: 'true', order: 'popular', per_page: String(perPage), page: String(page)};
  const cacheFile = path.join(PATHS.cache, 'pixabay', `${crypto.createHash('sha1').update(JSON.stringify(params)).digest('hex')}.json`);
  if (exists(cacheFile)) {
    const cached = await readJson<{fetchedAt: string; data: PixabayResponse}>(cacheFile);
    if (Date.now() - Date.parse(cached.fetchedAt) < CACHE_HOURS * 3_600_000) return toSearch(cached.data, page, perPage);
  }
  const url = `${API}?${new URLSearchParams({key: keyOrThrow(), ...params}).toString()}`;
  let data: PixabayResponse;
  try {
    data = await httpJson<PixabayResponse>(url, {timeoutMs: 30_000});
  } catch (err) {
    if (err instanceof HttpError && (err.status === 400 || err.status === 401 || err.status === 403) && /key/i.test(err.body)) {
      throw new Error('Clé Pixabay refusée : vérifiez la valeur de PIXABAY_API_KEY (la clé affichée sur https://pixabay.com/api/docs/ une fois connecté).');
    }
    if (err instanceof HttpError && err.status === 429) throw new Error('Quota Pixabay atteint (100 requêtes par minute) : réessayez dans une minute.');
    throw err;
  }
  await fsp.mkdir(path.dirname(cacheFile), {recursive: true});
  await writeJson(cacheFile, {fetchedAt: new Date().toISOString(), data});
  return toSearch(data, page, perPage);
}

function toSearch(data: PixabayResponse, page: number, perPage: number): PexelsSearch {
  const videos = (data.hits ?? []).map(pixabayToVideo).filter((v): v is PexelsVideo => v !== null);
  return {page, per_page: perPage, total_results: data.totalHits ?? videos.length, videos};
}

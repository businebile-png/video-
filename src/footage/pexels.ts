import {httpJson} from '../core/http.js';

const API = 'https://api.pexels.com';

export interface PexelsVideoFile {
  id: number;
  quality: string | null;
  file_type: string;
  width: number | null;
  height: number | null;
  fps: number | null;
  link: string;
}

export interface PexelsVideo {
  id: number;
  width: number;
  height: number;
  url: string;
  image: string;
  duration: number;
  user: {id: number; name: string; url: string};
  video_files: PexelsVideoFile[];
  video_pictures: Array<{id: number; picture: string; nr: number}>;
}

export interface PexelsSearch {
  page: number;
  per_page: number;
  total_results: number;
  videos: PexelsVideo[];
}

/**
 * Pexels expects the raw key in the Authorization header (no "Bearer").
 * PEXELS_API_KEY is used when set; otherwise the request goes out without it so a
 * proxy-injected credential can apply (Claude Code cloud environments).
 */
function headers(): Record<string, string> {
  const h: Record<string, string> = {accept: 'application/json'};
  if (process.env.PEXELS_API_KEY) h.authorization = process.env.PEXELS_API_KEY;
  return h;
}

export async function searchVideos(query: string, opts: {orientation?: 'portrait' | 'landscape'; perPage?: number; page?: number} = {}): Promise<PexelsSearch> {
  const params = new URLSearchParams({query, per_page: String(opts.perPage ?? 20), page: String(opts.page ?? 1), size: 'medium'});
  if (opts.orientation) params.set('orientation', opts.orientation);
  return httpJson<PexelsSearch>(`${API}/videos/search?${params.toString()}`, {headers: headers(), timeoutMs: 30_000});
}

export async function getVideo(id: number): Promise<PexelsVideo> {
  return httpJson<PexelsVideo>(`${API}/videos/videos/${id}`, {headers: headers(), timeoutMs: 30_000});
}

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {EnvHttpProxyAgent, fetch as undiciFetch, setGlobalDispatcher, type RequestInit, type Response} from 'undici';

// Cloud sessions route HTTPS through a local proxy (HTTPS_PROXY). Node's built-in
// fetch ignores it, so every request goes through undici with an env-aware agent.
if (process.env.HTTPS_PROXY || process.env.https_proxy) {
  setGlobalDispatcher(new EnvHttpProxyAgent());
}

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
    readonly url: string,
  ) {
    super(message);
  }
}

export interface HttpOptions extends RequestInit {
  timeoutMs?: number;
  retries?: number;
  /** HTTP statuses worth retrying (rate limit + transient server errors). */
  retryOn?: number[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Redact obvious secrets before an URL ends up in a log or an error. */
export function redactUrl(url: string): string {
  return url.replace(/([?&](?:key|token|api_key|access_token)=)[^&]+/gi, '$1***');
}

export async function http(url: string, opts: HttpOptions = {}): Promise<Response> {
  const {timeoutMs = 60_000, retries = 3, retryOn = [408, 425, 429, 500, 502, 503, 504], ...init} = opts;
  let attempt = 0;
  let lastErr: unknown;
  while (attempt <= retries) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await undiciFetch(url, {...init, signal: ctrl.signal});
      clearTimeout(timer);
      if (retryOn.includes(res.status) && attempt < retries) {
        const retryAfter = Number(res.headers.get('retry-after'));
        const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 2000;
        await res.body?.cancel();
        await sleep(Math.min(wait, 60_000));
        attempt++;
        continue;
      }
      return res;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (attempt >= retries) break;
      await sleep(2 ** attempt * 2000);
      attempt++;
    }
  }
  throw new Error(`Requête impossible vers ${redactUrl(url)} : ${(lastErr as Error)?.message ?? 'erreur inconnue'}`);
}

export async function httpJson<T>(url: string, opts: HttpOptions = {}): Promise<T> {
  const res = await http(url, opts);
  const text = await res.text();
  if (!res.ok) {
    throw new HttpError(`HTTP ${res.status} sur ${redactUrl(url)} : ${text.slice(0, 400)}`, res.status, text, url);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(`Réponse non JSON de ${redactUrl(url)}`, res.status, text.slice(0, 400), url);
  }
}

/** Stream a remote file to disk (atomic rename), returning the byte count. */
export async function downloadTo(url: string, dest: string, opts: HttpOptions = {}): Promise<number> {
  const res = await http(url, {timeoutMs: 300_000, ...opts});
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => '');
    throw new HttpError(`Téléchargement refusé (${res.status}) : ${redactUrl(url)}`, res.status, body.slice(0, 300), url);
  }
  await fsp.mkdir(path.dirname(dest), {recursive: true});
  const tmp = `${dest}.part`;
  await pipeline(Readable.fromWeb(res.body as never), fs.createWriteStream(tmp));
  await fsp.rename(tmp, dest);
  return (await fsp.stat(dest)).size;
}

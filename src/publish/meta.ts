/**
 * Publication directe sur Instagram (Reels) et Threads avec les API officielles de Meta.
 *
 * Gratuite et indépendante de Metricool et de Zernio (quota mensuel, comptes payants). Lancée par GitHub Actions aux
 * créneaux de 10:00 et 20:00 (`.github/workflows/publier-meta.yml`) : voir `docs/publication-meta.md`.
 * Sans dépendance du studio (Node 22 + fetch) : le workflow n'a pas besoin de `npm ci`.
 *
 *   tsx src/publish/meta.ts verifier                                    contrôle les jetons, ne publie rien
 *   tsx src/publish/meta.ts publier [--simuler] [--maintenant <iso>] [--attendre <minutes>]
 */
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export const IG_BASE = 'https://graph.instagram.com/v27.0';
export const THREADS_BASE = 'https://graph.threads.com/v1.0';
export const STATE_FILE = path.join('data', 'meta-publications.json');
/** Une vidéo n'est plus publiée plus de 5 h après son créneau (le créneau suivant la remplacerait). */
export const WINDOW_HOURS = 5;
export const MAX_ATTEMPTS = 3;
export const THREADS_MAX_CHARS = 500;

export type MetaNetwork = 'instagram' | 'threads';
export const META_NETWORKS: MetaNetwork[] = ['instagram', 'threads'];
const TOKEN_ENV: Record<MetaNetwork, string> = {instagram: 'INSTAGRAM_ACCESS_TOKEN', threads: 'THREADS_ACCESS_TOKEN'};

export interface QueuePost {
  network: string;
  text?: string;
  info?: {firstCommentText?: string; videoCoverMilliseconds?: number};
}

export interface QueueEntry {
  runId: string;
  status?: string;
  autoSlot?: {iso?: string; label?: string};
  requestedSlot?: {iso?: string; label?: string};
  score?: {decision?: string};
  media?: {publicUrl?: string};
  posts?: QueuePost[];
}

export interface NetworkState {
  status: 'published' | 'failed' | 'skipped';
  id?: string;
  permalink?: string;
  at: string;
  attempts?: number;
  error?: string;
  reason?: string;
}

export interface MetaState {
  version: 1;
  /** Posé à la main une fois les jetons contrôlés (« verifier ») : alors Instagram et Threads ne passent plus par Metricool ni Zernio. */
  actif?: boolean;
  posts: Record<string, Partial<Record<MetaNetwork, NetworkState>>>;
}

export interface Due {
  entry: QueueEntry;
  network: MetaNetwork;
  slot: number;
  text: string;
  firstComment: string;
  coverMs: number;
}

export type Classified =
  | {kind: 'due'; due: Due}
  | {kind: 'upcoming'; slot: number; runId: string; network: MetaNetwork}
  | {kind: 'skip'; runId: string; network: MetaNetwork; reason: string; slot: number | null};

type Env = Record<string, string | undefined>;
type Sleep = (ms: number) => Promise<void>;

export class MetaApiError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// État et file d'attente
// ---------------------------------------------------------------------------------------------------------------

export function emptyState(): MetaState {
  return {version: 1, posts: {}};
}

export function readState(root: string): MetaState {
  const file = path.join(root, STATE_FILE);
  if (!fs.existsSync(file)) return emptyState();
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<MetaState>;
    return {...parsed, version: 1, posts: parsed.posts ?? {}};
  } catch {
    throw new Error(`${STATE_FILE} illisible : réparez-le à la main (aucune publication n'est tentée tant qu'il est cassé).`);
  }
}

export function writeState(root: string, state: MetaState): void {
  const file = path.join(root, STATE_FILE);
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, JSON.stringify(state, null, 2) + '\n');
}

export function readQueue(root: string): QueueEntry[] {
  const dir = path.join(root, 'queue');
  if (!fs.existsSync(dir)) return [];
  const entries: QueueEntry[] = [];
  for (const f of fs.readdirSync(dir).sort()) {
    if (!f.endsWith('.json') || f === 'claude-en-cours.json') continue;
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as QueueEntry;
      if (j && typeof j.runId === 'string') entries.push(j);
    } catch {
      // Un fichier illisible de la file ne doit pas bloquer les autres vidéos.
    }
  }
  return entries;
}

export function slotMs(entry: QueueEntry): number | null {
  const iso = entry.requestedSlot?.iso ?? entry.autoSlot?.iso;
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

export function tokenFor(env: Env, network: MetaNetwork): string | null {
  const v = env[TOKEN_ENV[network]]?.trim();
  return v ? v : null;
}

/** Longueur au sens de Threads : les emojis comptent pour leur nombre d'octets UTF-8. */
export function threadsLength(text: string): number {
  let n = 0;
  for (const ch of text) n += (ch.codePointAt(0) ?? 0) >= 0x1f000 ? Buffer.byteLength(ch) : 1;
  return n;
}

/** Raccourcit au dernier mot entier (ajoute « … ») si le texte dépasse la limite de Threads ; sinon le laisse tel quel. */
export function fitThreads(text: string, max = THREADS_MAX_CHARS): string {
  if (threadsLength(text) <= max) return text;
  const words = text.split(/(\s+)/);
  let out = '';
  for (const w of words) {
    if (threadsLength(out + w + '…') > max) break;
    out += w;
  }
  return out.trimEnd() + '…';
}

/**
 * Dit, pour chaque vidéo de la file et chaque réseau Meta, si elle est à publier maintenant, à venir, ou à laisser.
 * Les contrôles de publication (« publishable », mention « Publicité ») sont refaits ici : la file est lue sans le panneau.
 */
export function classify(entry: QueueEntry, network: MetaNetwork, state: MetaState, env: Env, nowMs: number, windowHours = WINDOW_HOURS): Classified {
  const runId = entry.runId;
  const slot = slotMs(entry);
  const skip = (reason: string): Classified => ({kind: 'skip', runId, network, reason, slot});
  if (!tokenFor(env, network)) return skip(`jeton ${TOKEN_ENV[network]} absent`);
  const done = state.posts[runId]?.[network];
  if (done?.status === 'published') return skip('déjà publié');
  if (done?.status === 'skipped') return skip(`laissé de côté${done.reason ? ` : ${done.reason}` : ''}`);
  if (done?.status === 'failed' && (done.attempts ?? 1) >= MAX_ATTEMPTS) return skip(`${MAX_ATTEMPTS} essais échoués`);
  if (entry.score?.decision !== 'publishable') return skip('pas « publishable »');
  const post = entry.posts?.find((p) => p.network === network);
  if (!post?.text) return skip(`pas de légende ${network} dans la file`);
  if (!/^\s*publicit/i.test(post.text)) return skip('la légende ne commence pas par « Publicité »');
  if (!entry.media?.publicUrl) return skip('adresse de la vidéo absente');
  if (slot === null) return skip('créneau absent');
  if (nowMs < slot) return {kind: 'upcoming', slot, runId, network};
  if (nowMs > slot + windowHours * 3_600_000) return skip(`créneau dépassé de plus de ${windowHours} h`);
  const text = network === 'threads' ? fitThreads(post.text) : post.text;
  return {
    kind: 'due',
    due: {entry, network, slot, text, firstComment: post.info?.firstCommentText?.trim() ?? '', coverMs: Number(post.info?.videoCoverMilliseconds ?? 0) || 0},
  };
}

export function classifyAll(entries: QueueEntry[], state: MetaState, env: Env, nowMs: number): Classified[] {
  const out: Classified[] = [];
  for (const entry of entries) for (const network of META_NETWORKS) out.push(classify(entry, network, state, env, nowMs));
  return out;
}

/**
 * Adresses où Meta peut télécharger la vidéo, de la plus sûre à la moins sûre :
 *  1. jsDelivr et 2. githack (Cloudflare) : type MIME `video/mp4`, épinglées sur le commit `META_MEDIA_REF` que le workflow
 *     vient de récupérer (jsDelivr ne sert pas les fichiers de plus de 20 Mo) ;
 *  3. GitHub brut (adresse de la file) : servi en `application/octet-stream`, que Meta peut refuser.
 * `rankMediaUrls` les interroge avant de s'en servir et ne garde que celles qui répondent avec un vrai type vidéo.
 */
export function mediaUrls(entry: QueueEntry, env: Env = {}): string[] {
  const primary = entry.media?.publicUrl;
  if (!primary) return [];
  const m = /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/.+?\/(videos\/[^/]+\.mp4)$/.exec(primary);
  const repo = m ? `${m[1]}/${m[2]}` : env.GITHUB_REPOSITORY;
  const ref = env.META_MEDIA_REF?.trim();
  const file = m ? m[3] : `videos/${entry.runId}.mp4`;
  const urls: string[] = [];
  if (repo && ref) {
    urls.push(`https://cdn.jsdelivr.net/gh/${repo}@${ref}/${file}`);
    urls.push(`https://rawcdn.githack.com/${repo}/${ref}/${file}`);
  }
  urls.push(primary);
  return urls;
}

export interface MediaProbe {
  url: string;
  /** Code HTTP ; 0 si l'adresse n'a pas répondu. */
  status: number;
  contentType: string;
  /** Taille totale du fichier en octets, si le serveur la donne. */
  size: number | null;
  /** 0 = vidéo bien typée (`video/*`) · 1 = type générique (`application/octet-stream`) · 2 = inutilisable. */
  rank: 0 | 1 | 2;
}

const PROBE_TIMEOUT_MS = 20_000;
/** En dessous, ce n'est pas une vidéo (page d'erreur, fichier tronqué). */
const MIN_VIDEO_BYTES = 50_000;

/** Interroge une adresse (un seul octet demandé, par Range) : code HTTP, type MIME et taille du fichier. */
export async function probeMedia(fetchFn: typeof fetch, url: string): Promise<MediaProbe> {
  try {
    const res = await fetchFn(url, {method: 'GET', headers: {range: 'bytes=0-1'}, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)});
    void res.body?.cancel().catch(() => {});
    const contentType = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    const total = /\/(\d+)\s*$/.exec(res.headers.get('content-range') ?? '');
    const length = Number(res.headers.get('content-length'));
    const size = total ? Number(total[1]) : res.status === 200 && Number.isFinite(length) && length > 0 ? length : null;
    const answered = res.status === 200 || res.status === 206;
    let rank: MediaProbe['rank'] = 2;
    if (answered && (size === null || size >= MIN_VIDEO_BYTES)) {
      if (contentType.startsWith('video/')) rank = 0;
      else if (/^(application|binary)\/octet-stream$/.test(contentType)) rank = 1;
    }
    return {url, status: res.status, contentType, size, rank};
  } catch {
    return {url, status: 0, contentType: '', size: null, rank: 2};
  }
}

export function describeProbe(p: MediaProbe): string {
  const host = (() => {
    try {
      return new URL(p.url).hostname;
    } catch {
      return p.url;
    }
  })();
  const answer = p.status ? `HTTP ${p.status}` : 'sans réponse';
  const type = p.contentType || 'type inconnu';
  const size = p.size ? ` · ${(p.size / 1_048_576).toFixed(1)} Mo` : '';
  const verdict = p.rank === 0 ? 'utilisable' : p.rank === 1 ? 'type générique, en dernier recours' : 'écartée';
  return `${host} : ${answer} · ${type}${size} → ${verdict}`;
}

/**
 * Interroge toutes les adresses et les range : vidéos bien typées d'abord (dans l'ordre d'origine), puis type générique.
 * Si aucune ne répond correctement (panne passagère côté GitHub Actions ?), garde l'ordre d'origine : Meta peut quand même y accéder.
 */
export async function rankMediaUrls(fetchFn: typeof fetch, urls: string[]): Promise<{urls: string[]; probes: MediaProbe[]}> {
  const probes = await Promise.all(urls.map((u) => probeMedia(fetchFn, u)));
  const usable = probes.filter((p) => p.rank < 2).sort((a, b) => a.rank - b.rank);
  return {urls: (usable.length ? usable : probes).map((p) => p.url), probes};
}

// ---------------------------------------------------------------------------------------------------------------
// Appels à l'API Graph
// ---------------------------------------------------------------------------------------------------------------

interface Ctx {
  fetchFn: typeof fetch;
  sleep: Sleep;
  log: (message: string) => void;
  pollMs: number;
  maxPolls: number;
}

type Params = Record<string, string | number | boolean | undefined>;

function redact(text: string, secrets: string[]): string {
  let out = text;
  for (const s of secrets) if (s) out = out.split(s).join('***');
  return out.replace(/access_token=[^&\s"]+/gi, 'access_token=***');
}

async function graph(ctx: Ctx, method: 'GET' | 'POST', url: string, params: Params, token: string): Promise<Record<string, any>> {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) body.set(k, String(v));
  body.set('access_token', token);
  const where = url.replace(/^https:\/\/[^/]+\/[^/]+/, '');
  const res =
    method === 'GET'
      ? await ctx.fetchFn(`${url}?${body.toString()}`, {method})
      : await ctx.fetchFn(url, {method, headers: {'content-type': 'application/x-www-form-urlencoded'}, body});
  const raw = await res.text();
  let json: Record<string, any> = {};
  try {
    json = raw ? (JSON.parse(raw) as Record<string, any>) : {};
  } catch {
    // Réponse non JSON : traitée comme une erreur plus bas.
  }
  if (!res.ok || json.error) {
    const e = (json.error ?? {}) as {message?: string; code?: number; error_subcode?: number; error_user_msg?: string};
    const detail = e.error_user_msg || e.message || raw.slice(0, 200) || 'réponse vide';
    const codes = [e.code, e.error_subcode].filter((x) => x !== undefined).join('/');
    throw new MetaApiError(redact(`Meta ${method} ${where} : ${detail} (HTTP ${res.status}${codes ? `, code ${codes}` : ''})`, [token]), res.status);
  }
  return json;
}

/** Attend que Meta ait fini de traiter la vidéo (toutes les 15 s, 10 minutes au plus). */
async function waitFinished(ctx: Ctx, token: string, url: string, fields: string, field: string): Promise<void> {
  for (let i = 0; i < ctx.maxPolls; i++) {
    const j = await graph(ctx, 'GET', url, {fields}, token);
    const status = String(j[field] ?? '').toUpperCase();
    if (status === 'FINISHED' || status === 'PUBLISHED') return;
    if (status === 'ERROR' || status === 'EXPIRED') {
      const more = [j.status, j.error_message].filter((x) => typeof x === 'string' && x).join(' · ');
      throw new MetaApiError(`Meta refuse la vidéo (${status}${more ? ` : ${more}` : ''})`);
    }
    await ctx.sleep(ctx.pollMs);
  }
  throw new MetaApiError(`Meta n'a pas fini de traiter la vidéo en ${Math.round((ctx.pollMs * ctx.maxPolls) / 60_000)} minutes`);
}

export interface Account {
  id: string;
  username: string;
  detail?: string;
}

export async function instagramAccount(ctx: Ctx, token: string): Promise<Account> {
  const j = await graph(ctx, 'GET', `${IG_BASE}/me`, {fields: 'user_id,username,account_type'}, token);
  const u = (Array.isArray(j.data) ? j.data[0] : j) as Record<string, unknown> | undefined;
  const id = String(u?.user_id ?? u?.id ?? '');
  if (!id) throw new MetaApiError("Instagram : identifiant du compte introuvable (jeton invalide ou expiré ?)");
  return {id, username: String(u?.username ?? ''), detail: u?.account_type ? String(u.account_type) : undefined};
}

export async function threadsAccount(ctx: Ctx, token: string): Promise<Account> {
  const j = await graph(ctx, 'GET', `${THREADS_BASE}/me`, {fields: 'id,username'}, token);
  const id = String(j.id ?? '');
  if (!id) throw new MetaApiError('Threads : identifiant du compte introuvable (jeton invalide ou expiré ?)');
  return {id, username: String(j.username ?? '')};
}

async function publishInstagram(ctx: Ctx, token: string, d: Due, urls: string[]): Promise<{id: string; permalink?: string; note?: string}> {
  const me = await instagramAccount(ctx, token);
  let lastError: unknown = new MetaApiError('aucune adresse de vidéo');
  for (const url of urls) {
    let containerId: string;
    try {
      const c = await graph(
        ctx,
        'POST',
        `${IG_BASE}/${me.id}/media`,
        {media_type: 'REELS', video_url: url, caption: d.text, share_to_feed: true, is_ai_generated: true, thumb_offset: d.coverMs > 0 ? d.coverMs : undefined},
        token,
      );
      containerId = String(c.id);
      await waitFinished(ctx, token, `${IG_BASE}/${containerId}`, 'status_code,status', 'status_code');
    } catch (e) {
      // Avant la publication : on peut essayer l'adresse suivante sans risque de doublon.
      lastError = e;
      ctx.log(`  Instagram : ${(e as Error).message} — adresse suivante`);
      continue;
    }
    const p = await graph(ctx, 'POST', `${IG_BASE}/${me.id}/media_publish`, {creation_id: containerId}, token);
    const id = String(p.id);
    let permalink: string | undefined;
    let note: string | undefined;
    try {
      permalink = String((await graph(ctx, 'GET', `${IG_BASE}/${id}`, {fields: 'permalink'}, token)).permalink ?? '') || undefined;
    } catch {
      note = 'adresse du Reel non lue';
    }
    if (d.firstComment) {
      try {
        await graph(ctx, 'POST', `${IG_BASE}/${id}/comments`, {message: d.firstComment}, token);
      } catch (e) {
        note = `${note ? `${note} ; ` : ''}premier commentaire non posté (${(e as Error).message.slice(0, 120)})`;
      }
    }
    return {id, permalink, note};
  }
  throw lastError;
}

async function publishThreads(ctx: Ctx, token: string, d: Due, urls: string[]): Promise<{id: string; permalink?: string; note?: string}> {
  const me = await threadsAccount(ctx, token);
  let lastError: unknown = new MetaApiError('aucune adresse de vidéo');
  for (const url of urls) {
    let containerId: string;
    try {
      const c = await graph(ctx, 'POST', `${THREADS_BASE}/${me.id}/threads`, {media_type: 'VIDEO', video_url: url, text: d.text, is_made_with_ai: true}, token);
      containerId = String(c.id);
      await waitFinished(ctx, token, `${THREADS_BASE}/${containerId}`, 'status,error_message', 'status');
    } catch (e) {
      lastError = e;
      ctx.log(`  Threads : ${(e as Error).message} — adresse suivante`);
      continue;
    }
    const p = await graph(ctx, 'POST', `${THREADS_BASE}/${me.id}/threads_publish`, {creation_id: containerId}, token);
    const id = String(p.id);
    let permalink: string | undefined;
    let note: string | undefined;
    try {
      permalink = String((await graph(ctx, 'GET', `${THREADS_BASE}/${id}`, {fields: 'permalink'}, token)).permalink ?? '') || undefined;
    } catch {
      note = 'adresse du post non lue';
    }
    return {id, permalink, note};
  }
  throw lastError;
}

// ---------------------------------------------------------------------------------------------------------------
// Exécution
// ---------------------------------------------------------------------------------------------------------------

export interface RunOptions {
  root: string;
  env: Env;
  nowFn?: () => number;
  fetchFn?: typeof fetch;
  sleep?: Sleep;
  dryRun?: boolean;
  /** Si un créneau tombe dans les N prochaines minutes, attend qu'il arrive (le workflow démarre un peu avant l'heure). */
  waitMinutes?: number;
  log?: (message: string) => void;
  pollMs?: number;
  maxPolls?: number;
}

export interface RunResult {
  published: Array<{runId: string; network: MetaNetwork; id: string; permalink?: string}>;
  failed: Array<{runId: string; network: MetaNetwork; error: string}>;
  planned: Array<{runId: string; network: MetaNetwork}>;
  ignored: Array<{runId: string; network: MetaNetwork; reason: string}>;
}

function makeCtx(opts: RunOptions): Ctx {
  return {
    fetchFn: opts.fetchFn ?? fetch,
    sleep: opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
    log: opts.log ?? ((m) => console.log(m)),
    pollMs: opts.pollMs ?? 15_000,
    maxPolls: opts.maxPolls ?? 40,
  };
}

export async function runDue(opts: RunOptions): Promise<RunResult> {
  const ctx = makeCtx(opts);
  const nowFn = opts.nowFn ?? (() => Date.now());
  const state = readState(opts.root);
  const entries = readQueue(opts.root);
  const result: RunResult = {published: [], failed: [], planned: [], ignored: []};

  let all = classifyAll(entries, state, opts.env, nowFn());
  const upcoming = all.filter((c): c is Extract<Classified, {kind: 'upcoming'}> => c.kind === 'upcoming');
  if (opts.waitMinutes && upcoming.length && !opts.dryRun) {
    const next = Math.min(...upcoming.map((u) => u.slot));
    const delta = next - nowFn();
    if (delta > 0 && delta <= opts.waitMinutes * 60_000) {
      ctx.log(`Créneau dans ${Math.ceil(delta / 60_000)} min : attente.`);
      await ctx.sleep(delta + 2_000);
      all = classifyAll(entries, state, opts.env, nowFn());
    }
  }

  for (const c of all) {
    if (c.kind === 'skip' && c.slot !== null && Math.abs(nowFn() - c.slot) < 24 * 3_600_000) result.ignored.push({runId: c.runId, network: c.network, reason: c.reason});
  }
  const due = all
    .filter((c): c is Extract<Classified, {kind: 'due'}> => c.kind === 'due')
    .map((c) => c.due)
    .sort((a, b) => a.slot - b.slot || META_NETWORKS.indexOf(a.network) - META_NETWORKS.indexOf(b.network));

  // Les adresses de la vidéo sont interrogées une seule fois par vidéo (Instagram et Threads partagent le résultat).
  const ranked = new Map<string, string[]>();
  for (const d of due) {
    const label = `${d.entry.runId} → ${d.network}`;
    if (opts.dryRun) {
      ctx.log(`SIMULATION : publierait ${label} (créneau ${new Date(d.slot).toISOString()}, légende de ${d.text.length} caractères)`);
      result.planned.push({runId: d.entry.runId, network: d.network});
      continue;
    }
    const token = tokenFor(opts.env, d.network)!;
    let urls = ranked.get(d.entry.runId);
    if (!urls) {
      const r = await rankMediaUrls(ctx.fetchFn, mediaUrls(d.entry, opts.env));
      for (const p of r.probes) ctx.log(`  Vidéo ${d.entry.runId} — ${describeProbe(p)}`);
      urls = r.urls;
      ranked.set(d.entry.runId, urls);
    }
    const previous = state.posts[d.entry.runId]?.[d.network];
    try {
      ctx.log(`Publication ${label}…`);
      const r = d.network === 'instagram' ? await publishInstagram(ctx, token, d, urls) : await publishThreads(ctx, token, d, urls);
      (state.posts[d.entry.runId] ??= {})[d.network] = {status: 'published', id: r.id, permalink: r.permalink, at: new Date(nowFn()).toISOString(), ...(r.note ? {reason: r.note} : {})};
      result.published.push({runId: d.entry.runId, network: d.network, id: r.id, permalink: r.permalink});
      ctx.log(`✓ ${label} publié${r.permalink ? ` : ${r.permalink}` : ''}${r.note ? ` (${r.note})` : ''}`);
    } catch (e) {
      const message = redact((e as Error).message, [token]);
      (state.posts[d.entry.runId] ??= {})[d.network] = {status: 'failed', at: new Date(nowFn()).toISOString(), attempts: (previous?.attempts ?? 0) + 1, error: message.slice(0, 400)};
      result.failed.push({runId: d.entry.runId, network: d.network, error: message});
      ctx.log(`✗ ${label} : ${message}`);
    }
    writeState(opts.root, state);
  }
  return result;
}

export interface VerifyResult {
  network: MetaNetwork;
  ok: boolean;
  detail: string;
}

/** Contrôle les jetons (compte joint, type de compte) sans rien publier. */
export async function verifyTokens(opts: RunOptions): Promise<VerifyResult[]> {
  const ctx = makeCtx(opts);
  const out: VerifyResult[] = [];
  for (const network of META_NETWORKS) {
    const token = tokenFor(opts.env, network);
    if (!token) {
      out.push({network, ok: false, detail: `jeton ${TOKEN_ENV[network]} absent (secret GitHub à ajouter)`});
      continue;
    }
    try {
      const a = network === 'instagram' ? await instagramAccount(ctx, token) : await threadsAccount(ctx, token);
      out.push({network, ok: true, detail: `@${a.username || '?'}${a.detail ? ` (${a.detail})` : ''}`});
    } catch (e) {
      out.push({network, ok: false, detail: redact((e as Error).message, [token])});
    }
  }
  return out;
}

export interface MediaCheck {
  runId: string;
  /** Vrai si la vidéo attend encore sa publication ; faux : simple essai sur la plus récente de la file. */
  pending: boolean;
  probes: MediaProbe[];
}

/** Interroge les adresses de la prochaine vidéo à publier (à défaut, de la plus récente de la file) sans rien publier. */
export async function verifyMedia(opts: RunOptions): Promise<MediaCheck | null> {
  const fetchFn = opts.fetchFn ?? fetch;
  const nowMs = (opts.nowFn ?? (() => Date.now()))();
  const state = readState(opts.root);
  const bySlot = (a: QueueEntry, b: QueueEntry) => (slotMs(a) ?? 0) - (slotMs(b) ?? 0);
  const entries = readQueue(opts.root).filter((e) => e.media?.publicUrl);
  const pending = entries
    .filter((e) => {
      const s = slotMs(e);
      return s !== null && nowMs <= s + WINDOW_HOURS * 3_600_000 && !META_NETWORKS.every((n) => state.posts[e.runId]?.[n]?.status === 'published');
    })
    .sort(bySlot);
  const target = pending[0] ?? [...entries].sort(bySlot).reverse()[0];
  if (!target) return null;
  const {probes} = await rankMediaUrls(fetchFn, mediaUrls(target, opts.env));
  return {runId: target.runId, pending: pending.length > 0, probes};
}

// ---------------------------------------------------------------------------------------------------------------
// Ligne de commande
// ---------------------------------------------------------------------------------------------------------------

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

function summary(markdown: string): void {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) fs.appendFileSync(file, markdown + '\n');
}

export async function metaCli(args: string[], root = process.cwd(), env: Env = process.env): Promise<number> {
  const [command, ...rest] = args;
  if (command === 'verifier') {
    const res = await verifyTokens({root, env});
    let code = 0;
    for (const r of res) {
      console.log(`${r.ok ? '✓' : '✗'} ${r.network} : ${r.detail}`);
      if (!r.ok && !r.detail.includes('absent')) code = 1;
    }
    const media = await verifyMedia({root, env});
    const mediaLines: string[] = [];
    if (!media) {
      mediaLines.push('Aucune vidéo dans la file : adresses de téléchargement non testées.');
    } else {
      mediaLines.push(`Adresses de la vidéo ${media.runId}${media.pending ? '' : ' (déjà passée : simple essai)'} :`);
      for (const p of media.probes) mediaLines.push(`${p.rank === 2 ? '✗' : '✓'} ${describeProbe(p)}`);
      if (media.probes.every((p) => p.rank === 2)) mediaLines.push('⚠ aucune adresse utilisable : la vidéo est-elle toujours dans le dépôt (videos/) ?');
      else if (media.probes.every((p) => p.rank !== 0)) mediaLines.push('⚠ aucune adresse ne sert un type vidéo : Meta peut refuser la vidéo.');
    }
    for (const l of mediaLines) console.log(l);
    summary(['### Jetons Meta', ...res.map((r) => `- ${r.ok ? '✅' : '❌'} **${r.network}** : ${r.detail}`), '', '### Adresses de la vidéo', ...mediaLines.map((l) => `- ${l}`)].join('\n'));
    return code;
  }
  if (command === 'publier') {
    const now = flag(rest, 'maintenant');
    const nowMs = now ? Date.parse(now) : NaN;
    if (now && !Number.isFinite(nowMs)) throw new Error(`Date invalide : ${now}`);
    const wait = Number(flag(rest, 'attendre') ?? 0) || 0;
    const res = await runDue({root, env, dryRun: rest.includes('--simuler'), waitMinutes: wait, ...(now ? {nowFn: () => nowMs} : {})});
    if (!res.published.length && !res.failed.length && !res.planned.length) console.log('Rien à publier pour le moment.');
    for (const i of res.ignored) console.log(`· ${i.runId} → ${i.network} : ${i.reason}`);
    summary(
      [
        '### Publication Instagram et Threads',
        ...res.published.map((p) => `- ✅ ${p.runId} → **${p.network}** ${p.permalink ?? p.id}`),
        ...res.failed.map((f) => `- ❌ ${f.runId} → **${f.network}** : ${f.error}`),
        ...res.planned.map((p) => `- 🔎 simulation : ${p.runId} → ${p.network}`),
        ...(res.published.length || res.failed.length || res.planned.length ? [] : ['- Rien à publier pour le moment.']),
      ].join('\n'),
    );
    return res.failed.length ? 1 : 0;
  }
  console.log('Usage : meta.ts verifier | publier [--simuler] [--maintenant <iso>] [--attendre <minutes>]');
  return command ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  metaCli(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(`✗ ${(e as Error).message}`);
      process.exit(1);
    },
  );
}

import fsp from 'node:fs/promises';
import path from 'node:path';
import {PATHS, runPaths} from '../core/paths.js';
import {exists, readJson, readValidated, sha256File, writeJson} from '../core/fsx.js';
import {affiliateLinkProblems} from '../core/config.js';
import {http} from '../core/http.js';
import {run, runOrThrow} from '../core/exec.js';
import {log} from '../core/log.js';
import {formatLocal, formatWithOffset, isoDateInZone, addDays, zonedInstant} from '../core/time.js';
import {loadPublications} from '../core/stores.js';
import {ScriptSchema, type Script} from '../schemas/script.js';
import type {StudioConfig} from '../schemas/config.js';
import type {ScoreReport} from '../qc/score.js';
import type {Publication} from '../schemas/records.js';

export interface LinkHop {
  url: string;
  status: number;
  location: string | null;
  setsCookie: boolean;
}

export interface LinkCheck {
  url: string;
  checkedAt: string;
  ok: boolean;
  problems: string[];
  hops: LinkHop[];
  finalUrl: string | null;
}

/**
 * Follow the affiliate link hop by hop: it must land on systeme.io (HTTP 200) and the
 * affiliate id ("sa") must survive the redirects, either in the URL or in a cookie.
 */
export async function checkAffiliateLink(url: string): Promise<LinkCheck> {
  const problems = affiliateLinkProblems(url);
  const result: LinkCheck = {url, checkedAt: new Date().toISOString(), ok: false, problems, hops: [], finalUrl: null};
  if (problems.length) return result;
  const sa = new URL(url).searchParams.get('sa')!;
  let current = url;
  let saSeenInCookie = false;
  try {
    for (let i = 0; i < 8; i++) {
      const res = await http(current, {redirect: 'manual', headers: {'user-agent': 'Mozilla/5.0 (compatible; verification-lien/1.0)', accept: 'text/html'}, timeoutMs: 30_000, retries: 1});
      const location = res.headers.get('location');
      const cookies = res.headers.getSetCookie?.() ?? [];
      if (cookies.some((c) => c.includes(sa))) saSeenInCookie = true;
      result.hops.push({url: current, status: res.status, location, setsCookie: cookies.length > 0});
      await res.body?.cancel();
      if (res.status >= 300 && res.status < 400 && location) {
        current = new URL(location, current).href;
        continue;
      }
      break;
    }
  } catch (err) {
    result.problems.push(`lien injoignable : ${(err as Error).message}`);
    return result;
  }
  const last = result.hops[result.hops.length - 1];
  result.finalUrl = last?.url ?? null;
  if (!last || last.status !== 200) result.problems.push(`la page finale ne répond pas correctement (HTTP ${last?.status ?? '?'})`);
  if (last) {
    const host = new URL(last.url).hostname;
    if (!(host === 'systeme.io' || host.endsWith('.systeme.io'))) result.problems.push(`redirection hors de systeme.io : ${host}`);
    const keptInUrl = new URL(last.url).searchParams.get('sa') === sa;
    if (!keptInUrl && !saSeenInCookie) result.problems.push('l’identifiant d’affiliation « sa » disparaît pendant les redirections');
  }
  result.ok = result.problems.length === 0;
  return result;
}

export interface Slot {
  network: 'tiktok' | 'instagram';
  iso: string;
  local: string;
  label: string;
}

/** Next publication slots per network, at least `leadTimeMinutes` from now (Paris time by default). */
export function nextSlots(config: StudioConfig, now = new Date(), days = 3): Slot[] {
  const tz = config.metricool.timezone;
  const out: Slot[] = [];
  const today = isoDateInZone(now, tz);
  const fmt = new Intl.DateTimeFormat('fr-FR', {timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit'});
  for (const network of ['tiktok', 'instagram'] as const) {
    const pf = config.platforms[network];
    if (!pf.enabled) continue;
    for (let d = 0; d < days; d++) {
      for (const t of pf.postTimes) {
        const instant = zonedInstant(addDays(today, d), t, tz);
        if (instant.getTime() - now.getTime() < config.publish.leadTimeMinutes * 60_000) continue;
        out.push({network, iso: formatWithOffset(instant, tz), local: formatLocal(instant, tz), label: fmt.format(instant)});
      }
    }
  }
  return out;
}

/**
 * Slots still free for a run: only the networks connected to Metricool (when known), and never a slot that
 * already holds another video (scheduled or published), so two videos never go out at the same time.
 */
export function freeSlots(slots: Slot[], publications: Publication[], runId: string, networks?: Array<'tiktok' | 'instagram'>): Slot[] {
  const taken = new Set(
    publications
      .filter((x) => x.runId !== runId && (x.status === 'scheduled' || x.status === 'published'))
      .map((x) => `${x.network}@${Date.parse(x.scheduledFor)}`),
  );
  return slots.filter((s) => (!networks || networks.includes(s.network)) && !taken.has(`${s.network}@${Date.parse(s.iso)}`));
}

/** Caption with the legal disclosure first (visible before "more"), the CTA and the hashtags. */
export function postText(script: Script, network: 'tiktok' | 'instagram', config: StudioConfig): string {
  const body = network === 'tiktok' ? script.captions.tiktok : script.captions.instagram;
  const lines = [config.affiliate.disclosureCaption, '', body.trim()];
  if (!/\bbio\b/i.test(body)) lines.push('', `Lien en bio pour découvrir ${config.brand.name}.`);
  lines.push('', script.captions.hashtags.join(' '));
  return lines.join('\n').slice(0, 2150);
}

/** The `info` object of Metricool's createScheduledPost, built exactly as its tool schema describes. */
export function metricoolInfo(network: 'tiktok' | 'instagram', input: {text: string; mediaUrl: string; slot: Slot; coverMs: number; config: StudioConfig}): Record<string, unknown> {
  const {config} = input;
  const delivery = config.publish.delivery;
  const info: Record<string, unknown> = {
    autoPublish: delivery === 'auto',
    draft: delivery === 'draft',
    descendants: [],
    firstCommentText: '',
    hasNotReadNotes: false,
    media: [input.mediaUrl],
    mediaAltText: [],
    providers: [{network}],
    publicationDate: {dateTime: input.slot.local, timezone: config.metricool.timezone},
    shortener: false,
    smartLinkData: {ids: []},
    text: input.text,
    videoCoverMilliseconds: input.coverMs,
  };
  if (network === 'tiktok') {
    info.tiktokData = {
      disableComment: false,
      disableDuet: false,
      disableStitch: false,
      privacyOption: config.platforms.tiktok.privacy,
      commercialContentThirdParty: config.platforms.tiktok.commercialContentThirdParty,
      commercialContentOwnBrand: false,
      title: '',
      autoAddMusic: false,
      photoCoverIndex: 0,
      isAigc: config.platforms.tiktok.aiLabel,
    };
  } else {
    info.instagramData = {type: 'REEL', showReelOnFeed: config.platforms.instagram.showReelOnFeed, isAiGenerated: config.platforms.instagram.aiLabel};
  }
  return info;
}

export async function currentBranch(): Promise<string> {
  const r = await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {cwd: PATHS.root});
  const b = r.stdout.trim();
  if (r.code !== 0 || !b || b === 'HEAD') throw new Error('Branche git courante introuvable.');
  return b;
}

/** Public base URL where Metricool will download the files (raw GitHub of a public repository). */
export async function mediaBaseUrl(config: StudioConfig): Promise<{branch: string; base: string}> {
  const branch = config.media.mode === 'media-branch' ? config.media.branch : await currentBranch();
  return {branch, base: `https://raw.githubusercontent.com/${config.media.repo}/${branch.split('/').map(encodeURIComponent).join('/')}`};
}

export interface PublishPackage {
  runId: string;
  createdAt: string;
  publishable: boolean;
  overrideAllowed: boolean;
  score: {total: number; decision: string; summary: string};
  media: {fileName: string; sha256: string; publicUrl: string; coverUrl: string; coverMs: number};
  linkCheck: LinkCheck;
  duplicateOf: string | null;
  posts: Array<{network: 'tiktok' | 'instagram'; text: string; blogId: string; date: string; info: Record<string, unknown>}>;
  slots: Slot[];
}

/**
 * `networks`: the networks actually connected to the Metricool brand (getBrandSettings); a network
 * enabled in the settings but not connected gets no post, so nothing is ever scheduled blindly.
 */
export async function preparePublication(
  runId: string,
  config: StudioConfig,
  opts: {skipLinkCheck?: boolean; networks?: Array<'tiktok' | 'instagram'>} = {},
): Promise<PublishPackage> {
  const p = runPaths(runId);
  const score = await readJson<ScoreReport>(p.score);
  const script = await readValidated(p.script, ScriptSchema);
  const digest = await sha256File(p.final);
  const publications = await loadPublications();
  const dup = publications.find((x) => x.contentSha256 === digest && x.runId !== runId && x.status !== 'cancelled');
  const linkCheck = opts.skipLinkCheck
    ? {url: config.affiliate.url, checkedAt: new Date().toISOString(), ok: affiliateLinkProblems(config.affiliate.url).length === 0, problems: [...affiliateLinkProblems(config.affiliate.url), 'vérification en ligne non effectuée'], hops: [], finalUrl: null}
    : await checkAffiliateLink(config.affiliate.url);
  const fileName = `${runId}.mp4`;
  const {base} = await mediaBaseUrl(config);
  const media = {
    fileName,
    sha256: digest,
    publicUrl: `${base}/videos/${fileName}`,
    coverUrl: `${base}/videos/${runId}.jpg`,
    coverMs: 1200,
  };
  const connected = (n: 'tiktok' | 'instagram') => !opts.networks || opts.networks.includes(n);
  const slots = freeSlots(nextSlots(config), publications, runId, opts.networks);
  const posts: PublishPackage['posts'] = [];
  for (const network of ['tiktok', 'instagram'] as const) {
    if (!config.platforms[network].enabled) continue;
    if (!connected(network)) {
      log.warn(`${network === 'tiktok' ? 'TikTok' : 'Instagram'} activé mais non connecté à Metricool : aucune publication préparée pour ce réseau.`);
      continue;
    }
    const slot = slots.find((s) => s.network === network);
    if (!slot) continue;
    const text = postText(script, network, config);
    posts.push({network, text, blogId: config.metricool.brandId, date: slot.iso, info: metricoolInfo(network, {text, mediaUrl: media.publicUrl, slot, coverMs: media.coverMs, config})});
  }
  const gatesOk = score.gates.every((g) => g.ok);
  const pkg: PublishPackage = {
    runId,
    createdAt: new Date().toISOString(),
    publishable: score.decision === 'publishable' && linkCheck.ok && !dup,
    overrideAllowed: gatesOk && linkCheck.ok && !dup && score.total >= config.publish.improveFrom,
    score: {total: score.total, decision: score.decision, summary: score.summary},
    media,
    linkCheck,
    duplicateOf: dup?.runId ?? null,
    posts,
    slots,
  };
  await fsp.mkdir(p.publishDir, {recursive: true});
  await writeJson(path.join(p.publishDir, 'package.json'), pkg);
  if (!linkCheck.ok) log.warn(`Lien affilié : ${linkCheck.problems.join(' ; ')}`);
  if (dup) log.warn(`Contenu identique déjà publié : ${dup.runId}`);
  log[pkg.publishable ? 'ok' : 'warn'](`Paquet de publication prêt (${pkg.publishable ? 'publiable' : 'non publiable en l’état'})`);
  return pkg;
}

/**
 * Host the MP4 + cover where Metricool can download them (public repository, raw URL).
 * Default: a normal commit on the current session branch. Optional (explicit user permission):
 * an orphan `media` branch rebuilt with only the last N days, so the repository stays small.
 */
export async function pushMedia(runId: string, config: StudioConfig): Promise<{publicUrl: string; verified: boolean | null}> {
  const p = runPaths(runId);
  const {branch, base} = await mediaBaseUrl(config);
  let commit: string;
  if (config.media.mode === 'session-branch') {
    const dir = path.join(PATHS.root, 'videos');
    await fsp.mkdir(dir, {recursive: true});
    await fsp.copyFile(p.final, path.join(dir, `${runId}.mp4`));
    if (exists(p.cover)) await fsp.copyFile(p.cover, path.join(dir, `${runId}.jpg`));
    await runOrThrow('git', ['add', '--', `videos/${runId}.mp4`, ...(exists(p.cover) ? [`videos/${runId}.jpg`] : [])], {cwd: PATHS.root});
    await runOrThrow('git', ['commit', '-m', `Vidéo ${runId} pour publication via Metricool`, '--', `videos/${runId}.mp4`, ...(exists(p.cover) ? [`videos/${runId}.jpg`] : [])], {cwd: PATHS.root});
    commit = (await runOrThrow('git', ['rev-parse', 'HEAD'], {cwd: PATHS.root})).stdout.trim();
    await pushWithRetry(['push', '-u', 'origin', `HEAD:refs/heads/${branch}`]);
  } else {
    commit = await orphanMediaCommit(runId, config);
    await pushWithRetry(['push', '--force', 'origin', `${commit}:refs/heads/${branch}`]);
  }
  const publicUrl = `${base}/videos/${runId}.mp4`;
  let verified: boolean | null = null;
  try {
    for (let i = 0; i < 6 && !verified; i++) {
      const res = await http(publicUrl, {method: 'HEAD', timeoutMs: 20_000, retries: 0});
      verified = res.ok;
      if (!verified) await new Promise((r) => setTimeout(r, 10_000));
    }
  } catch {
    verified = null;
    log.warn('Adresse publique non vérifiable depuis cet environnement (hôte raw.githubusercontent.com non autorisé ?).');
  }
  await writeJson(path.join(p.publishDir, 'media.json'), {publicUrl, coverUrl: `${base}/videos/${runId}.jpg`, branch, verified, pushedAt: new Date().toISOString(), commit});
  log.ok(`Vidéo en ligne (branche « ${branch} ») : ${publicUrl}${verified ? ' — accessible' : ''}`);
  return {publicUrl, verified};
}

async function pushWithRetry(args: string[]): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await run('git', args, {cwd: PATHS.root});
    if (r.code === 0) return;
    if (attempt === 3) throw new Error(`Envoi git impossible : ${r.stderr.trim().split('\n').slice(-3).join(' ')}`);
    await new Promise((res) => setTimeout(res, 2000 * 2 ** attempt));
  }
}

async function orphanMediaCommit(runId: string, config: StudioConfig): Promise<string> {
  const p = runPaths(runId);
  const branch = config.media.branch;
  const indexFile = path.join(PATHS.cache, 'media.index');
  await fsp.mkdir(PATHS.cache, {recursive: true});
  await run('git', ['fetch', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`], {cwd: PATHS.root});
  const env = {...process.env, GIT_INDEX_FILE: indexFile};
  const gitEnv = async (args: string[]) => {
    const r = await run('git', args, {cwd: PATHS.root, env});
    if (r.code !== 0) throw new Error(`git ${args.join(' ')} : ${r.stderr.trim()}`);
    return r.stdout.trim();
  };
  await fsp.rm(indexFile, {force: true});
  await gitEnv(['read-tree', '--empty']);
  const today = runId.slice(0, 10);
  const existing = await run('git', ['ls-tree', '-r', `refs/remotes/origin/${branch}`], {cwd: PATHS.root});
  if (existing.code === 0) {
    for (const line of existing.stdout.split('\n').filter(Boolean)) {
      const [meta, file] = line.split('\t');
      const blob = meta!.split(' ')[2]!;
      const m = file!.match(/^videos\/(\d{4}-\d{2}-\d{2})/);
      if (!m) continue;
      const age = (Date.parse(today) - Date.parse(m[1]!)) / 86_400_000;
      if (age <= config.media.retentionDays && !file!.startsWith(`videos/${runId}.`)) await gitEnv(['update-index', '--add', '--cacheinfo', `100644,${blob},${file}`]);
    }
  }
  const add = async (src: string, dest: string) => {
    const blob = (await runOrThrow('git', ['hash-object', '-w', src], {cwd: PATHS.root})).stdout.trim();
    await gitEnv(['update-index', '--add', '--cacheinfo', `100644,${blob},${dest}`]);
  };
  await add(p.final, `videos/${runId}.mp4`);
  if (exists(p.cover)) await add(p.cover, `videos/${runId}.jpg`);
  const tree = await gitEnv(['write-tree']);
  const commit = (await run('git', ['commit-tree', tree, '-m', `Médias : ${runId} (rétention ${config.media.retentionDays} jours)`], {cwd: PATHS.root})).stdout.trim();
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('Création du commit média impossible.');
  return commit;
}

import fsp from 'node:fs/promises';
import path from 'node:path';
import {PATHS, runPaths} from '../core/paths.js';
import {exists, readJson, readJsonIfExists, readValidated, writeJson} from '../core/fsx.js';
import {affiliateLinkProblems, loadConfig, loadEditorial, saveConfig} from '../core/config.js';
import {log} from '../core/log.js';
import {loadCaptures, loadHistory, upsertAffiliate, upsertHistory, upsertPublication} from '../core/stores.js';
import {ScriptSchema} from '../schemas/script.js';
import {ReviewSchema, type HistoryRecord, type VoiceReport, type VoiceWord} from '../schemas/records.js';
import {FactsDbSchema} from '../schemas/facts.js';
import type {StudioConfig} from '../schemas/config.js';
import type {Timeline} from '../schemas/timeline.js';
import type {ScoreReport} from '../qc/score.js';
import type {TechnicalReport} from '../qc/technical.js';
import type {PublishPackage} from '../publish/publish.js';
import type {LicenseRecord} from '../footage/footage-step.js';
import type {MusicChoice} from '../music/music-step.js';
import type {Plan} from '../editorial/plan.js';
import {artDirection} from '../edit/art-directions.js';
import {loadFacts} from '../facts/facts.js';

/** Status words shown in the panel (French, plain). */
export type PanelStatus = 'a_valider' | 'a_ameliorer' | 'bloquee' | 'programmee' | 'publiee' | 'refusee' | 'correction' | 'echec';

export function panelStatus(score: ScoreReport | null, pkg: PublishPackage | null): PanelStatus {
  if (!score) return 'echec';
  if (score.decision === 'publishable' && pkg?.publishable) return 'a_valider';
  if (score.decision === 'improve' && pkg?.overrideAllowed) return 'a_ameliorer';
  return 'bloquee';
}

/**
 * Everything the validation panel shows for one video, as one JSON document
 * (written to the panel's database by the daily agent with the ArtifactData tool).
 */
export async function exportVideoDoc(
  runId: string,
  assets: {previewAssetId?: string | null; previewUrl?: string | null; coverAssetId?: string | null; coverUrl?: string | null} = {},
): Promise<Record<string, unknown>> {
  const p = runPaths(runId);
  const config = await loadConfig();
  const editorial = await loadEditorial();
  const plan = await readJson<Plan>(p.plan);
  const script = await readValidated(p.script, ScriptSchema);
  const score = exists(p.score) ? await readJson<ScoreReport>(p.score) : null;
  const pkgFile = path.join(p.publishDir, 'package.json');
  const pkg = exists(pkgFile) ? await readJson<PublishPackage>(pkgFile) : null;
  const technical = exists(p.qcTechnical) ? await readJson<TechnicalReport>(p.qcTechnical) : null;
  const review = exists(p.review) ? await readValidated(p.review, ReviewSchema) : null;
  const voice = exists(p.voiceReport) ? await readJson<VoiceReport>(p.voiceReport) : null;
  const timeline = exists(p.timeline) ? await readJson<Timeline>(p.timeline) : null;
  const words = exists(p.voiceWords) ? await readJson<VoiceWord[]>(p.voiceWords) : [];
  const licenses = await readJsonIfExists<LicenseRecord[]>(p.footageLicenses, []);
  const music = await readJsonIfExists<MusicChoice | null>(p.musicChoice, null);
  const facts = (await loadFacts()).facts;
  const pushed = await readJsonIfExists<{publicUrl: string; verified: boolean | null} | null>(path.join(p.publishDir, 'media.json'), null);
  const usedFactIds = new Set(script.scenes.flatMap((s) => [...s.claimFactIds, ...(s.visual.graphic && 'factId' in s.visual.graphic ? [s.visual.graphic.factId] : [])]));
  const scene = (id: string) => timeline?.scenes.find((s) => s.id === id);
  const ad = artDirection(plan.artDirection);
  const doc = {
    runId,
    date: plan.date,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: panelStatus(score, pkg),
    title: script.workingTitle,
    category: {id: plan.category.id, label: editorial.categories.find((c) => c.id === plan.category.id)?.label ?? plan.category.id},
    angle: script.angle,
    hook: script.scenes[0]?.voiceover ?? '',
    hookStyle: script.hookStyle,
    artDirection: {id: ad.id, label: ad.label},
    durationSec: timeline?.metrics.durationSec ?? technical?.durationSec ?? null,
    score: score
      ? {total: score.total, decision: score.decision, summary: score.summary, criteria: score.criteria, gates: score.gates, virality: score.virality ?? null}
      : null,
    review: review
      ? {
          reviewer: review.reviewer,
          criteria: Object.fromEntries(Object.entries(review.criteria).map(([k, v]) => [k, {score: v.score, justification: v.justification}])),
          improvements: review.improvements,
        }
      : null,
    technical: technical?.checks.map((c) => ({label: c.label, ok: c.ok, value: c.value, expected: c.expected})) ?? [],
    voice: voice ? {id: voice.voiceId, name: voice.voiceName, wpm: voice.wpm, wer: voice.wer, score: voice.score, problems: voice.problems} : null,
    musicTrackId: music?.trackId ?? null,
    script: script.scenes.map((s) => {
      const sp = scene(s.id);
      const sw = words.filter((w) => w.sceneId === s.id);
      return {
        id: s.id,
        phase: s.phase,
        voiceover: s.voiceover,
        headline: s.headline ?? null,
        visual: s.visual.kind,
        fromSec: sp ? Math.round((sp.from / 30) * 10) / 10 : sw[0]?.start ?? null,
        toSec: sp ? Math.round((sp.to / 30) * 10) / 10 : sw[sw.length - 1]?.end ?? null,
      };
    }),
    facts: facts.filter((f) => usedFactIds.has(f.id)).map((f) => ({id: f.id, statement: f.statement, verifiedAt: f.verifiedAt})),
    credits: {
      footage: licenses.map((l) => ({pexelsId: l.pexelsId, author: l.author, pageUrl: l.pageUrl, source: l.source ?? 'Pexels'})),
      music: music?.trackId ? {title: music.title, source: music.source, license: music.license} : null,
    },
    posts: pkg?.posts ?? [],
    slots: pkg?.slots ?? [],
    media: pkg
      ? {
          publicUrl: pkg.media.publicUrl,
          coverUrl: pkg.media.coverUrl,
          coverMs: pkg.media.coverMs,
          sha256: pkg.media.sha256,
          pushed: Boolean(pushed),
          verified: pushed?.verified ?? null,
        }
      : null,
    linkCheck: pkg ? {ok: pkg.linkCheck.ok, problems: pkg.linkCheck.problems, checkedAt: pkg.linkCheck.checkedAt} : null,
    publishable: pkg?.publishable ?? false,
    overrideAllowed: pkg?.overrideAllowed ?? false,
    preview: {assetId: assets.previewAssetId ?? null, url: assets.previewUrl ?? null},
    cover: {assetId: assets.coverAssetId ?? null, url: assets.coverUrl ?? null},
    decision: null,
    publications: {},
    metrics: null,
    disclosure: config.affiliate.disclosureCaption,
  };
  const out = path.join(p.dir, 'panel', 'video.json');
  await writeJson(out, doc);
  log.ok(`Fiche du panneau prête : ${path.relative(PATHS.root, out)} (statut « ${doc.status} »)`);
  return doc;
}

/** Settings document mirrored in the panel ("Réglages" tab). */
export async function exportSettingsDoc(config: StudioConfig, extra: {triggerId?: string | null} = {}): Promise<Record<string, unknown>> {
  const editorial = await loadEditorial();
  const inbox = await readJsonIfExists<{categoryPrefs?: Record<string, string>}>(path.join(PATHS.panelInbox, 'inbox.json'), {});
  const setup = await readJsonIfExists<Record<string, unknown> | null>(path.join(PATHS.panelInbox, 'setup.json'), null);
  const facts = (await loadFacts()).facts;
  const doc = {
    affiliateUrl: config.affiliate.url,
    bioLinkCheckedOn: config.affiliate.bioLinkCheckedOn,
    approval: config.publish.approval,
    delivery: config.publish.delivery,
    platforms: {
      tiktok: {enabled: config.platforms.tiktok.enabled, postTimes: config.platforms.tiktok.postTimes},
      instagram: {enabled: config.platforms.instagram.enabled, postTimes: config.platforms.instagram.postTimes},
    },
    categoryPrefs: inbox.categoryPrefs ?? {},
    categories: editorial.categories.map((c) => ({id: c.id, label: c.label})),
    approvedVoices: config.voice.approvedVoices.map((v) => ({id: v.id, name: v.name})),
    metricoolBrandId: config.metricool.brandId,
    timezone: config.metricool.timezone,
    triggerId: extra.triggerId ?? null,
    setup: {
      ...(setup ?? {azure: 'missing', pexels: 'missing', footage: 'missing', checkedAt: null}),
      footageProvider: config.footage.provider,
      voiceProvider: config.voice.provider,
      factsVerified: facts.filter((f) => f.status === 'verified').length,
      pricesVerified: facts.some((f) => f.tags.includes('plan-price') && f.status === 'verified'),
      capturesCount: (await loadCaptures()).length,
    },
    updatedAt: new Date().toISOString(),
    updatedBy: 'agent',
  };
  await writeJson(path.join(PATHS.panelInbox, 'settings-export.json'), doc);
  return doc;
}

type Raw = Record<string, unknown>;

/** Accept ArtifactData listings in any reasonable shape: plain docs, {id, data}, {path, data}… */
export function normalizeDocs(list: unknown): Array<{id: string; data: Raw}> {
  if (!Array.isArray(list)) {
    if (list && typeof list === 'object') {
      const obj = list as Raw;
      for (const key of ['documents', 'docs', 'items', 'results', 'data']) if (Array.isArray(obj[key])) return normalizeDocs(obj[key]);
    }
    return [];
  }
  return list
    .filter((x): x is Raw => Boolean(x) && typeof x === 'object')
    .map((item) => {
      const data = (item.data && typeof item.data === 'object' ? item.data : item.fields && typeof item.fields === 'object' ? item.fields : item) as Raw;
      const pathId = typeof item.path === 'string' ? item.path.split('/').pop() : undefined;
      const id = String(item.id ?? item.doc_id ?? pathId ?? data.runId ?? data.date ?? data.voiceId ?? '');
      return {id, data};
    });
}

export interface ImportSummary {
  settingsApplied: string[];
  ideas: number;
  corrections: Array<{runId: string; notes: string}>;
  rejected: Array<{runId: string; reason: string}>;
  scheduled: Array<{runId: string; network: string; scheduledFor: string}>;
  affiliateDays: number;
  approvedVoices: string[];
}

/**
 * Apply what the user did in the panel (settings, ideas, decisions, affiliate figures)
 * to the repository, which stays the studio's memory between runs.
 */
/** A dump is either one JSON file {settings, ideas, videos, affiliate, voices} or the directory written by ArtifactData `out_dir`. */
async function loadDump(file: string): Promise<Raw> {
  const stat = await fsp.stat(file);
  if (!stat.isDirectory()) return readJson<Raw>(file);
  const dump: Raw = {};
  for (const collection of ['settings', 'ideas', 'videos', 'affiliate', 'voices', 'runs', 'state']) {
    const dir = path.join(file, collection);
    if (!exists(dir)) continue;
    const docs: Raw[] = [];
    for (const name of (await fsp.readdir(dir)).filter((n) => n.endsWith('.json'))) {
      const raw = await readJson<Raw>(path.join(dir, name));
      const id = name.replace(/\.json$/, '');
      docs.push(raw && typeof raw === 'object' && 'data' in raw && raw.data && typeof raw.data === 'object' ? {...raw, id: raw.id ?? id} : {id, data: raw});
    }
    dump[collection] = docs;
  }
  return dump;
}

export async function importPanelDump(file: string): Promise<ImportSummary> {
  const dump = await loadDump(file);
  const config = await loadConfig();
  const summary: ImportSummary = {settingsApplied: [], ideas: 0, corrections: [], rejected: [], scheduled: [], affiliateDays: 0, approvedVoices: []};
  const inboxFile = path.join(PATHS.panelInbox, 'inbox.json');
  const inbox = await readJsonIfExists<Raw>(inboxFile, {});

  const settingsDocs = normalizeDocs(dump.settings);
  const s = (settingsDocs.find((d) => d.id === 'studio') ?? settingsDocs[0])?.data;
  if (s) {
    if (typeof s.affiliateUrl === 'string' && s.affiliateUrl !== config.affiliate.url) {
      const problems = affiliateLinkProblems(s.affiliateUrl);
      if (problems.length === 0 || s.affiliateUrl === '') {
        config.affiliate.url = s.affiliateUrl.trim();
        summary.settingsApplied.push('lien affilié');
      } else log.warn(`Lien affilié du panneau refusé : ${problems.join(' ; ')}`);
    }
    if (typeof s.bioLinkCheckedOn === 'string' || s.bioLinkCheckedOn === null) {
      if (s.bioLinkCheckedOn !== config.affiliate.bioLinkCheckedOn) {
        config.affiliate.bioLinkCheckedOn = (s.bioLinkCheckedOn as string | null) ?? null;
        summary.settingsApplied.push('date de vérification du lien en bio');
      }
    }
    if (s.approval === 'panel' || s.approval === 'auto') {
      if (s.approval !== config.publish.approval) summary.settingsApplied.push(`validation : ${s.approval}`);
      config.publish.approval = s.approval;
    }
    if (s.delivery === 'auto' || s.delivery === 'notification' || s.delivery === 'draft') {
      if (s.delivery !== config.publish.delivery) summary.settingsApplied.push(`mode Metricool : ${s.delivery}`);
      config.publish.delivery = s.delivery;
    }
    const pf = s.platforms as Raw | undefined;
    for (const network of ['tiktok', 'instagram'] as const) {
      const n = pf?.[network] as Raw | undefined;
      if (!n) continue;
      if (typeof n.enabled === 'boolean' && n.enabled !== config.platforms[network].enabled) {
        config.platforms[network].enabled = n.enabled;
        summary.settingsApplied.push(`${network} ${n.enabled ? 'activé' : 'désactivé'}`);
      }
      if (Array.isArray(n.postTimes)) {
        const times = n.postTimes.filter((t): t is string => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t));
        if (times.length && times.join() !== config.platforms[network].postTimes.join()) {
          config.platforms[network].postTimes = times;
          summary.settingsApplied.push(`horaires ${network}`);
        }
      }
    }
    if (s.categoryPrefs && typeof s.categoryPrefs === 'object') inbox.categoryPrefs = s.categoryPrefs;
  }

  const voices = normalizeDocs(dump.voices);
  for (const v of voices) {
    if (v.data.status !== 'approved') continue;
    const id = String(v.data.voiceId ?? v.id);
    if (!config.voice.approvedVoices.some((a) => a.id === id)) {
      config.voice.approvedVoices.push({
        id,
        name: String(v.data.name ?? id),
        approvedOn: new Date().toISOString().slice(0, 10),
        approvedBy: 'panneau',
        settings: {},
        ...(typeof v.data.model === 'string' ? {modelId: v.data.model} : {}),
      });
      summary.approvedVoices.push(String(v.data.name ?? id));
    }
  }
  const rejectedVoices = new Set(voices.filter((v) => v.data.status === 'rejected').map((v) => String(v.data.voiceId ?? v.id)));
  config.voice.approvedVoices = config.voice.approvedVoices.filter((a) => !rejectedVoices.has(a.id));

  const ideas = normalizeDocs(dump.ideas).map((d) => ({id: d.id, text: String(d.data.text ?? ''), category: (d.data.category as string) ?? null, priority: Boolean(d.data.priority), status: String(d.data.status ?? 'new')}));
  inbox.ideas = ideas;
  summary.ideas = ideas.filter((i) => i.status === 'new').length;

  const history = await loadHistory();
  const rejected = (inbox.rejected as Array<{runId: string; reason: string}>) ?? [];
  for (const v of normalizeDocs(dump.videos)) {
    const runId = String(v.data.runId ?? v.id);
    const decision = v.data.decision as Raw | null | undefined;
    if (decision?.action === 'refuser') {
      const reason = String(decision.notes ?? 'sans motif');
      if (!rejected.some((r) => r.runId === runId)) rejected.push({runId, reason});
      summary.rejected.push({runId, reason});
      if (history.some((h) => h.runId === runId)) await upsertHistory({runId, status: 'rejected', reason: `refusée dans le panneau : ${reason}`});
    }
    if (decision?.action === 'corriger' && v.data.status === 'correction') summary.corrections.push({runId, notes: String(decision.notes ?? '')});
    const pubs = (v.data.publications ?? {}) as Record<string, Raw>;
    for (const network of ['tiktok', 'instagram'] as const) {
      const pub = pubs[network];
      if (!pub || typeof pub.scheduledFor !== 'string') continue;
      const status = (['draft', 'scheduled', 'published', 'failed', 'cancelled'] as const).find((x) => x === pub.status) ?? 'scheduled';
      await upsertPublication({
        runId,
        network,
        contentSha256: String(pub.contentSha256 ?? v.data.sha256 ?? ''),
        mediaUrl: String((v.data.media as Raw | undefined)?.publicUrl ?? ''),
        scheduledFor: pub.scheduledFor,
        delivery: (['auto', 'notification', 'draft'] as const).find((x) => x === pub.delivery) ?? config.publish.delivery,
        approvedBy: 'panel',
        status,
        metricoolPostId: pub.postId ? String(pub.postId) : null,
        metricoolUuid: pub.uuid ? String(pub.uuid) : null,
        plannerUrl: pub.plannerUrl ? String(pub.plannerUrl) : null,
        permalink: pub.permalink ? String(pub.permalink) : null,
        captionStart: String(pub.text ?? '').slice(0, 80),
        confirmedAt: pub.confirmedAt ? String(pub.confirmedAt) : null,
        note: pub.note ? String(pub.note) : null,
        recordedAt: new Date().toISOString(),
      });
      summary.scheduled.push({runId, network, scheduledFor: pub.scheduledFor});
      if (history.some((h) => h.runId === runId)) await upsertHistory({runId, status: status === 'published' ? 'published' : 'scheduled'});
    }
  }
  inbox.rejected = rejected.slice(-30);

  for (const d of normalizeDocs(dump.affiliate)) {
    const date = String(d.data.date ?? d.id);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : x === null || x === undefined || x === '' ? null : Number(x));
    await upsertAffiliate({
      date,
      clicks: num(d.data.clicks),
      signups: num(d.data.signups),
      paidSubscriptions: num(d.data.paidSubscriptions),
      commission: num(d.data.commission),
      currency: String(d.data.currency ?? 'EUR'),
      source: 'panneau (saisie depuis le tableau de bord affilié Systeme.io)',
      recordedAt: new Date().toISOString(),
    });
    summary.affiliateDays++;
  }

  await rebuildMemory(normalizeDocs(dump.videos));
  const stateDocs = normalizeDocs(dump.state);
  const factsDoc = stateDocs.find((d) => d.id === 'facts')?.data;
  if (factsDoc && typeof factsDoc.content === 'object' && factsDoc.content) {
    const parsed = FactsDbSchema.safeParse(factsDoc.content);
    if (!parsed.success) log.warn('Faits du panneau illisibles : la copie du dépôt est conservée.');
    else {
      // Only a newer verification replaces the repository's facts (an old panel copy must never undo a recent check).
      const local = exists(PATHS.factsDb) ? await loadFacts() : null;
      const panelAt = Date.parse(parsed.data.updatedAt ?? '') || 0;
      const localAt = Date.parse(local?.updatedAt ?? '') || 0;
      if (!local || panelAt > localAt) {
        await writeJson(PATHS.factsDb, parsed.data);
        summary.settingsApplied.push('faits vérifiés (base du panneau, plus récents)');
      } else log.info('Faits du dépôt plus récents que ceux du panneau : conservés.');
    }
  }

  await saveConfig(config);
  await fsp.mkdir(PATHS.panelInbox, {recursive: true});
  await writeJson(inboxFile, inbox);
  return summary;
}

const STATUS_TO_HISTORY: Record<string, HistoryRecord['status']> = {
  a_valider: 'rendered',
  a_ameliorer: 'rendered',
  bloquee: 'rejected',
  correction: 'rejected',
  refusee: 'rejected',
  programmee: 'scheduled',
  publiee: 'published',
  echec: 'failed',
};

/**
 * The panel's `videos` collection is the studio's long-term memory: scheduled sessions start
 * from a fresh clone, so history, publications, footage reuse and metrics are rebuilt from it.
 */
export async function rebuildMemory(videos: Array<{id: string; data: Raw}>): Promise<void> {
  const usage = await readJsonIfExists<Record<string, string>>(PATHS.footageUsage, {});
  const metrics = await readJsonIfExists<Record<string, unknown>>(PATHS.metrics, {});
  for (const {id, data: v} of videos) {
    const runId = String(v.runId ?? id);
    if (!/^\d{4}-\d{2}-\d{2}-[a-z]$/.test(runId)) continue;
    const score = v.score as Raw | null | undefined;
    const decision = v.decision as Raw | null | undefined;
    const credits = (v.credits ?? {}) as Raw;
    const footage = Array.isArray(credits.footage) ? (credits.footage as Raw[]) : [];
    const pexelsIds = footage.map((f) => Number(f.pexelsId)).filter((n) => Number.isFinite(n));
    await upsertHistory({
      runId,
      date: String(v.date ?? runId.slice(0, 10)),
      category: String((v.category as Raw | undefined)?.id ?? 'inconnue'),
      hookStyle: (v.hookStyle as string) ?? null,
      hook: (v.hook as string) ?? null,
      angle: (v.angle as string) ?? null,
      workingTitle: (v.title as string) ?? null,
      artDirection: String((v.artDirection as Raw | undefined)?.id ?? '') || null,
      musicTrack: (v.musicTrackId as string) ?? null,
      voiceId: String((v.voice as Raw | undefined)?.id ?? '') || null,
      durationSec: typeof v.durationSec === 'number' ? v.durationSec : null,
      score: typeof score?.total === 'number' ? (score.total as number) : null,
      decision: (['publishable', 'improve', 'redo'] as const).find((d) => d === score?.decision) ?? null,
      status: STATUS_TO_HISTORY[String(v.status)] ?? 'created',
      reason: decision?.notes ? String(decision.notes) : null,
      pexelsIds,
    });
    for (const pid of pexelsIds) if (!usage[String(pid)] || usage[String(pid)]! < String(v.date ?? '')) usage[String(pid)] = String(v.date ?? runId.slice(0, 10));
    const m = v.metrics as Raw | null | undefined;
    if (m && typeof m === 'object') {
      for (const network of ['tiktok', 'instagram']) {
        const nm = m[network] as Raw | undefined;
        if (nm) metrics[`${runId}:${network}`] = {runId, network, permalink: ((v.publications as Raw | undefined)?.[network] as Raw | undefined)?.permalink ?? null, metrics: nm, collectedAt: m.updatedAt ?? null};
      }
    }
  }
  await writeJson(PATHS.footageUsage, usage);
  await writeJson(PATHS.metrics, metrics);
}

/** Facts database wrapped as one panel document (`state/facts`), so evidence found once is kept. */
export async function exportFactsState(): Promise<string> {
  const db = await readJson<Raw>(PATHS.factsDb);
  const out = path.join(PATHS.cache, 'state-facts.json');
  await writeJson(out, {content: db, updatedAt: new Date().toISOString()});
  return out;
}

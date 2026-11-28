import fs from 'node:fs';
import path from 'node:path';
import type {Db} from '../core/db.js';
import type {AppConfig} from '../core/config.js';
import {listAccounts} from '../core/accounts.js';
import {loadFacts, usableFacts} from '../core/facts.js';
import {PATHS} from '../core/paths.js';
import {isoInZone, parseJson} from '../core/util.js';
import {queryPosts, type PostFilter} from '../intel/store.js';
import {crossCompetitorPatterns, insightsText, loadPatterns, patternLabel} from '../intel/patterns.js';
import {loadTrends} from '../intel/trends.js';
import {HOOK_LABELS} from '../intel/features.js';
import {learningTable} from '../analytics/learn.js';
import {AiRouter} from '../ai/router.js';
import {TEMPLATES} from '../render/templates.js';
import {loadLibrary} from '../generate/library.js';
import {STRUCTURES, STRUCTURE_LABELS, TONES} from '../generate/types.js';
import {calendar} from '../publish/scheduler.js';

/** JSON for each dashboard page. Read-only: actions live in server.ts. */

const mediaUrl = (rel: string | null | undefined) => (rel ? `media/${rel.split(path.sep).join('/')}` : null);

function slideshowCard(db: Db, r: any) {
  const cover = db.get<{path: string}>('SELECT path FROM images WHERE slideshow_id = ? AND slide_index = 0', r.id);
  const qc = parseJson<any>(r.qc_json, {}).report;
  return {
    id: r.id,
    account: r.account_id,
    platform: r.platform,
    hook: r.hook,
    topic: r.topic,
    structure: r.structure,
    hookType: r.hook_type,
    template: r.template,
    format: r.format,
    status: r.status,
    engine: r.engine,
    predicted: r.predicted,
    qcScore: r.qc_score,
    qcErrors: qc?.errors?.length ?? null,
    qcWarnings: qc?.warnings?.length ?? null,
    slides: parseJson<any[]>(r.slides_json, []).length,
    cover: mediaUrl(cover?.path),
    createdAt: r.created_at,
  };
}

export function overview(db: Db, cfg: AppConfig) {
  const accounts = listAccounts(db);
  const status = Object.fromEntries(db.all('SELECT status, COUNT(*) AS n FROM slideshows GROUP BY status').map((r) => [r.status, r.n]));
  const sched = Object.fromEntries(db.all('SELECT status, COUNT(*) AS n FROM schedule GROUP BY status').map((r) => [r.status, r.n]));
  const own = db.get('SELECT COUNT(*) AS n, ROUND(AVG(score), 1) AS score, SUM(views) AS views, SUM(likes) AS likes, SUM(comments) AS comments, SUM(shares) AS shares, SUM(saves) AS saves FROM posts WHERE is_own = 1');
  const market = db.get('SELECT COUNT(*) AS n, COUNT(DISTINCT author) AS authors FROM posts WHERE is_own = 0');
  const costs = new AiRouter(db, cfg).costSummary(30);
  const best = db.all("SELECT * FROM slideshows WHERE status NOT IN ('rejected', 'qc_failed') ORDER BY COALESCE(predicted, 0) DESC LIMIT 6").map((r) => slideshowCard(db, r));
  const bestOwn = queryPosts(db, {own: true, limit: 5, sort: 'score'}).items;
  return {
    generatedAt: isoInZone(new Date()),
    kpis: {
      accounts: accounts.length,
      accountsCarousel: accounts.filter((a) => a.slideshows).length,
      generated: Object.values(status).reduce((a: number, b) => a + (b as number), 0),
      awaitingApproval: status.awaiting_approval ?? 0,
      approved: status.approved ?? 0,
      scheduled: (sched.planned ?? 0) + (sched.queued_remote ?? 0) + (sched.deferred ?? 0),
      pending: (sched.manual_required ?? 0) + (status.awaiting_approval ?? 0),
      published: sched.published ?? 0,
      failed: sched.failed ?? 0,
      qcFailed: status.qc_failed ?? 0,
      ownPosts: own?.n ?? 0,
      ownAvgScore: own?.score ?? null,
      ownViews: own?.views ?? 0,
      ownInteractions: (own?.likes ?? 0) + (own?.comments ?? 0) + (own?.shares ?? 0) + (own?.saves ?? 0),
      marketPosts: market?.n ?? 0,
      competitors: market?.authors ?? 0,
      aiCost30d: costs.byModel.reduce((a: number, r: any) => a + (r.cost_usd ?? 0), 0),
      aiCalls30d: costs.byModel.reduce((a: number, r: any) => a + (r.calls ?? 0), 0),
    },
    statusBreakdown: status,
    scheduleBreakdown: sched,
    best,
    bestOwn,
    trends: loadTrends(db, 8),
    insights: insightsText(loadPatterns(db, 'market', 'all'), 6),
    history: db.all("SELECT at, kind, ref, level, message FROM events ORDER BY id DESC LIMIT 25"),
    viewsByDay: db.all("SELECT substr(published_at, 1, 10) AS day, SUM(views) AS views, COUNT(*) AS posts FROM posts WHERE is_own = 1 AND published_at >= ? GROUP BY day ORDER BY day", new Date(Date.now() - 45 * 86_400_000).toISOString()),
    costs: costs.byDay,
  };
}

export function accountsPage(db: Db) {
  return listAccounts(db).map((a) => {
    const counts = Object.fromEntries(db.all('SELECT status, COUNT(*) AS n FROM slideshows WHERE account_id = ? GROUP BY status', a.id).map((r) => [r.status, r.n]));
    const sched = Object.fromEntries(db.all('SELECT status, COUNT(*) AS n FROM schedule WHERE account_id = ? GROUP BY status', a.id).map((r) => [r.status, r.n]));
    const stats = db.get('SELECT COUNT(*) AS posts, ROUND(AVG(views)) AS avgViews, ROUND(AVG(score), 1) AS avgScore, SUM(views) AS views FROM posts WHERE is_own = 1 AND (account_id = ? OR (platform = ? AND author = ?))', a.id, a.platform, a.handle);
    const best = queryPosts(db, {own: true, platform: a.platform, limit: 3, sort: 'score'}).items;
    const next = db.all("SELECT s.scheduled_for, x.hook FROM schedule s JOIN slideshows x ON x.id = s.slideshow_id WHERE s.account_id = ? AND s.status IN ('planned', 'queued_remote', 'deferred') ORDER BY s.scheduled_for LIMIT 3", a.id);
    return {
      ...a,
      counts: {generated: Object.values(counts).reduce((x: number, y) => x + (y as number), 0), byStatus: counts, scheduled: (sched.planned ?? 0) + (sched.queued_remote ?? 0), published: sched.published ?? 0, manual: sched.manual_required ?? 0},
      stats,
      best,
      next: next.map((n) => ({...n, local: isoInZone(new Date(n.scheduled_for))})),
      learning: learningTable(db, `account:${a.id}`).slice(0, 12),
    };
  });
}

export function competitorsPage(db: Db) {
  const patterns = loadPatterns(db, 'market', 'all');
  return {
    competitors: db.all('SELECT * FROM competitors ORDER BY COALESCE(avg_score, 0) DESC LIMIT 200'),
    totals: db.get('SELECT COUNT(*) AS posts, COUNT(DISTINCT author) AS authors, COUNT(DISTINCT platform) AS platforms, MIN(published_at) AS since FROM posts WHERE is_own = 0'),
    sources: db.all('SELECT source, platform, COUNT(*) AS n FROM posts WHERE is_own = 0 GROUP BY source, platform'),
    insights: insightsText(patterns, 10),
    shared: crossCompetitorPatterns(patterns).slice(0, 12).map((p) => ({label: patternLabel(p), lift: p.lift, authors: p.authors, n: p.n})),
    patterns: patterns.filter((p) => p.n >= 2).map((p) => ({...p, label: p.dimension === 'hook_type' ? (HOOK_LABELS as any)[p.value] ?? p.value : p.value})),
    trends: loadTrends(db, 40),
    byPlatform: ['tiktok', 'instagram', 'threads', 'youtube'].map((pf) => ({platform: pf, insights: insightsText(loadPatterns(db, 'market', pf), 5)})).filter((x) => x.insights.length),
  };
}

export function postsPage(db: Db, f: PostFilter) {
  return queryPosts(db, f);
}

export function generatorMeta(db: Db, cfg: AppConfig) {
  const lib = loadLibrary();
  return {
    accounts: listAccounts(db).filter((a) => a.slideshows).map((a) => ({id: a.id, platform: a.platform, handle: a.handle, templates: a.brand.templates, defaultFormat: a.brand.defaultFormat})),
    niche: {id: cfg.niche.id, label: cfg.niche.label},
    topics: lib.topics.map((t) => ({id: t.id, label: t.label})),
    templates: TEMPLATES.map((t) => ({id: t.id, name: t.name})),
    structures: STRUCTURES.map((s) => ({id: s, label: STRUCTURE_LABELS[s]})),
    tones: TONES,
    formats: ['9:16', '4:5', '1:1'],
    languages: ['fr', 'en', 'es'],
    quantities: [1, 5, 10, 50, 100, 500],
    ai: new AiRouter(db, cfg).plan('writing'),
    recent: db.all('SELECT * FROM slideshows ORDER BY created_at DESC LIMIT 60').map((r) => slideshowCard(db, r)),
    ideas: db.all("SELECT * FROM ideas WHERE status = 'new' ORDER BY predicted DESC LIMIT 50"),
  };
}

export function slideshowDetail(db: Db, id: string) {
  const r = db.get('SELECT * FROM slideshows WHERE id = ?', id);
  if (!r) return null;
  const images = db.all('SELECT slide_index, path, public_url, width, height, bytes FROM images WHERE slideshow_id = ? ORDER BY slide_index', id).map((i) => ({...i, url: mediaUrl(i.path)}));
  return {...slideshowCard(db, r), slidesData: parseJson(r.slides_json, []), caption: r.caption, hashtags: parseJson(r.hashtags_json, []), facts: parseJson(r.fact_ids_json, []), qc: parseJson<any>(r.qc_json, {}).report ?? null, images, schedule: db.all('SELECT * FROM schedule WHERE slideshow_id = ? ORDER BY created_at DESC', id), approvedBy: r.approved_by, approvedAt: r.approved_at, rejectedReason: r.rejected_reason, export: mediaUrl(r.export_path)};
}

export function templatesPage() {
  const previews = path.join(PATHS.var, 'previews');
  return TEMPLATES.map((t) => {
    const files = fs.existsSync(previews) ? fs.readdirSync(previews).filter((f) => f.startsWith(`${t.id}-`)).sort() : [];
    return {...t, previews: files.map((f) => `media/previews/${f}`)};
  });
}

export function calendarPage(db: Db, cfg: AppConfig, from?: string, to?: string) {
  const start = from ?? new Date(Date.now() - 7 * 86_400_000).toISOString();
  const end = to ?? new Date(Date.now() + 35 * 86_400_000).toISOString();
  return {from: start, to: end, items: calendar(db, cfg, start, end), reserved: cfg.accounts.reservedTimes ?? null};
}

export function publicationsPage(db: Db) {
  return {
    queue: db.all("SELECT s.*, x.hook, x.template FROM schedule s JOIN slideshows x ON x.id = s.slideshow_id WHERE s.status != 'cancelled' ORDER BY s.scheduled_for DESC LIMIT 200").map((r) => ({...r, local: isoInZone(new Date(r.scheduled_for))})),
    awaiting: db.all("SELECT * FROM slideshows WHERE status IN ('awaiting_approval', 'approved') ORDER BY COALESCE(predicted, 0) DESC LIMIT 100").map((r) => slideshowCard(db, r)),
    log: db.all("SELECT at, ref, level, message FROM events WHERE kind IN ('publish', 'schedule', 'review') ORDER BY id DESC LIMIT 100"),
  };
}

export function analyticsPage(db: Db) {
  return {
    own: queryPosts(db, {own: true, limit: 100, sort: 'date'}).items,
    byPlatform: db.all('SELECT platform, COUNT(*) AS posts, SUM(views) AS views, ROUND(AVG(views)) AS avgViews, ROUND(AVG(score), 1) AS avgScore, SUM(likes) AS likes, SUM(comments) AS comments, SUM(shares) AS shares, SUM(saves) AS saves FROM posts WHERE is_own = 1 GROUP BY platform'),
    learning: learningTable(db, 'global'),
    ownPatterns: insightsText(loadPatterns(db, 'own', 'all'), 8),
    slideshowsPublished: db.all("SELECT x.id, x.hook, x.template, x.structure, p.views, p.likes, p.score FROM slideshows x JOIN posts p ON p.slideshow_id = x.id ORDER BY p.score DESC LIMIT 50"),
    viewsByDay: db.all("SELECT substr(published_at, 1, 10) AS day, platform, SUM(views) AS views FROM posts WHERE is_own = 1 AND published_at IS NOT NULL GROUP BY day, platform ORDER BY day"),
  };
}

export function settingsPage(db: Db, cfg: AppConfig) {
  return {
    accounts: listAccounts(db).map((a) => ({id: a.id, platform: a.platform, handle: a.handle, slideshows: a.slideshows, limits: a.limits, settings: a.settings, brand: a.brand})),
    compliance: cfg.compliance,
    platforms: cfg.platforms,
    ai: new AiRouter(db, cfg).status(),
    roles: cfg.ai.roles,
    budget: cfg.ai.dailyBudgetUsd,
    facts: {updatedAt: loadFacts().updatedAt, usable: usableFacts(loadFacts()).length, total: loadFacts().facts.length},
  };
}

/** Integrations, as observed during the audit and at run time (keys are never shown, only their presence). */
export function integrationsPage(db: Db, cfg: AppConfig) {
  const key = (k: string) => !!process.env[k];
  const file = path.join(PATHS.config, 'integrations-audit.json');
  const audit = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {connectors: []};
  return {
    checkedOn: audit.checkedOn ?? null,
    mcp: audit.connectors ?? [],
    apis: [
      {name: 'Zernio (API REST)', use: 'Publication TikTok (carrousels photo), statistiques', configured: key('ZERNIO_API_KEY') || !!process.env.HTTPS_PROXY, note: 'Clé ZERNIO_API_KEY. Dans l’environnement cloud, la clé est injectée par le proxy (nouvelle clé testée le 28/11/2026) ; pour GitHub Actions, l’ajouter comme secret.'},
      {name: 'Instagram (API officielle)', use: 'Publication de carrousels, statistiques', configured: key('INSTAGRAM_ACCESS_TOKEN'), note: 'Jeton INSTAGRAM_ACCESS_TOKEN (même mise en route que le studio : docs/publication-meta.md).'},
      {name: 'Threads (API officielle)', use: 'Publication de carrousels, statistiques', configured: key('THREADS_ACCESS_TOKEN'), note: 'Jeton THREADS_ACCESS_TOKEN.'},
      {name: 'Instagram Graph (Facebook Login)', use: 'Veille officielle : Business Discovery, hashtags', configured: key('META_GRAPH_TOKEN') && key('IG_BUSINESS_ID'), note: 'META_GRAPH_TOKEN + IG_BUSINESS_ID.'},
      {name: 'YouTube Data API v3', use: 'Veille officielle des Shorts de la niche', configured: key('YOUTUBE_API_KEY'), note: 'Clé gratuite YOUTUBE_API_KEY (10 000 unités par jour).'},
      {name: 'Pixabay', use: 'Photos sous licence commerciale (optionnel)', configured: key('PIXABAY_API_KEY'), note: 'PIXABAY_API_KEY.'},
    ],
    ai: new AiRouter(db, cfg).status(),
  };
}

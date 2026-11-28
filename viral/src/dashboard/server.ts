import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type {Db} from '../core/db.js';
import type {AppConfig} from '../core/config.js';
import {updateAccount} from '../core/accounts.js';
import {PATHS, ensureDir} from '../core/paths.js';
import {id as newId, nowIso} from '../core/util.js';
import {generate} from '../generate/generate.js';
import {processSlideshows} from '../pipeline.js';
import {runQc} from '../qc/qc.js';
import {Renderer} from '../render/renderer.js';
import {exportSlideshow} from '../render/export.js';
import {approve, reject} from '../review.js';
import {autoSchedule, cancel, schedule} from '../publish/scheduler.js';
import {recordPublication, retry, runDue} from '../publish/runner.js';
import {importAnalyticsFile, refreshIntelligence} from '../analytics/sync.js';
import {AiRouter} from '../ai/router.js';
import * as data from './data.js';

/**
 * Local dashboard: a JSON API over the database plus the single-page interface in ./public.
 * Bind to 127.0.0.1 by default; set DASHBOARD_TOKEN to require a token on every write when exposing it.
 */

interface JobState {
  id: string;
  kind: string;
  status: 'running' | 'done' | 'error';
  progress: string;
  result?: unknown;
  error?: string;
  startedAt: string;
}

const jobs = new Map<string, JobState>();

function startJob(kind: string, fn: (progress: (m: string) => void) => Promise<unknown>): JobState {
  const job: JobState = {id: newId('job'), kind, status: 'running', progress: 'démarrage', startedAt: nowIso()};
  jobs.set(job.id, job);
  fn((m) => (job.progress = m))
    .then((r) => {
      job.status = 'done';
      job.result = r;
    })
    .catch((e) => {
      job.status = 'error';
      job.error = (e as Error).message;
    });
  return job;
}

const MIME: Record<string, string> = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.zip': 'application/zip', '.pdf': 'application/pdf', '.json': 'application/json', '.svg': 'image/svg+xml'};

function send(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'});
  res.end(JSON.stringify(body));
}

function serveFile(res: http.ServerResponse, file: string, root: string) {
  const resolved = path.resolve(file);
  if (!resolved.startsWith(path.resolve(root)) || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    res.writeHead(404);
    return res.end('introuvable');
  }
  res.writeHead(200, {'Content-Type': MIME[path.extname(resolved)] ?? 'application/octet-stream'});
  fs.createReadStream(resolved).pipe(res);
}

async function body(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 25 * 1024 * 1024) throw new Error('requête trop volumineuse (25 Mo maximum)');
    chunks.push(c as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

export function createHandler(db: Db, cfg: AppConfig) {
  const token = process.env.DASHBOARD_TOKEN;
  return async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const p = url.pathname;
    try {
      if (p.startsWith('/media/')) return serveFile(res, path.join(PATHS.var, decodeURIComponent(p.slice(7))), PATHS.var);
      if (!p.startsWith('/api/')) return serveFile(res, path.join(PATHS.dashboardPublic, p === '/' ? 'index.html' : p.slice(1)), PATHS.dashboardPublic);
      if (req.method !== 'GET' && token && req.headers['x-dashboard-token'] !== token) return send(res, 401, {error: 'jeton du tableau de bord requis'});
      const q = Object.fromEntries(url.searchParams);
      const seg = p.split('/').filter(Boolean).slice(1);
      if (req.method === 'GET') {
        switch (seg[0]) {
          case 'overview':
            return send(res, 200, data.overview(db, cfg));
          case 'accounts':
            return send(res, 200, data.accountsPage(db));
          case 'competitors':
            return send(res, 200, data.competitorsPage(db));
          case 'posts':
            return send(res, 200, data.postsPage(db, {platform: q.platform, own: q.own === undefined ? undefined : q.own === '1', hookType: q.hookType, topic: q.topic, q: q.q, sort: q.sort as any, limit: Number(q.limit ?? 50), offset: Number(q.offset ?? 0), minScore: q.minScore ? Number(q.minScore) : undefined}));
          case 'generator':
            return send(res, 200, data.generatorMeta(db, cfg));
          case 'slideshows':
            return seg[1] ? send(res, 200, data.slideshowDetail(db, seg[1])) : send(res, 404, {error: 'id requis'});
          case 'templates':
            return send(res, 200, data.templatesPage());
          case 'calendar':
            return send(res, 200, data.calendarPage(db, cfg, q.from, q.to));
          case 'publications':
            return send(res, 200, data.publicationsPage(db));
          case 'analytics':
            return send(res, 200, data.analyticsPage(db));
          case 'settings':
            return send(res, 200, data.settingsPage(db, cfg));
          case 'integrations':
            return send(res, 200, data.integrationsPage(db, cfg));
          case 'jobs':
            return send(res, 200, seg[1] ? jobs.get(seg[1]) ?? {error: 'inconnu'} : [...jobs.values()].slice(-20));
        }
        return send(res, 404, {error: 'route inconnue'});
      }
      const b = await body(req);
      switch (seg[0]) {
        case 'generate': {
          const job = startJob('generate', async (progress) => {
            progress('génération');
            const r = await generate(db, cfg, {...b, quantity: Number(b.quantity ?? 5), slides: b.slides ? Number(b.slides) : undefined});
            if (b.mode === 'ideas' || !r.slideshowIds.length) return r;
            const p = await processSlideshows(db, cfg, r.slideshowIds, progress);
            return {...r, controleOk: p.passed, controleKo: p.failed};
          });
          return send(res, 202, job);
        }
        case 'slideshows': {
          const id = seg[1];
          switch (seg[2]) {
            case 'approve':
              return send(res, 200, approve(db, id, b.by ?? 'tableau de bord'));
            case 'reject':
              return send(res, 200, reject(db, id, b.reason ?? 'refusé'));
            case 'render': {
              const r = new Renderer();
              try {
                await r.renderSlideshow(db, cfg, id);
              } finally {
                await r.close();
              }
              return send(res, 200, runQc(db, cfg, id));
            }
            case 'qc':
              return send(res, 200, runQc(db, cfg, id));
            case 'schedule':
              return send(res, 200, schedule(db, cfg, id, b.at ? new Date(b.at) : undefined));
            case 'export':
              return send(res, 200, await exportSlideshow(db, cfg, id, {pdf: !!b.pdf}));
          }
          break;
        }
        case 'schedule':
          if (seg[1] === 'auto') return send(res, 200, autoSchedule(db, cfg, {accountId: b.accountId, max: b.max}));
          if (seg[2] === 'cancel') return (cancel(db, seg[1], b.reason ?? 'annulé depuis le tableau de bord'), send(res, 200, {ok: true}));
          if (seg[2] === 'retry') return (retry(db, seg[1]), send(res, 200, {ok: true}));
          if (seg[2] === 'record') return (recordPublication(db, seg[1], b), send(res, 200, {ok: true}));
          break;
        case 'publish':
          return send(res, 200, await runDue(db, cfg, {dryRun: b.dryRun !== false}));
        case 'accounts':
          return send(res, 200, updateAccount(db, seg[1], b));
        case 'ai':
          new AiRouter(db, cfg).setEnabled(seg[1], !!b.enabled);
          return send(res, 200, {ok: true});
        case 'import': {
          ensureDir(PATHS.imports);
          const file = path.join(PATHS.imports, `${Date.now()}-${String(b.filename ?? 'import.json').replace(/[^\w.-]/g, '_')}`);
          fs.writeFileSync(file, typeof b.content === 'string' ? b.content : JSON.stringify(b.content));
          return send(res, 200, importAnalyticsFile(db, cfg, file));
        }
        case 'analyze':
          return send(res, 200, refreshIntelligence(db, cfg));
      }
      return send(res, 404, {error: 'action inconnue'});
    } catch (e) {
      return send(res, 400, {error: (e as Error).message});
    }
  };
}

export function startServer(db: Db, cfg: AppConfig, port = 8787, host = process.env.DASHBOARD_HOST ?? '127.0.0.1'): Promise<http.Server> {
  const server = http.createServer(createHandler(db, cfg));
  return new Promise((resolve) => server.listen(port, host, () => {
    console.log(`Tableau de bord : http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
    resolve(server);
  }));
}

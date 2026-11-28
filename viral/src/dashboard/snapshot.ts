import fs from 'node:fs';
import path from 'node:path';
import type {Db} from '../core/db.js';
import type {AppConfig} from '../core/config.js';
import {sizeSpec} from '../core/config.js';
import {listAccounts} from '../core/accounts.js';
import {PATHS, ensureDir} from '../core/paths.js';
import {isoInZone} from '../core/util.js';
import {Renderer} from '../render/renderer.js';
import {buildHtml} from '../render/html.js';
import {TEMPLATES} from '../render/templates.js';
import {composeBatch} from '../generate/composer.js';
import type {Slide} from '../generate/types.js';
import * as data from './data.js';
import * as vdata from './video-data.js';

/** Renders two sample slides per template (cover + one content slide) into var/previews for the template library. */
export async function renderPreviews(db: Db, cfg: AppConfig): Promise<string[]> {
  const account = listAccounts(db, true).find((a) => a.platform === 'instagram') ?? listAccounts(db, true)[0];
  const dir = ensureDir(path.join(PATHS.var, 'previews'));
  const r = new Renderer();
  const out: string[] = [];
  try {
    for (const t of TEMPLATES) {
      const [d] = composeBatch(db, cfg, account, {accountId: account.id, quantity: 1, template: t.id, structure: t.bestFor[0], seed: `preview-${t.id}`});
      if (!d) continue;
      const slides: Slide[] = [d.slides[0], d.slides.find((s) => s.kind !== 'cover') ?? d.slides[1]];
      const size = sizeSpec(cfg, '4:5');
      const {html} = buildHtml({slides, template: t.id, format: '4:5', size, brand: account.brand, disclosure: {badge: cfg.compliance.disclosure.badge, everySlide: true}, topicLabel: d.topicLabel});
      const tmp = ensureDir(path.join(dir, `.tmp-${t.id}`));
      const {files} = await r.renderHtml(html, tmp, size, 82);
      files.forEach((f, i) => {
        const dest = path.join(dir, `${t.id}-${i + 1}.jpg`);
        fs.copyFileSync(f, dest);
        out.push(dest);
      });
      fs.rmSync(tmp, {recursive: true, force: true});
    }
  } finally {
    await r.close();
  }
  return out;
}

/** Small JPEG thumbnails (data URIs) of local images, made with the headless browser. */
async function thumbnails(files: string[], width = 300): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!files.length) return map;
  const r = new Renderer();
  try {
    await r.open();
    const page = await (r as any).browser.newPage({viewport: {width: width + 20, height: 800}});
    for (const f of files) {
      if (!fs.existsSync(f)) continue;
      await page.setContent(`<html><body style="margin:0"><img id="i" src="data:image/jpeg;base64,${fs.readFileSync(f).toString('base64')}" style="width:${width}px;display:block"></body></html>`);
      const el = await page.$('#i');
      const buf: Buffer = await el.screenshot({type: 'jpeg', quality: 72});
      map.set(f, `data:image/jpeg;base64,${buf.toString('base64')}`);
    }
    await page.close();
  } finally {
    await r.close();
  }
  return map;
}

/**
 * Self-contained, read-only copy of the dashboard (one HTML file with its data and thumbnails), suitable for
 * sharing as a private page. It shows the state at the time it was taken; actions need the local dashboard.
 */
export async function writeSnapshot(db: Db, cfg: AppConfig, outFile: string, opts: {maxSlideshows?: number; artifact?: boolean} = {}): Promise<{file: string; bytes: number; files: Record<string, string>}> {
  const recent = db.all("SELECT id FROM slideshows WHERE status NOT IN ('rejected') ORDER BY COALESCE(predicted, 0) DESC, created_at DESC LIMIT ?", opts.maxSlideshows ?? 24).map((r) => r.id);
  const slideshows: Record<string, any> = {};
  for (const id of recent) slideshows[id] = data.slideshowDetail(db, id);
  const snapshot: any = {
    takenAt: isoInZone(new Date()),
    overview: data.overview(db, cfg),
    accounts: data.accountsPage(db),
    competitors: data.competitorsPage(db),
    posts: data.postsPage(db, {limit: 200, sort: 'score'}),
    generator: data.generatorMeta(db, cfg),
    templates: data.templatesPage(),
    calendar: data.calendarPage(db, cfg),
    publications: data.publicationsPage(db),
    analytics: data.analyticsPage(db),
    settings: data.settingsPage(db, cfg),
    integrations: data.integrationsPage(db, cfg),
    slideshows,
    videos: vdata.videosPage(db, cfg),
    audio: vdata.audioStudio(db, cfg),
  };
  for (const v of snapshot.videos.videos) snapshot[`videos/${v.id}`] = vdata.videoDetail(db, v.id);
  // Audio and video files are published next to the page (relative media/… paths), never embedded.
  const files = new Map<string, string>();
  const rel = (x: unknown): unknown => {
    if (typeof x === 'string' && x.startsWith('/media/') && /\.(mp3|mp4|srt|vtt|jpg)$/.test(x)) {
      const local = path.join(PATHS.var, decodeURIComponent(x.slice('/media/'.length)));
      if (fs.existsSync(local)) files.set(x.slice(1), local);
      return x.slice(1);
    }
    if (Array.isArray(x)) return x.map(rel);
    if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, rel(v)]));
    return x;
  };
  for (const k of Object.keys(snapshot)) if (k === 'videos' || k === 'audio' || k.startsWith('videos/')) snapshot[k] = rel(snapshot[k]);
  // Replace media/… URLs by embedded thumbnails (only the images the snapshot actually shows).
  let json = JSON.stringify(snapshot);
  const urls = [...new Set(json.match(/media\/[^"\\]+?\.jpg/g) ?? [])].filter((u) => !files.has(u));
  const thumbs = await thumbnails(urls.map((u) => path.join(PATHS.var, u.slice('media/'.length))));
  for (const u of urls) {
    const t = thumbs.get(path.join(PATHS.var, u.slice('media/'.length)));
    if (t) json = json.split(`"${u}"`).join(JSON.stringify(t));
  }
  const css = fs.readFileSync(path.join(PATHS.dashboardPublic, 'styles.css'), 'utf8');
  const js = fs.readFileSync(path.join(PATHS.dashboardPublic, 'app.js'), 'utf8');
  const html = fs
    .readFileSync(path.join(PATHS.dashboardPublic, 'index.html'), 'utf8')
    .replace('<link rel="stylesheet" href="styles.css" />', () => `<style>${css}</style>`)
    .replace('<script src="app.js"></script>', () => `<script>window.__SNAPSHOT__=${json.replace(/<\/script/gi, '<\\/script')};</script><script>${js}</script>`);
  ensureDir(path.dirname(outFile));
  // For a claude.ai Artifact the host adds the document skeleton: keep only title, styles and body content.
  const out = opts.artifact
    ? html
        .replace(/<!doctype html>\s*<html[^>]*>\s*<head>[\s\S]*?<title>/i, '<title>')
        .replace('</title>', '</title>\n<meta name="claude:viewport-fit-sides" content="cover" />')
        .replace(/<\/head>\s*<body>/i, '')
        .replace(/<\/body>\s*<\/html>\s*$/i, '')
    : html;
  fs.writeFileSync(outFile, out);
  return {file: outFile, bytes: Buffer.byteLength(out), files: Object.fromEntries(files)};
}

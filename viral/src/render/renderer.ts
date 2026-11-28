import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import type {Db} from '../core/db.js';
import type {AppConfig, Format} from '../core/config.js';
import {sizeSpec} from '../core/config.js';
import {getAccount} from '../core/accounts.js';
import {PATHS, ensureDir} from '../core/paths.js';
import {id as newId, nowIso, parseJson, sha256} from '../core/util.js';
import type {Slide} from '../generate/types.js';
import {buildHtml, type ContrastReport} from './html.js';
import {templateById} from './templates.js';

const require = createRequire(import.meta.url);

/**
 * Playwright is not a dependency of the package: in the cloud container it is pre-installed globally,
 * in GitHub Actions the workflow installs it. Override the browser with VIRAL_CHROMIUM if needed.
 */
function loadPlaywright(): any {
  try {
    return require('playwright');
  } catch {
    throw new Error('Playwright introuvable : installe-le (npm i -g playwright && npx playwright install chromium) ou utilise le workflow GitHub.');
  }
}

export interface RenderResult {
  slideshowId: string;
  dir: string;
  images: Array<{index: number; path: string; width: number; height: number; bytes: number; sha256: string}>;
  fit: Array<{index: number; k: number; overflow: boolean; minFont: number}>;
  contrast: ContrastReport;
  ms: number;
}

export class Renderer {
  private browser: any = null;

  async open(): Promise<void> {
    if (this.browser) return;
    const pw = loadPlaywright();
    this.browser = await pw.chromium.launch(process.env.VIRAL_CHROMIUM ? {executablePath: process.env.VIRAL_CHROMIUM} : {});
  }

  async close(): Promise<void> {
    await this.browser?.close();
    this.browser = null;
  }

  /** Renders every slide of an HTML document to JPEG (exact platform size), with the text-fit report. */
  async renderHtml(html: string, dir: string, size: {width: number; height: number}, quality = 92): Promise<{files: string[]; fit: RenderResult['fit']}> {
    await this.open();
    ensureDir(dir);
    const htmlFile = path.join(dir, 'slides.html');
    fs.writeFileSync(htmlFile, html);
    const page = await this.browser.newPage({viewport: {width: size.width + 80, height: size.height + 80}, deviceScaleFactor: 1});
    try {
      await page.goto('file://' + htmlFile, {waitUntil: 'load'});
      await page.evaluate(() => (document as any).fonts.ready);
      const fit = await page.evaluate(() => (window as any).__fit());
      const files: string[] = [];
      const slides = await page.$$('section.slide');
      for (let i = 0; i < slides.length; i++) {
        const file = path.join(dir, `slide-${String(i + 1).padStart(2, '0')}.jpg`);
        await slides[i].screenshot({path: file, type: 'jpeg', quality});
        files.push(file);
      }
      return {files, fit};
    } finally {
      await page.close();
    }
  }

  async renderSlideshow(db: Db, cfg: AppConfig, slideshowId: string): Promise<RenderResult> {
    const t0 = Date.now();
    const ss = db.get('SELECT * FROM slideshows WHERE id = ?', slideshowId);
    if (!ss) throw new Error(`Carrousel inconnu : ${slideshowId}`);
    const account = getAccount(db, ss.account_id);
    const slides = parseJson<Slide[]>(ss.slides_json, []);
    const size = sizeSpec(cfg, ss.format as Format);
    templateById(ss.template);
    const topic = cfg.niche.topics.find((t) => t.id === ss.topic);
    const {html, contrast} = buildHtml({
      slides,
      template: ss.template,
      format: ss.format,
      size,
      brand: account.brand,
      disclosure: {badge: cfg.compliance.disclosure.badge, everySlide: cfg.compliance.disclosure.everySlide},
      topicLabel: topic?.label,
      coverPhoto: parseJson<any>(ss.qc_json, {})?.coverPhoto ?? null,
    });
    const dir = path.join(PATHS.renders, slideshowId);
    fs.rmSync(dir, {recursive: true, force: true});
    const {files, fit} = await this.renderHtml(html, dir, size);
    const images = files.map((f, index) => {
      const buf = fs.readFileSync(f);
      return {index, path: f, width: size.width, height: size.height, bytes: buf.length, sha256: sha256(buf)};
    });
    db.tx(() => {
      db.run('DELETE FROM images WHERE slideshow_id = ?', slideshowId);
      for (const im of images) db.upsert('images', {id: newId('img'), slideshow_id: slideshowId, slide_index: im.index, path: path.relative(PATHS.var, im.path), width: im.width, height: im.height, bytes: im.bytes, sha256: im.sha256, public_url: null, created_at: nowIso()});
      const qc = {...parseJson<any>(ss.qc_json, {}), render: {fit, contrast, at: nowIso()}};
      db.run("UPDATE slideshows SET status = CASE WHEN status = 'draft' THEN 'rendered' ELSE status END, render_dir = ?, qc_json = ?, updated_at = ? WHERE id = ?", path.relative(PATHS.var, dir), JSON.stringify(qc), nowIso(), slideshowId);
    });
    return {slideshowId, dir, images, fit, contrast, ms: Date.now() - t0};
  }
}

export async function renderMany(db: Db, cfg: AppConfig, ids: string[], onProgress?: (done: number, total: number, r: RenderResult | Error) => void): Promise<RenderResult[]> {
  const r = new Renderer();
  const out: RenderResult[] = [];
  try {
    for (let i = 0; i < ids.length; i++) {
      try {
        const res = await r.renderSlideshow(db, cfg, ids[i]);
        out.push(res);
        onProgress?.(i + 1, ids.length, res);
      } catch (e) {
        db.event('render', `Rendu impossible : ${(e as Error).message}`, {ref: ids[i], level: 'error'});
        onProgress?.(i + 1, ids.length, e as Error);
      }
    }
  } finally {
    await r.close();
  }
  return out;
}

/** JPEG dimensions straight from the file header (SOF marker), used by the visual checks. */
export function jpegSize(file: string): {width: number; height: number} | null {
  const b = fs.readFileSync(file);
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    const len = b.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc3) return {height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7)};
    i += 2 + len;
  }
  return null;
}

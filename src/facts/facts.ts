import fsp from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {PATHS} from '../core/paths.js';
import {exists, readValidated, sha256, writeJson, writeText} from '../core/fsx.js';
import {http} from '../core/http.js';
import {log} from '../core/log.js';
import {FactsDbSchema, SourcesSchema, SnapshotMetaSchema, type Fact, type FactsDb, type SnapshotMeta, type Source} from '../schemas/facts.js';

export async function loadFacts(): Promise<FactsDb> {
  return readValidated(PATHS.factsDb, FactsDbSchema);
}

export async function saveFacts(db: FactsDb): Promise<void> {
  FactsDbSchema.parse(db);
  await writeJson(PATHS.factsDb, db);
}

export async function loadSources(): Promise<Source[]> {
  return (await readValidated(PATHS.factsSources, SourcesSchema)).sources;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  euro: '€',
  rsquo: '’',
  lsquo: '‘',
  laquo: '«',
  raquo: '»',
  eacute: 'é',
  egrave: 'è',
  agrave: 'à',
  ccedil: 'ç',
  ecirc: 'ê',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1]?.toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

/** Readable text of an HTML page (scripts and styles removed). */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr|\/section)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t\u00a0\u202f]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Comparison form for evidence matching: case, accents, spaces and quotes do not matter. */
export function evidenceForm(s: string): string {
  return decodeEntities(s)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/[“”«»]/g, '"')
    .replace(/[\s\u00a0\u202f]+/g, ' ')
    .trim();
}

export function snapshotFiles(sourceId: string) {
  return {
    text: path.join(PATHS.factsSnapshots, `${sourceId}.txt`),
    html: path.join(PATHS.factsSnapshots, `${sourceId}.html`),
    meta: path.join(PATHS.factsSnapshots, `${sourceId}.meta.json`),
    screenshot: path.join(PATHS.factsSnapshots, `${sourceId}.png`),
  };
}

interface Rendered {
  html: string;
  text: string;
  finalUrl: string;
  status: number;
}

/** Minimal surface of Playwright used here (it is preinstalled in the cloud image, not a project dependency). */
interface PwPage {
  goto(url: string, o: object): Promise<{status(): number} | null>;
  waitForTimeout(ms: number): Promise<void>;
  locator(sel: string): {nth(i: number): {boundingBox(): Promise<{x: number; y: number; width: number; height: number} | null>}; count(): Promise<number>};
  mouse: {click(x: number, y: number): Promise<void>};
  evaluate<T>(fn: () => T): Promise<T>;
  content(): Promise<string>;
  url(): string;
  screenshot(o: object): Promise<unknown>;
}

/** Load a page in headless Chromium (through the session proxy) and read what a visitor sees. */
async function renderPage(src: Source): Promise<Rendered> {
  const render = src.render!;
  const require = createRequire(import.meta.url);
  let chromium: {launch(o: object): Promise<{newPage(o: object): Promise<PwPage>; close(): Promise<void>}>};
  try {
    chromium = (require('playwright') as {chromium: typeof chromium}).chromium;
  } catch {
    throw new Error('navigateur Playwright introuvable : page dessinée en JavaScript non lisible ici');
  }
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  const browser = await chromium.launch(proxy ? {proxy: {server: proxy}} : {});
  try {
    const page = await browser.newPage({locale: 'fr-FR', viewport: {width: 1280, height: 1000}});
    const res = await page.goto(src.url, {waitUntil: 'networkidle', timeout: 90_000}).catch(() => null);
    await page.waitForTimeout(render.waitMs);
    if (render.clickBetween) {
      const els = page.locator(`${render.clickBetween} >> visible=true`);
      if ((await els.count()) < 2) throw new Error(`élément « ${render.clickBetween} » introuvable`);
      const a = await els.nth(0).boundingBox();
      const b = await els.nth(1).boundingBox();
      if (!a || !b) throw new Error(`élément « ${render.clickBetween} » non affiché`);
      await page.mouse.click((a.x + a.width + b.x) / 2, a.y + a.height / 2);
      await page.waitForTimeout(2500);
    }
    const text = (await page.evaluate(() => document.body.innerText))
      .replace(/[ \t\u00a0\u202f]+/g, ' ')
      .replace(/\s*\n\s*/g, '\n')
      .trim();
    if (render.expectText && !evidenceForm(text).includes(evidenceForm(render.expectText))) {
      throw new Error(`la page n'affiche pas « ${render.expectText} » : état inattendu, copie non enregistrée`);
    }
    await page.screenshot({path: snapshotFiles(src.id).screenshot, fullPage: true});
    return {html: await page.content(), text, finalUrl: page.url(), status: res?.status() ?? 0};
  } finally {
    await browser.close();
  }
}

async function fetchPage(src: Source): Promise<Rendered> {
  const res = await http(src.url, {
    headers: {'user-agent': 'Mozilla/5.0 (compatible; studio-pub-verification/1.0)', 'accept-language': 'fr-FR,fr;q=0.9'},
    redirect: 'follow',
    timeoutMs: 45_000,
    retries: 2,
  });
  const html = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return {html, text: htmlToText(html), finalUrl: res.url || src.url, status: res.status};
}

/** Download the official pages and store dated text snapshots (the only accepted evidence). */
export async function refreshSnapshots(onlyIds?: string[]): Promise<SnapshotMeta[]> {
  const sources = (await loadSources()).filter((s) => !onlyIds || onlyIds.includes(s.id));
  const metas: SnapshotMeta[] = [];
  for (const src of sources) {
    try {
      const {html, text, finalUrl, status} = src.render ? await renderPage(src) : await fetchPage(src);
      const files = snapshotFiles(src.id);
      await writeText(files.html, html);
      await writeText(files.text, text);
      const meta: SnapshotMeta = {
        sourceId: src.id,
        url: src.url,
        finalUrl,
        fetchedAt: new Date().toISOString(),
        status,
        sha256: sha256(html),
        chars: text.length,
        method: src.render ? 'browser' : 'http',
      };
      await writeJson(files.meta, meta);
      metas.push(meta);
      log.ok(`Page officielle enregistrée : ${src.url}${src.render ? ' (lue dans un navigateur)' : ''} (${text.length} caractères)`);
    } catch (err) {
      log.warn(`Impossible de récupérer ${src.url} : ${(err as Error).message}`);
    }
  }
  return metas;
}

export async function readSnapshot(sourceId: string): Promise<{meta: SnapshotMeta; text: string; html: string} | null> {
  const files = snapshotFiles(sourceId);
  if (!exists(files.meta) || !exists(files.text)) return null;
  const meta = SnapshotMetaSchema.parse(JSON.parse(await fsp.readFile(files.meta, 'utf8')));
  const text = await fsp.readFile(files.text, 'utf8');
  const html = exists(files.html) ? await fsp.readFile(files.html, 'utf8') : '';
  return {meta, text, html};
}

export interface FactCheck {
  id: string;
  before: Fact['status'];
  after: Fact['status'];
  reason: string;
}

/**
 * Re-check every fact against the stored snapshot of its official page.
 * A fact is "verified" only if its verbatim evidence is present in that snapshot.
 */
export async function verifyFacts(db: FactsDb): Promise<{db: FactsDb; checks: FactCheck[]}> {
  const cache = new Map<string, Awaited<ReturnType<typeof readSnapshot>>>();
  const checks: FactCheck[] = [];
  const facts = [];
  for (const fact of db.facts) {
    if (!cache.has(fact.sourceId)) cache.set(fact.sourceId, await readSnapshot(fact.sourceId));
    const snap = cache.get(fact.sourceId);
    let status: Fact['status'] = fact.status === 'refuted' ? 'refuted' : 'unverified';
    let reason: string;
    let verifiedAt = fact.verifiedAt;
    if (fact.status === 'refuted') reason = 'marqué comme réfuté';
    else if (!snap) reason = `aucune copie de la page « ${fact.sourceId} » (lancer facts:refresh)`;
    else if (!fact.evidence) reason = 'aucun extrait officiel renseigné';
    else {
      const needle = evidenceForm(fact.evidence);
      const found = evidenceForm(snap.text).includes(needle) || evidenceForm(htmlToText(snap.html)).includes(needle) || evidenceForm(snap.html).includes(needle);
      if (found) {
        status = 'verified';
        verifiedAt = snap.meta.fetchedAt;
        reason = `extrait trouvé dans la page du ${snap.meta.fetchedAt.slice(0, 10)}`;
      } else {
        status = fact.status === 'verified' ? 'stale' : 'unverified';
        reason = 'extrait introuvable dans la page actuelle (la page a peut-être changé)';
      }
    }
    checks.push({id: fact.id, before: fact.status, after: status, reason});
    facts.push({...fact, status, verifiedAt: status === 'verified' ? verifiedAt : fact.verifiedAt});
  }
  return {db: {updatedAt: new Date().toISOString(), facts}, checks};
}

export function isFresh(fact: Fact, now = new Date()): boolean {
  if (fact.status !== 'verified' || !fact.verifiedAt) return false;
  const ageDays = (now.getTime() - Date.parse(fact.verifiedAt)) / 86_400_000;
  return ageDays <= fact.ttlDays;
}

export function usableFacts(db: FactsDb, now = new Date()): Fact[] {
  return db.facts.filter((f) => isFresh(f, now));
}

export function featuresWithFacts(facts: Fact[]): Set<string> {
  const out = new Set<string>();
  for (const f of facts) for (const t of f.tags) if (t.startsWith('feature:')) out.add(t.slice('feature:'.length));
  return out;
}

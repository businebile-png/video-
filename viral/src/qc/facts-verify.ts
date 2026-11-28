import fs from 'node:fs';
import path from 'node:path';
import {PATHS} from '../core/paths.js';
import {Renderer} from '../render/renderer.js';
import type {Fact, FactSource} from '../core/facts.js';

/**
 * Re-checks every fact against the official page it comes from: the fact stays "verified" only if its evidence
 * excerpt is still found word for word in today's page. Pages drawn by JavaScript (pricing) are read in a browser,
 * following the render hints of data/facts/sources.json. A missing excerpt marks the fact "unverified"
 * (it can no longer be used in a slideshow) — it is never deleted.
 */

const norm = (t: string) => t.replace(/[   ]/g, ' ').replace(/[’]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();

async function pageText(src: FactSource & {render?: {waitMs?: number; clickBetween?: string; expectText?: string}}, browser: Renderer): Promise<string> {
  if (src.render) {
    await browser.open();
    const page = await (browser as any).browser.newPage();
    try {
      await page.goto(src.url, {waitUntil: 'domcontentloaded', timeout: 60_000});
      await page.waitForTimeout(src.render.waitMs ?? 2000);
      // Scroll to the bottom so lazy sections (comparison table, FAQ) are in the DOM.
      for (let i = 0; i < 12; i++) {
        await page.mouse.wheel(0, 1600);
        await page.waitForTimeout(250);
      }
      if (src.render.clickBetween) {
        // Same method as the video studio: click the switch between the two labels (monthly | annual).
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(500);
        const els = page.locator(`${src.render.clickBetween} >> visible=true`);
        if ((await els.count()) < 2) throw new Error(`élément « ${src.render.clickBetween} » introuvable`);
        const a = await els.nth(0).boundingBox();
        const b = await els.nth(1).boundingBox();
        if (!a || !b) throw new Error(`élément « ${src.render.clickBetween} » non affiché`);
        await page.mouse.click((a.x + a.width + b.x) / 2, a.y + a.height / 2);
        await page.waitForTimeout(2500);
      }
      // innerText for the readable snapshot, plus textContent (without scripts) for collapsed FAQ answers.
      const text: string = await page.evaluate(() => {
        const clone = document.body.cloneNode(true) as HTMLElement;
        clone.querySelectorAll('script,style,noscript,svg').forEach((n) => n.remove());
        return `${document.body.innerText}\n\n${clone.textContent ?? ''}`;
      });
      if (src.render.expectText && !norm(text).includes(norm(src.render.expectText))) throw new Error(`texte attendu absent (« ${src.render.expectText} »)`);
      return text;
    } finally {
      await page.close();
    }
  }
  const res = await fetch(src.url, {headers: {'User-Agent': 'Mozilla/5.0 (compatible; viral-content-machine fact check)'}});
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  return html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&#39;|&rsquo;/g, "'").replace(/&amp;/g, '&');
}

export async function verifyFacts(dir = PATHS.facts, now = new Date()): Promise<{checked: number; verified: number; lost: Array<{id: string; source: string}>; errors: Array<{source: string; error: string}>}> {
  const bookFile = path.join(dir, 'systeme-io.json');
  const book = JSON.parse(fs.readFileSync(bookFile, 'utf8')) as {updatedAt: string; facts: Fact[]};
  const sources = (JSON.parse(fs.readFileSync(path.join(dir, 'sources.json'), 'utf8')) as {sources: any[]}).sources;
  const browser = new Renderer();
  const out = {checked: 0, verified: 0, lost: [] as Array<{id: string; source: string}>, errors: [] as Array<{source: string; error: string}>};
  try {
    for (const src of sources) {
      const facts = book.facts.filter((f) => f.sourceId === src.id && f.evidence && f.status !== 'refuted');
      if (!facts.length) continue;
      let text: string;
      try {
        text = norm(await pageText(src, browser));
      } catch (e) {
        out.errors.push({source: src.id, error: (e as Error).message});
        continue;
      }
      fs.mkdirSync(path.join(dir, 'snapshots'), {recursive: true});
      fs.writeFileSync(path.join(dir, 'snapshots', `${src.id}.txt`), text);
      fs.writeFileSync(path.join(dir, 'snapshots', `${src.id}.meta.json`), JSON.stringify({id: src.id, url: src.url, fetchedAt: now.toISOString(), chars: text.length}, null, 1));
      for (const f of facts) {
        out.checked++;
        // Whitespace-insensitive: block elements are glued together in textContent.
        if (text.includes(norm(f.evidence!)) || text.replace(/\s+/g, '').includes(norm(f.evidence!).replace(/\s+/g, ''))) {
          f.status = 'verified';
          f.verifiedAt = now.toISOString();
          out.verified++;
        } else {
          f.status = 'unverified';
          f.notes = `${f.notes ? f.notes + ' ' : ''}Extrait introuvable sur ${src.url} le ${now.toISOString().slice(0, 10)}.`.slice(-400);
          out.lost.push({id: f.id, source: src.id});
        }
      }
    }
  } finally {
    await browser.close();
  }
  book.updatedAt = now.toISOString();
  fs.writeFileSync(bookFile, JSON.stringify(book, null, 2) + '\n');
  return out;
}

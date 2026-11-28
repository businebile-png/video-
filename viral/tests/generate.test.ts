import {describe, expect, it} from 'vitest';
import fs from 'node:fs';
import {generate} from '../src/generate/generate.js';
import {composeBatch, coreText, slideText} from '../src/generate/composer.js';
import {draftsFromAi} from '../src/generate/llm.js';
import {loadLibrary} from '../src/generate/library.js';
import {getAccount} from '../src/core/accounts.js';
import {loadFacts, isFresh} from '../src/core/facts.js';
import {findForbidden, WEALTH_IMAGERY} from '../src/qc/rules.js';
import {normalize, shingles, jaccard} from '../src/core/text.js';
import {AiRouter} from '../src/ai/router.js';
import {tmpDb} from './helpers.js';

describe('bibliothèque de contenu', () => {
  it('ne contient aucune formulation interdite et seulement des faits vérifiés', () => {
    const strings: string[] = [];
    const walk = (o: any) => (typeof o === 'string' ? strings.push(o) : Array.isArray(o) ? o.forEach(walk) : o && typeof o === 'object' ? Object.values(o).forEach(walk) : null);
    for (const f of ['topics.json', 'hooks.json', 'ctas.json']) walk(JSON.parse(fs.readFileSync(`data/library/${f}`, 'utf8')));
    for (const s of strings) {
      expect(findForbidden(s), s).toEqual([]);
      expect(WEALTH_IMAGERY.test(normalize(s)), s).toBe(false);
    }
    const ids = new Set(loadFacts().facts.filter((f) => f.status === 'verified').map((f) => f.id));
    const lib = loadLibrary();
    const used = JSON.stringify(lib).match(/"(plan|feature|rule|service|proof|affiliate)\.[\w.-]+"/g) ?? [];
    for (const u of used) expect(ids.has(u.replace(/"/g, '')), u).toBe(true);
  });
});

describe('générateur hors ligne', () => {
  it('produit des carrousels complets, variés et sans doublon', () => {
    const {db, cfg} = tmpDb();
    const acc = getAccount(db, 'instagram-12eu125');
    const drafts = composeBatch(db, cfg, acc, {accountId: acc.id, quantity: 40, seed: 'test'});
    expect(drafts.length).toBe(40);
    for (const d of drafts) {
      expect(d.slides[0].kind).toBe('cover');
      expect(d.slides.at(-1)!.kind).toBe('cta');
      expect(d.slides.length).toBeLessThanOrEqual(10);
      expect(d.caption.startsWith('Publicité · Systeme.io')).toBe(true);
      expect(d.caption.length).toBeLessThanOrEqual(2200);
    }
    const fps = drafts.map((d) => shingles(slideText(d.slides), 4));
    for (let i = 0; i < fps.length; i++) for (let j = i + 1; j < fps.length; j++) expect(jaccard(fps[i], fps[j])).toBeLessThan(0.72);
    expect(new Set(drafts.map((d) => d.template)).size).toBeGreaterThan(2);
  });
  it('ne répète ni une accroche, ni une histoire, ni un contenu sur un même compte', () => {
    const {db, cfg} = tmpDb();
    const acc = getAccount(db, 'threads-12eu125');
    const drafts = composeBatch(db, cfg, acc, {accountId: acc.id, quantity: 40, seed: 'doublons'});
    const hooks = drafts.map((d) => d.hook.toLowerCase());
    expect(new Set(hooks).size).toBe(hooks.length);
    const stories = drafts.filter((d) => d.structure === 'histoire').map((d) => d.topic);
    expect(new Set(stories).size).toBe(stories.length);
    const core = drafts.map((d) => shingles(coreText(d.slides), 4));
    for (let i = 0; i < core.length; i++) for (let j = i + 1; j < core.length; j++) expect(jaccard(core[i], core[j])).toBeLessThan(0.6);
  });
  it('respecte le nombre de slides et le modèle demandés', () => {
    const {db, cfg} = tmpDb();
    const acc = getAccount(db, 'tiktok-12eure21');
    const [d] = composeBatch(db, cfg, acc, {accountId: acc.id, quantity: 1, slides: 7, template: 'luxe', structure: 'liste', seed: 's'});
    expect(d.slides.length).toBe(7);
    expect(d.template).toBe('luxe');
    expect(d.format).toBe('9:16');
  });
  it('bascule sur le moteur hors ligne quand aucune IA n’est disponible, et le dit', async () => {
    const {db, cfg} = tmpDb();
    const r = await generate(db, cfg, {accountId: 'threads-12eu125', quantity: 3, seed: 'x'}, new AiRouter(db, cfg, {}));
    expect(r.engine).toBe('composer');
    expect(r.slideshowIds.length).toBe(3);
    expect(r.notes.join(' ')).toMatch(/hors ligne/);
    const thread = db.get<{caption: string}>('SELECT caption FROM slideshows WHERE id = ?', r.slideshowIds[0])!;
    expect(thread.caption.length).toBeLessThanOrEqual(500);
  });
  it('refuse une langue que la bibliothèque ne couvre pas sans IA', async () => {
    const {db, cfg} = tmpDb();
    await expect(generate(db, cfg, {accountId: 'threads-12eu125', quantity: 1, language: 'en'}, new AiRouter(db, cfg, {}))).rejects.toThrow(/IA/);
  });
  it('refuse un compte sans carrousel (YouTube)', async () => {
    const {db, cfg} = tmpDb();
    await expect(generate(db, cfg, {accountId: 'youtube-zzetu', quantity: 1}, new AiRouter(db, cfg, {}))).rejects.toThrow(/désactivés/);
  });
});

describe('moteur IA (réponse simulée)', () => {
  it('normalise une réponse valide et rejette les faits inventés', () => {
    const {db, cfg} = tmpDb();
    const acc = getAccount(db, 'instagram-12eu125');
    const answer = {
      slideshows: [
        {topic: 'liste-email', structure: 'liste', hookType: 'liste', hook: '3 conseils pour ta liste e-mail', slides: [{kind: 'cover', title: '3 conseils pour ta liste e-mail'}, {kind: 'item', number: 1, title: 'Un rythme régulier', body: 'Un jour fixe chaque semaine.'}, {kind: 'item', number: 2, title: 'Un objet honnête', body: 'Donne envie sans mentir.'}, {kind: 'item', number: 3, title: 'Un seul lien', body: 'Une action par e-mail.'}, {kind: 'cta', title: 'Enregistre-le', body: 'Pour plus tard.', product: {title: 'Systeme.io', body: 'Plan gratuit, sans carte bancaire. Lien en bio.'}, factIds: ['plan.free.exists', 'plan.free.no-card']}]},
        {topic: 'x', structure: 'liste', hookType: 'liste', hook: 'Un fait inventé ici', slides: [{kind: 'cover', title: 'a'}, {kind: 'item', title: 'b', factIds: ['plan.inexistant']}, {kind: 'cta', title: 'c'}]},
      ],
    };
    const r = draftsFromAi(db, cfg, acc, {accountId: acc.id, quantity: 2}, answer, 'ai:test');
    expect(r.drafts.length).toBe(1);
    expect(r.rejected[0]).toMatch(/faits inconnus/);
    expect(r.drafts[0].caption.startsWith('Publicité · Systeme.io')).toBe(true);
  });
  it('les faits de prix sont encore frais (sinon relancer facts:verify)', () => {
    const price = loadFacts().facts.find((f) => f.id === 'plan.startup.price')!;
    if (!isFresh(price)) console.warn('plan.startup.price périmé : lancer « npm run viral -- facts:verify »');
    expect(price.status).toBe('verified');
  });
});

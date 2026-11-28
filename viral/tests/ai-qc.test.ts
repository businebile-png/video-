import {describe, expect, it} from 'vitest';
import http from 'node:http';
import {AiRouter, extractJson, OfflineFallback} from '../src/ai/router.js';
import {callOpenAiCompatible} from '../src/ai/providers/openai-compat.js';
import {runQc} from '../src/qc/qc.js';
import {spellCheck, grammarCheck} from '../src/qc/spell.js';
import {findForbidden} from '../src/qc/rules.js';
import {generate} from '../src/generate/generate.js';
import {rebuildLearning, choose} from '../src/analytics/learn.js';
import {rng} from '../src/core/util.js';
import {contrast, resolvePalette} from '../src/render/html.js';
import {TEMPLATES} from '../src/render/templates.js';
import {getAccount, listAccounts} from '../src/core/accounts.js';
import {tmpDb} from './helpers.js';

describe('routeur IA', () => {
  it('choisit, journalise, applique le budget et retombe sur le modèle suivant', async () => {
    const {db, cfg} = tmpDb();
    const calls: string[] = [];
    const router = new AiRouter(db, cfg, {ANTHROPIC_API_KEY: 'test', GOOGLE_AI_API_KEY: 'test'}, {
      anthropic: async ({model}) => {
        calls.push(model.id);
        throw new Error('HTTP 500');
      },
      openai: async ({model}) => {
        calls.push(model.id);
        return {text: '{"ok": true}', tokensIn: 1000, tokensOut: 200};
      },
    });
    const r = await router.complete({role: 'writing', purpose: 'test', system: 's', prompt: 'p', json: true});
    expect(calls).toEqual(['anthropic:claude-opus-5-5', 'google:gemini-2.5-flash']);
    expect(r.json).toEqual({ok: true});
    expect(r.costUsd).toBe(0);
    const logged = db.all('SELECT status FROM ai_calls ORDER BY id');
    expect(logged.map((l) => l.status)).toEqual(['error', 'ok']);
    // Circuit breaker after 3 failures in 10 minutes.
    for (let i = 0; i < 2; i++) await router.complete({role: 'writing', purpose: 't', system: 's', prompt: 'p'}).catch(() => {});
    expect(router.unavailableReason(cfg.ai.models.find((m) => m.id === 'anthropic:claude-opus-5-5')!)).toMatch(/disjoncteur/);
  });
  it('coupe un fournisseur payant quand le budget du jour est atteint', () => {
    const {db, cfg} = tmpDb();
    db.run("INSERT INTO ai_calls(at, role, provider, model, purpose, tokens_in, tokens_out, cost_usd, latency_ms, status) VALUES (?, 'writing', 'anthropic', 'claude-opus-5-5', 't', 1, 1, 5, 1, 'ok')", new Date().toISOString());
    const router = new AiRouter(db, cfg, {ANTHROPIC_API_KEY: 'k'});
    expect(router.unavailableReason(cfg.ai.models[0])).toMatch(/budget/);
  });
  it('signale le passage hors ligne quand aucune clé n’est présente', async () => {
    const {db, cfg} = tmpDb();
    await expect(new AiRouter(db, cfg, {}).complete({role: 'ideas', purpose: 't', system: 's', prompt: 'p'})).rejects.toBeInstanceOf(OfflineFallback);
  });
  it('appelle réellement une API compatible OpenAI (serveur local)', async () => {
    const server = http.createServer((req, res) => {
      let b = '';
      req.on('data', (c) => (b += c));
      req.on('end', () => {
        const body = JSON.parse(b);
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({choices: [{message: {content: `modèle ${body.model}`}}], usage: {prompt_tokens: 12, completion_tokens: 3}}));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as any).port;
    const r = await callOpenAiCompatible({provider: {kind: 'openai', keyEnv: [], free: true}, providerId: 'x', model: {id: 'x:m', provider: 'x', model: 'm1', inputPerMTok: 0, outputPerMTok: 0, enabled: true, roles: []}, apiKey: 'k', baseUrl: `http://127.0.0.1:${port}`, system: 's', prompt: 'p', maxTokens: 10});
    server.close();
    expect(r).toEqual({text: 'modèle m1', tokensIn: 12, tokensOut: 3});
  });
  it('extrait le JSON d’une réponse bavarde', () => {
    expect(extractJson('Voici :\n```json\n{"a":1}\n```')).toEqual({a: 1});
    expect(extractJson('texte {"b":[1,2]} fin')).toEqual({b: [1, 2]});
    expect(extractJson('rien')).toBeUndefined();
  });
});

describe('contrôle qualité', () => {
  it('bloque promesses, faux chiffres, marques concurrentes et mention absente', async () => {
    const {db, cfg} = tmpDb();
    const r = await generate(db, cfg, {accountId: 'instagram-12eu125', quantity: 1, seed: 'qc'}, new AiRouter(db, cfg, {}));
    const id = r.slideshowIds[0];
    expect(runQc(db, cfg, id).ok).toBe(true);
    const bad = [
      {kind: 'cover', title: '3 astuces pour gagner 5000 € par mois'},
      {kind: 'item', number: 1, title: 'Systeme.io coûte 9 € par mois', body: '80 % des gens réussissent'},
      {kind: 'item', number: 2, title: 'Mieux que Kajabi'},
      {kind: 'cta', title: 'Dernière chance'},
    ];
    db.run("UPDATE slideshows SET slides_json = ?, caption = 'Super offre', hook = '3 astuces pour gagner 5000 € par mois' WHERE id = ?", JSON.stringify(bad), id);
    const q = runQc(db, cfg, id);
    const checks = new Set(q.errors.map((e) => e.check));
    expect(q.ok).toBe(false);
    for (const c of ['conformite', 'faits', 'mention-publicite', 'promesse-nombre']) expect(checks.has(c), c).toBe(true);
    expect(db.get<{status: string}>('SELECT status FROM slideshows WHERE id = ?', id)!.status).toBe('qc_failed');
  });
  it('détecte orthographe et grammaire', () => {
    expect(spellCheck('Une page de captur pour ta liste e-mail').map((s) => s.word)).toContain('captur');
    expect(grammarCheck('le le tunnel')).toContain('mot répété : « le le »');
    expect(grammarCheck('la page de une formation').join(' ')).toMatch(/élision/);
    expect(findForbidden('Deviens millionnaire grâce à ce tunnel').length).toBeGreaterThan(0);
  });
});

describe('boucle d’apprentissage', () => {
  it('favorise ce qui a marché chez nous, sans cesser d’explorer', () => {
    const {db} = tmpDb();
    const now = new Date().toISOString();
    for (let i = 0; i < 12; i++) {
      for (const [tpl, score] of [['luxe', 80], ['minimaliste', 35]] as const) {
        const sid = `ss_${tpl}_${i}`;
        db.run("INSERT INTO slideshows(id, account_id, platform, template, format, slides_json, status, created_at, updated_at) VALUES (?, 'instagram-12eu125', 'instagram', ?, '4:5', '[]', 'published', ?, ?)", sid, tpl, now, now);
        db.run("INSERT INTO posts(id, platform, external_id, is_own, account_id, slideshow_id, collected_at, source, text, score) VALUES (?, 'instagram', ?, 1, 'instagram-12eu125', ?, ?, 'test', 'x', ?)", `p_${sid}`, sid, sid, now, score + (i % 3));
      }
    }
    expect(rebuildLearning(db).samples).toBe(24);
    const rand = rng('learn');
    let luxe = 0;
    for (let i = 0; i < 200; i++) if (choose(db, {dimension: 'template', values: ['luxe', 'minimaliste'], accountId: 'instagram-12eu125', rand, epsilon: 0.15}).value === 'luxe') luxe++;
    expect(luxe).toBeGreaterThan(150);
    expect(luxe).toBeLessThan(200);
  });
});

describe('visuels', () => {
  it('garde un contraste lisible pour chaque modèle et chaque compte', () => {
    const {db} = tmpDb();
    for (const a of listAccounts(db)) {
      for (const t of TEMPLATES) {
        const p = resolvePalette(t, getAccount(db, a.id).brand);
        expect(contrast(p.fg, t.id === 'motivation' ? p.g1 : p.bg), `${a.id}/${t.id}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(p.onAccent, p.accent), `${a.id}/${t.id} accent`).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

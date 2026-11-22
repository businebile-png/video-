import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {
  MAX_ATTEMPTS,
  classify,
  fitThreads,
  mediaUrls,
  readState,
  runDue,
  threadsLength,
  verifyTokens,
  type MetaState,
  type QueueEntry,
} from '../src/publish/meta.js';

const SLOT = '2026-11-23T20:00:00+01:00';
const SLOT_MS = Date.parse(SLOT);
const RAW = 'https://raw.githubusercontent.com/businebile-png/video-/claude/serene-maxwell-pdm5wr/videos/2026-11-22-a.mp4';
const TOKENS = {INSTAGRAM_ACCESS_TOKEN: 'IGTOKEN-secret', THREADS_ACCESS_TOKEN: 'THTOKEN-secret'};

function entry(patch: Partial<QueueEntry> = {}): QueueEntry {
  return {
    runId: '2026-11-22-a',
    status: 'prete',
    autoSlot: {iso: SLOT, label: 'lundi 23 novembre à 20:00'},
    score: {decision: 'publishable'},
    media: {publicUrl: RAW},
    posts: [
      {network: 'tiktok', text: 'Publicité · Systeme.io\n\nTikTok'},
      {network: 'instagram', text: 'Publicité · Systeme.io\n\nLégende Instagram #systemeio', info: {firstCommentText: 'Tu postes sur quel réseau ? 👇', videoCoverMilliseconds: 0}},
      {network: 'threads', text: 'Publicité · Systeme.io\n\nLégende Threads #systemeio'},
    ],
    ...patch,
  };
}

function makeRoot(entries: QueueEntry[] = [entry()], state?: MetaState): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-test-'));
  fs.mkdirSync(path.join(root, 'queue'), {recursive: true});
  for (const e of entries) fs.writeFileSync(path.join(root, 'queue', `${e.runId}.json`), JSON.stringify(e));
  fs.writeFileSync(path.join(root, 'queue', 'claude-en-cours.json'), JSON.stringify({slot: {iso: SLOT}, startedAt: new Date().toISOString()}));
  fs.writeFileSync(path.join(root, 'queue', 'LISEZMOI.md'), '# file');
  if (state) {
    fs.mkdirSync(path.join(root, 'data'), {recursive: true});
    fs.writeFileSync(path.join(root, 'data', 'meta-publications.json'), JSON.stringify(state));
  }
  return root;
}

interface Call {
  method: string;
  url: string;
  params: URLSearchParams;
}

/** Faux serveur Graph : `routes` répond selon « METHODE chemin » ; une liste de réponses est consommée une à une. */
function fakeGraph(routes: Record<string, unknown>) {
  const calls: Call[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const u = new URL(String(input));
    const params = new URLSearchParams(method === 'GET' ? u.search : String(init?.body ?? ''));
    calls.push({method, url: `${u.origin}${u.pathname}`, params});
    const key = `${method} ${u.pathname.replace(/^\/(v[\d.]+)/, '')}`;
    let r = routes[key];
    if (typeof r === 'function') r = (r as (c: Call) => unknown)(calls[calls.length - 1]!);
    if (Array.isArray(r)) r = r.length > 1 ? r.shift() : r[0];
    if (r === undefined) return new Response(JSON.stringify({error: {message: `route inconnue ${key}`, code: 1}}), {status: 404});
    if (r instanceof Response) return r;
    return new Response(JSON.stringify(r), {status: 200});
  }) as typeof fetch;
  return {fetchFn, calls};
}

const igRoutes = (extra: Record<string, unknown> = {}) => ({
  'GET /me': {user_id: '111', username: '12eu125', account_type: 'BUSINESS'},
  'POST /111/media': {id: 'c1'},
  'GET /c1': [{status_code: 'IN_PROGRESS'}, {status_code: 'FINISHED'}],
  'POST /111/media_publish': {id: 'm1'},
  'GET /m1': {permalink: 'https://www.instagram.com/reel/abc/'},
  'POST /m1/comments': {id: 'cm1'},
  ...extra,
});

describe('classify : quoi publier, quand', () => {
  const state: MetaState = {version: 1, posts: {}};
  it('à venir avant le créneau, à publier ensuite, plus après 5 h', () => {
    expect(classify(entry(), 'instagram', state, TOKENS, SLOT_MS - 60_000).kind).toBe('upcoming');
    expect(classify(entry(), 'instagram', state, TOKENS, SLOT_MS + 60_000).kind).toBe('due');
    const late = classify(entry(), 'instagram', state, TOKENS, SLOT_MS + 6 * 3_600_000);
    expect(late.kind).toBe('skip');
  });

  it('ne publie pas sans la mention « Publicité », sans « publishable » ou sans jeton', () => {
    const noMention = entry({posts: [{network: 'instagram', text: 'Légende sans mention'}]});
    expect(classify(noMention, 'instagram', state, TOKENS, SLOT_MS + 1)).toMatchObject({kind: 'skip', reason: expect.stringContaining('Publicité')});
    const redo = entry({score: {decision: 'redo'}});
    expect(classify(redo, 'instagram', state, TOKENS, SLOT_MS + 1)).toMatchObject({kind: 'skip'});
    expect(classify(entry(), 'threads', state, {INSTAGRAM_ACCESS_TOKEN: 'x'}, SLOT_MS + 1)).toMatchObject({kind: 'skip', reason: expect.stringContaining('absent')});
  });

  it('ne republie pas ce qui est publié, laissé de côté ou échoué trop de fois', () => {
    const at = '2026-11-23T19:00:00Z';
    const s: MetaState = {version: 1, posts: {'2026-11-22-a': {instagram: {status: 'published', at}, threads: {status: 'failed', at, attempts: MAX_ATTEMPTS}}}};
    expect(classify(entry(), 'instagram', s, TOKENS, SLOT_MS + 1)).toMatchObject({kind: 'skip', reason: 'déjà publié'});
    expect(classify(entry(), 'threads', s, TOKENS, SLOT_MS + 1)).toMatchObject({kind: 'skip'});
    const skipped: MetaState = {version: 1, posts: {'2026-11-22-a': {instagram: {status: 'skipped', at, reason: 'Metricool'}}}};
    expect(classify(entry(), 'instagram', skipped, TOKENS, SLOT_MS + 1)).toMatchObject({kind: 'skip'});
  });

  it('un échec isolé laisse une nouvelle chance', () => {
    const s: MetaState = {version: 1, posts: {'2026-11-22-a': {instagram: {status: 'failed', at: '2026-11-23T19:00:00Z', attempts: 1}}}};
    expect(classify(entry(), 'instagram', s, TOKENS, SLOT_MS + 1).kind).toBe('due');
  });
});

describe('Threads : longueur et adresses de la vidéo', () => {
  it('compte les emojis en octets UTF-8 et raccourcit au dernier mot entier', () => {
    expect(threadsLength('a🎵')).toBe(1 + 4);
    const long = ('mot ' as string).repeat(140) + '🎵';
    const fitted = fitThreads(long);
    expect(threadsLength(fitted)).toBeLessThanOrEqual(500);
    expect(fitted.endsWith('…')).toBe(true);
    expect(fitThreads('court')).toBe('court');
  });

  it('propose GitHub puis jsDelivr épinglé sur le commit récupéré', () => {
    expect(mediaUrls(entry(), {})).toEqual([RAW]);
    expect(mediaUrls(entry(), {META_MEDIA_REF: 'abc123'})).toEqual([RAW, 'https://cdn.jsdelivr.net/gh/businebile-png/video-@abc123/videos/2026-11-22-a.mp4']);
  });
});

describe('runDue : publication complète', () => {
  it('publie le Reel puis le post Threads, avec les mentions IA, et note le résultat', async () => {
    const root = makeRoot();
    const g = fakeGraph({
      ...igRoutes(),
      'GET /me ': {},
      'POST /222/threads': {id: 't1'},
      'GET /t1': [{status: 'IN_PROGRESS'}, {status: 'FINISHED'}],
      'POST /222/threads_publish': {id: 'tm1'},
      'GET /tm1': {permalink: 'https://www.threads.com/@12eu125/post/xyz'},
    });
    // Threads et Instagram ont chacun leur /me : on distingue par l'hôte.
    const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('https://graph.threads.com/v1.0/me')) return new Response(JSON.stringify({id: '222', username: '12eu125'}), {status: 200});
      return g.fetchFn(input, init);
    }) as typeof fetch;
    const sleeps: number[] = [];
    const res = await runDue({root, env: TOKENS, nowFn: () => SLOT_MS + 120_000, fetchFn, sleep: async (ms) => void sleeps.push(ms), log: () => {}});

    expect(res.failed).toEqual([]);
    expect(res.published.map((p) => `${p.network}:${p.id}`)).toEqual(['instagram:m1', 'threads:tm1']);
    const create = g.calls.find((c) => c.method === 'POST' && c.url.endsWith('/111/media'))!;
    expect(create.params.get('media_type')).toBe('REELS');
    expect(create.params.get('video_url')).toBe(RAW);
    expect(create.params.get('is_ai_generated')).toBe('true');
    expect(create.params.get('share_to_feed')).toBe('true');
    expect(create.params.get('caption')).toMatch(/^Publicité · Systeme\.io/);
    expect(create.params.get('thumb_offset')).toBeNull();
    expect(g.calls.some((c) => c.url.endsWith('/m1/comments') && c.params.get('message') === 'Tu postes sur quel réseau ? 👇')).toBe(true);
    const th = g.calls.find((c) => c.url.endsWith('/222/threads'))!;
    expect(th.params.get('media_type')).toBe('VIDEO');
    expect(th.params.get('is_made_with_ai')).toBe('true');
    expect(sleeps.length).toBe(2); // une attente de traitement par réseau

    const state = readState(root);
    expect(state.posts['2026-11-22-a']?.instagram).toMatchObject({status: 'published', id: 'm1', permalink: 'https://www.instagram.com/reel/abc/'});
    expect(state.posts['2026-11-22-a']?.threads).toMatchObject({status: 'published', id: 'tm1'});

    // Une seconde exécution ne republie rien.
    const again = await runDue({root, env: TOKENS, nowFn: () => SLOT_MS + 240_000, fetchFn, sleep: async () => {}, log: () => {}});
    expect(again.published).toEqual([]);
  });

  it("essaie l'adresse de secours si Meta refuse la première, sans jamais republier après la publication", async () => {
    const root = makeRoot();
    // Le conteneur créé avec l'adresse GitHub finit en erreur ; celui créé avec jsDelivr (c2) est accepté.
    const g = fakeGraph(
      igRoutes({
        'POST /111/media': (c: Call) => ({id: c.params.get('video_url') === RAW ? 'c1' : 'c2'}),
        'GET /c1': {status_code: 'ERROR', status: 'Media download failed'},
        'GET /c2': {status_code: 'FINISHED'},
        'POST /111/media_publish': (c: Call) => (c.params.get('creation_id') === 'c2' ? {id: 'm1'} : new Response('{"error":{"message":"mauvais conteneur"}}', {status: 400})),
      }),
    );
    const res = await runDue({root, env: {INSTAGRAM_ACCESS_TOKEN: TOKENS.INSTAGRAM_ACCESS_TOKEN, META_MEDIA_REF: 'abc123'}, nowFn: () => SLOT_MS + 1000, fetchFn: g.fetchFn, sleep: async () => {}, log: () => {}});
    expect(res.failed).toEqual([]);
    expect(res.published).toHaveLength(1);
    const urls = g.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/111/media')).map((c) => c.params.get('video_url'));
    expect(urls).toEqual([RAW, 'https://cdn.jsdelivr.net/gh/businebile-png/video-@abc123/videos/2026-11-22-a.mp4']);
  });

  it("note l'échec sans jamais écrire le jeton, et s'arrête après 3 essais", async () => {
    const root = makeRoot();
    const g = fakeGraph({
      'GET /me': {user_id: '111', username: 'x'},
      'POST /111/media': new Response(JSON.stringify({error: {message: `Invalid OAuth access token ${TOKENS.INSTAGRAM_ACCESS_TOKEN}`, code: 190}}), {status: 400}),
    });
    const env = {INSTAGRAM_ACCESS_TOKEN: TOKENS.INSTAGRAM_ACCESS_TOKEN};
    for (let i = 1; i <= MAX_ATTEMPTS; i++) {
      const res = await runDue({root, env, nowFn: () => SLOT_MS + i * 1000, fetchFn: g.fetchFn, sleep: async () => {}, log: () => {}});
      expect(res.failed).toHaveLength(1);
    }
    const raw = fs.readFileSync(path.join(root, 'data', 'meta-publications.json'), 'utf8');
    expect(raw).not.toContain(TOKENS.INSTAGRAM_ACCESS_TOKEN);
    expect(readState(root).posts['2026-11-22-a']?.instagram).toMatchObject({status: 'failed', attempts: MAX_ATTEMPTS});
    const callsBefore = g.calls.length;
    const last = await runDue({root, env, nowFn: () => SLOT_MS + 10_000, fetchFn: g.fetchFn, sleep: async () => {}, log: () => {}});
    expect(last.failed).toEqual([]);
    expect(g.calls.length).toBe(callsBefore);
  });

  it('sans jeton Threads, publie seulement Instagram', async () => {
    const root = makeRoot();
    const g = fakeGraph(igRoutes());
    const res = await runDue({root, env: {INSTAGRAM_ACCESS_TOKEN: 'IG'}, nowFn: () => SLOT_MS + 1000, fetchFn: g.fetchFn, sleep: async () => {}, log: () => {}});
    expect(res.published.map((p) => p.network)).toEqual(['instagram']);
  });

  it("attend l'heure du créneau quand le workflow démarre un peu avant", async () => {
    const root = makeRoot();
    const g = fakeGraph(igRoutes());
    let now = SLOT_MS - 5 * 60_000;
    const waits: number[] = [];
    const res = await runDue({
      root,
      env: {INSTAGRAM_ACCESS_TOKEN: 'IG'},
      waitMinutes: 25,
      nowFn: () => now,
      fetchFn: g.fetchFn,
      sleep: async (ms) => {
        waits.push(ms);
        now += ms;
      },
      log: () => {},
    });
    expect(waits[0]).toBe(5 * 60_000 + 2_000);
    expect(res.published).toHaveLength(1);
  });

  it("n'attend pas un créneau trop lointain, et la simulation ne touche à rien", async () => {
    const root = makeRoot();
    const g = fakeGraph(igRoutes());
    const early = await runDue({root, env: {INSTAGRAM_ACCESS_TOKEN: 'IG'}, waitMinutes: 25, nowFn: () => SLOT_MS - 3 * 3_600_000, fetchFn: g.fetchFn, sleep: async () => {}, log: () => {}});
    expect(early.published).toEqual([]);
    const dry = await runDue({root, env: TOKENS, dryRun: true, nowFn: () => SLOT_MS + 1000, fetchFn: g.fetchFn, sleep: async () => {}, log: () => {}});
    expect(dry.planned.map((p) => p.network)).toEqual(['instagram', 'threads']);
    expect(g.calls).toHaveLength(0);
    expect(fs.existsSync(path.join(root, 'data', 'meta-publications.json'))).toBe(false);
  });
});

describe('verifyTokens', () => {
  it('lit le compte de chaque jeton sans rien publier', async () => {
    const g = fakeGraph({'GET /me': {user_id: '111', username: '12eu125', account_type: 'MEDIA_CREATOR'}});
    const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).startsWith('https://graph.threads.com')) return new Response(JSON.stringify({id: '222', username: 'thr'}), {status: 200});
      return g.fetchFn(input, init);
    }) as typeof fetch;
    const res = await verifyTokens({root: '.', env: TOKENS, fetchFn, log: () => {}});
    expect(res).toEqual([
      {network: 'instagram', ok: true, detail: '@12eu125 (MEDIA_CREATOR)'},
      {network: 'threads', ok: true, detail: '@thr'},
    ]);
    const none = await verifyTokens({root: '.', env: {}, fetchFn, log: () => {}});
    expect(none.every((r) => !r.ok && r.detail.includes('absent'))).toBe(true);
  });
});

import {describe, expect, it} from 'vitest';
import {generate} from '../src/generate/generate.js';
import {runQc} from '../src/qc/qc.js';
import {checkSlot, nextSlot, schedule, autoSchedule, cancel} from '../src/publish/scheduler.js';
import {applyOutcome, runDue, retry, bridgePlan} from '../src/publish/runner.js';
import {approve, reject} from '../src/review.js';
import {getAccount, updateAccount} from '../src/core/accounts.js';
import {zonedInstant, zonedParts, addDays} from '../src/core/util.js';
import {AiRouter} from '../src/ai/router.js';
import {tmpDb} from './helpers.js';

async function approvedSlideshows(n: number, accountId = 'tiktok-12eure21') {
  const t = tmpDb();
  const r = await generate(t.db, t.cfg, {accountId, quantity: n, seed: 'pub'}, new AiRouter(t.db, t.cfg, {}));
  for (const id of r.slideshowIds) {
    // Text-only QC (no render in unit tests), then mark as approved like the review step does after a full QC.
    const q = runQc(t.db, t.cfg, id);
    expect(q.errors).toEqual([]);
    t.db.run("UPDATE slideshows SET status = 'approved' WHERE id = ?", id);
  }
  return {...t, ids: r.slideshowIds};
}

const tomorrow = (hhmm: string) => zonedInstant(addDays(zonedParts(new Date()).dateKey, 1), hhmm);

describe('calendrier et limites par compte', () => {
  it('respecte la plage horaire, les créneaux vidéo réservés et l’écart minimum', async () => {
    const {db, cfg, ids} = await approvedSlideshows(3);
    const acc = getAccount(db, 'tiktok-12eure21');
    expect(checkSlot(db, cfg, acc, tomorrow('06:00')).ok).toBe(false);
    expect(checkSlot(db, cfg, acc, tomorrow('10:30')).reason).toMatch(/vidéo/);
    expect(checkSlot(db, cfg, acc, tomorrow('12:30')).ok).toBe(true);
    schedule(db, cfg, ids[0], tomorrow('12:30'));
    expect(checkSlot(db, cfg, acc, tomorrow('13:30')).reason).toMatch(/minutes/);
    expect(() => schedule(db, cfg, ids[1], tomorrow('13:30'))).toThrow(/Créneau refusé/);
  });
  it('ne dépasse jamais le plafond quotidien ni hebdomadaire', async () => {
    const {db, cfg, ids} = await approvedSlideshows(12);
    const done = autoSchedule(db, cfg, {accountId: 'tiktok-12eure21', horizonDays: 3});
    const perDay = new Map<string, number>();
    for (const d of done) perDay.set(d.at.slice(0, 10), (perDay.get(d.at.slice(0, 10)) ?? 0) + 1);
    for (const n of perDay.values()) expect(n).toBeLessThanOrEqual(2);
    expect(done.length).toBeLessThanOrEqual(10);
    expect(ids.length).toBe(12);
  });
  it('refuse de programmer un carrousel non validé', async () => {
    const t = tmpDb();
    const r = await generate(t.db, t.cfg, {accountId: 'instagram-12eu125', quantity: 1, seed: 'nv'}, new AiRouter(t.db, t.cfg, {}));
    expect(() => schedule(t.db, t.cfg, r.slideshowIds[0])).toThrow(/approuvé/);
  });
  it('trouve un prochain créneau libre', async () => {
    const {db, cfg} = await approvedSlideshows(1);
    const at = nextSlot(db, cfg, getAccount(db, 'tiktok-12eure21'));
    expect(at).not.toBeNull();
    expect(at!.getTime()).toBeGreaterThan(Date.now());
  });
});

describe('validation humaine', () => {
  it('exige un contrôle qualité réussi', async () => {
    const t = tmpDb();
    const r = await generate(t.db, t.cfg, {accountId: 'instagram-12eu125', quantity: 1, seed: 'v'}, new AiRouter(t.db, t.cfg, {}));
    expect(() => approve(t.db, r.slideshowIds[0], 'test')).toThrow(/contrôle qualité/);
    runQc(t.db, t.cfg, r.slideshowIds[0]);
    t.db.run("UPDATE slideshows SET status = 'awaiting_approval' WHERE id = ?", r.slideshowIds[0]);
    expect(approve(t.db, r.slideshowIds[0], 'test').status).toBe('approved');
    expect(() => reject(t.db, 'inconnu', 'x')).toThrow();
  });
});

describe('file de publication', () => {
  it('prépare un paquet manuel quand la publication automatique est coupée', async () => {
    const {db, cfg, ids} = await approvedSlideshows(1);
    const s = schedule(db, cfg, ids[0], tomorrow('12:30'));
    const dry = await runDue(db, cfg, {now: new Date(tomorrow('12:30').getTime() + 60_000), dryRun: true});
    expect(dry.considered).toBe(1);
    expect(dry.skipped[0].reason).toMatch(/manuelle|simulation/);
    expect(db.get<{status: string}>('SELECT status FROM schedule WHERE id = ?', s.id)!.status).toBe('planned');
  });
  it('reporte sur limite, retente sur erreur passagère, abandonne sur refus définitif', async () => {
    const {db, cfg, ids} = await approvedSlideshows(3);
    const rows = ids.map((id, i) => schedule(db, cfg, id, tomorrow(['12:30', '17:30'][i] ?? '12:30') > new Date() && i < 2 ? tomorrow(['12:30', '17:30'][i]) : zonedInstant(addDays(zonedParts(new Date()).dateKey, 2), '12:30')));
    const row = (id: string) => db.get('SELECT * FROM schedule WHERE id = ?', id)!;
    applyOutcome(db, row(rows[0].id), {kind: 'deferred', until: new Date(Date.now() + 3_600_000), reason: 'limite'});
    expect(row(rows[0].id).status).toBe('deferred');
    expect(() => retry(db, rows[0].id)).toThrow(/aucun contournement/);
    applyOutcome(db, {...row(rows[1].id), attempts: 0}, {kind: 'retry', reason: 'HTTP 503'});
    expect(row(rows[1].id).status).toBe('planned');
    applyOutcome(db, row(rows[2].id), {kind: 'failed', reason: 'HTTP 400'});
    expect(row(rows[2].id).status).toBe('failed');
    retry(db, rows[2].id);
    expect(row(rows[2].id).status).toBe('planned');
    cancel(db, rows[2].id);
    expect(row(rows[2].id).status).toBe('cancelled');
  });
  it('prépare les appels Zernio (posts_create) pour une session Claude', async () => {
    const {db, cfg, ids} = await approvedSlideshows(1);
    updateAccount(db, 'tiktok-12eure21', {});
    schedule(db, cfg, ids[0], tomorrow('12:30'));
    const plan = bridgePlan(db, cfg, 48);
    expect(plan[0].zernioPostsCreate).toMatchObject({platforms: [{platform: 'tiktok', accountId: '6b0162fe81f9f8a5d9dffeb0'}], tiktok_settings: {media_type: 'photo', commercialContentType: 'brand_content', express_consent_given: true}});
    expect(plan[0].title.length).toBeLessThanOrEqual(90);
    expect(plan[0].mediaReady).toBe(false);
  });
});

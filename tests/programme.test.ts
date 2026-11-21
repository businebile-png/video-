import {describe, expect, it} from 'vitest';
import {loadConfig, loadEditorial} from '../src/core/config.js';
import {readValidated} from '../src/core/fsx.js';
import {similarity} from '../src/core/text.js';
import {PROGRAMME_CONFIG, ProgrammeConfigSchema, buildProgramme, programmeEntry, programmeProblems, programmeSlot} from '../src/editorial/programme.js';
import {loadFacts} from '../src/facts/facts.js';

async function setup() {
  const config = await loadConfig();
  const editorial = await loadEditorial();
  const cfg = await readValidated(PROGRAMME_CONFIG, ProgrammeConfigSchema);
  return {config, editorial, cfg};
}

describe('programme du mois', () => {
  it('ne cite que des faits et des catégories qui existent', async () => {
    const {editorial, cfg} = await setup();
    const facts = new Set((await loadFacts()).facts.map((f) => f.id));
    expect(programmeProblems(cfg, editorial, facts)).toEqual([]);
  });

  it('donne deux vidéos par jour, à 10:00 et 20:00, les quatre formats sur deux jours, dans la durée de chaque catégorie', async () => {
    const {config, editorial, cfg} = await setup();
    const slots = buildProgramme(cfg, editorial, {from: '2026-11-21', days: 30, timezone: 'Europe/Paris', times: config.platforms.tiktok.postTimes});
    expect(slots).toHaveLength(60);
    expect(new Set(slots.map((s) => s.date)).size).toBe(30);
    slots.forEach((s, i) => expect(s.time).toBe(i % 2 === 0 ? '10:00' : '20:00'));
    // Deux vidéos par jour (demande du 21/11/2026) : les quatre formats tournent sur deux jours, jamais deux fois de suite.
    expect(slots.slice(0, 4).map((s) => s.family)).toEqual(['conseil', 'court', 'formule', 'tuto']);
    expect(new Set(slots.slice(0, 4).map((s) => s.family)).size).toBe(4);
    for (let i = 1; i < slots.length; i++) {
      expect(slots[i]!.family).not.toBe(slots[i - 1]!.family);
      expect(slots[i]!.theme, slots[i]!.label).not.toBe(slots[i - 1]!.theme);
    }
    for (const s of slots) {
      const cat = editorial.categories.find((c) => c.id === s.category)!;
      expect(s.durationSec[0]).toBeGreaterThanOrEqual(cat.durationSec[0]);
      expect(s.durationSec[1]).toBeLessThanOrEqual(cat.durationSec[1]);
    }
  });

  it('date chaque créneau à l\'heure de Paris et garde les mêmes sujets quand on régénère plus tard', async () => {
    const {editorial, cfg} = await setup();
    const a = buildProgramme(cfg, editorial, {from: '2026-11-21', days: 10, timezone: 'Europe/Paris'});
    const b = buildProgramme(cfg, editorial, {from: '2026-11-25', days: 3, timezone: 'Europe/Paris'});
    const evening = programmeEntry({slots: a}, '2026-11-22T19:00:00Z')!;
    expect(evening.iso).toBe('2026-11-22T20:00:00+01:00');
    expect(evening.label).toBe('dimanche 22 novembre à 20:00');
    for (const s of b) expect(programmeEntry({slots: a}, s.iso)).toEqual(s);
  });

  it('ne propose pas deux pistes trop proches à moins de 10 jours, ni de promesse de revenus ou de commission', async () => {
    const {editorial, cfg} = await setup();
    const slots = buildProgramme(cfg, editorial, {from: '2026-11-21', days: 30, timezone: 'Europe/Paris'});
    const max = editorial.rules.angleSimilarityMax;
    const dayMs = 86_400_000;
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length && Date.parse(slots[j]!.iso) - Date.parse(slots[i]!.iso) < 10 * dayMs; j++) expect(similarity(slots[i]!.angle, slots[j]!.angle), `${slots[i]!.label} / ${slots[j]!.label}`).toBeLessThanOrEqual(max);
    }
    for (const s of slots) expect(`${s.angle} ${s.formule}`).not.toMatch(/commission|revenu|gagner de l.argent|passif|pendant que tu dors|riche|fortune/i);
  });

  it('donne le sujet d\'un créneau, avec le besoin choisi dans le tableau du panneau', async () => {
    const {editorial, cfg} = await setup();
    const times = ['20:00'];
    const tz = 'Europe/Paris';
    const listed = buildProgramme(cfg, editorial, {from: '2026-11-24', days: 1, timezone: tz, times})[0];
    expect(programmeSlot(cfg, editorial, {iso: '2026-11-24T20:00:00+01:00', timezone: tz, times})).toEqual(listed);
    const chosen = programmeSlot(cfg, editorial, {iso: '2026-11-24T19:00:00Z', timezone: tz, theme: 'webinaire', times})!;
    expect([chosen.theme, chosen.family, chosen.time]).toEqual(['webinaire', 'tuto', '20:00']);
    expect(chosen.angle).toMatch(/webinaire/i);
    expect(() => programmeSlot(cfg, editorial, {iso: '2026-11-24T20:00:00+01:00', timezone: tz, theme: 'inconnu', times})).toThrow(/besoin inconnu/);
    expect(programmeSlot(cfg, editorial, {iso: '2026-11-24T10:00:00+01:00', timezone: tz, times})).toBeNull();
  });

  it('refuse une rotation dont la phase sort du cycle', async () => {
    const {editorial, cfg} = await setup();
    const facts = new Set((await loadFacts()).facts.map((f) => f.id));
    const broken = {...cfg, families: cfg.families.map((f, i) => (i === 0 ? {...f, phase: 7} : f))};
    expect(programmeProblems(broken, editorial, facts).join(' ')).toMatch(/hors du cycle/);
  });
});

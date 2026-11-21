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

  it('donne 3 créneaux par jour, 3 besoins différents chaque jour, dans la durée de chaque catégorie', async () => {
    const {config, editorial, cfg} = await setup();
    const slots = buildProgramme(cfg, editorial, {from: '2026-11-21', days: 30, timezone: 'Europe/Paris', times: config.platforms.tiktok.postTimes});
    expect(slots).toHaveLength(90);
    const byDay = new Map<string, typeof slots>();
    for (const s of slots) byDay.set(s.date, [...(byDay.get(s.date) ?? []), s]);
    expect(byDay.size).toBe(30);
    for (const day of byDay.values()) {
      expect(day.map((s) => s.time)).toEqual(['00:00', '10:00', '20:00']);
      expect(new Set(day.map((s) => s.theme)).size).toBe(3);
    }
    // 00:00 alternates the short format and the « erreur ou conseil » format, day after day.
    const midnights = slots.filter((s) => s.time === '00:00').map((s) => s.family);
    expect(midnights.slice(0, 4)).toEqual(['conseil', 'court', 'conseil', 'court']);
    for (const s of slots) {
      const cat = editorial.categories.find((c) => c.id === s.category)!;
      expect(s.durationSec[0]).toBeGreaterThanOrEqual(cat.durationSec[0]);
      expect(s.durationSec[1]).toBeLessThanOrEqual(cat.durationSec[1]);
    }
  });

  it('place minuit en tête de sa journée et garde les mêmes sujets quand on régénère plus tard', async () => {
    const {editorial, cfg} = await setup();
    const a = buildProgramme(cfg, editorial, {from: '2026-11-21', days: 10, timezone: 'Europe/Paris'});
    const b = buildProgramme(cfg, editorial, {from: '2026-11-25', days: 3, timezone: 'Europe/Paris'});
    const midnight = programmeEntry({slots: a}, '2026-11-21T23:00:00Z')!;
    expect(midnight.iso).toBe('2026-11-22T00:00:00+01:00');
    expect(midnight.label).toBe('dimanche 22 novembre à 00:00');
    for (const s of b) expect(programmeEntry({slots: a}, s.iso)).toEqual(s);
  });

  it('ne propose pas deux pistes trop proches à moins de 8 jours, ni de promesse de revenus ou de commission', async () => {
    const {editorial, cfg} = await setup();
    const slots = buildProgramme(cfg, editorial, {from: '2026-11-21', days: 30, timezone: 'Europe/Paris'});
    const max = editorial.rules.angleSimilarityMax;
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < Math.min(slots.length, i + 32); j++) expect(similarity(slots[i]!.angle, slots[j]!.angle), `${slots[i]!.label} / ${slots[j]!.label}`).toBeLessThanOrEqual(max);
    }
    for (const s of slots) expect(`${s.angle} ${s.formule}`).not.toMatch(/commission|revenu|gagner de l.argent|passif|pendant que tu dors|riche|fortune/i);
  });

  it('donne le sujet d\'un créneau, avec le besoin choisi dans le tableau du panneau', async () => {
    const {editorial, cfg} = await setup();
    const times = ['00:00', '10:00', '20:00'];
    const tz = 'Europe/Paris';
    const listed = buildProgramme(cfg, editorial, {from: '2026-11-23', days: 1, timezone: tz, times}).find((s) => s.time === '10:00');
    expect(programmeSlot(cfg, editorial, {iso: '2026-11-23T10:00:00+01:00', timezone: tz, times})).toEqual(listed);
    const chosen = programmeSlot(cfg, editorial, {iso: '2026-11-23T09:00:00Z', timezone: tz, theme: 'webinaire', times})!;
    expect([chosen.theme, chosen.family, chosen.time]).toEqual(['webinaire', 'tuto', '10:00']);
    expect(chosen.angle).toMatch(/webinaire/i);
    expect(() => programmeSlot(cfg, editorial, {iso: '2026-11-23T10:00:00+01:00', timezone: tz, theme: 'inconnu', times})).toThrow(/besoin inconnu/);
    expect(programmeSlot(cfg, editorial, {iso: '2026-11-23T15:00:00+01:00', timezone: tz, times})).toBeNull();
  });
});

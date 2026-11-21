import {describe, expect, it} from 'vitest';
import {loadEditorial} from '../src/core/config.js';
import {loadFacts} from '../src/facts/facts.js';
import {buildProgramme, PROGRAMME_CONFIG, ProgrammeConfigSchema} from '../src/editorial/programme.js';
import {readValidated} from '../src/core/fsx.js';
import {loadSerie, producedNumbers, serieChoice, serieEntryAt, serieProblems, withSerie} from '../src/editorial/serie.js';

const serie = loadSerie()!;

describe('série de 60 vidéos', () => {
  it('a 60 scripts valides, deux par jour à 10:00 et 20:00 du 23/11 au 22/12, avec des faits vérifiés', async () => {
    const editorial = await loadEditorial();
    const facts = (await loadFacts()).facts;
    expect(serieProblems(serie, editorial, new Set(facts.map((f) => f.id)))).toEqual([]);
    expect(serie.entries.map((e) => e.n)).toEqual(Array.from({length: 60}, (_, i) => i + 1));
    expect(serie.entries[0]!.iso).toBe('2026-11-23T10:00:00+01:00');
    expect(serie.entries[59]!.iso).toBe('2026-12-22T20:00:00+01:00');
    serie.entries.forEach((e, i) => {
      expect(e.iso.slice(11, 16)).toBe(i % 2 === 0 ? '10:00' : '20:00');
      if (i > 0) expect(Date.parse(e.iso)).toBeGreaterThan(Date.parse(serie.entries[i - 1]!.iso));
    });
    const status = new Map(facts.map((f) => [f.id, f.status]));
    for (const e of serie.entries) for (const f of e.facts) expect(status.get(f), `${e.n} ${f}`).toBe('verified');
  });

  it('ne promet ni revenus ni commission et ne nomme aucun outil non vérifié', () => {
    for (const e of serie.entries) {
      const text = [e.title, e.hook.screen, e.hook.voice, ...e.lines.map((l) => l.voice), e.question ?? ''].join(' ');
      expect(text, `vidéo ${e.n}`).not.toMatch(/commission|revenus?\b|gagner de l.argent|passif|pendant que tu dors|riche|fortune|stripe|paypal/i);
    }
  });

  it('donne à une démo sans enregistrement la vidéo de relève, puis la démo au créneau de la relève', () => {
    const demo = serie.entries.find((e) => e.n === 6)!;
    const relief = serie.entries.find((e) => e.n === demo.demo!.fallback)!;
    expect(serieChoice(serie, '2026-11-23T09:00:00Z', new Set(), new Set()).entry?.n).toBe(1);
    // Sans enregistrement : la relève prend le créneau de la démo.
    expect(serieChoice(serie, demo.iso, new Set(), new Set()).entry?.n).toBe(relief.n);
    // Avec l'enregistrement : la démo garde son créneau.
    expect(serieChoice(serie, demo.iso, new Set(), new Set([demo.demo!.feature])).entry?.n).toBe(6);
    // Au créneau de la relève déjà sortie : la démo si l'enregistrement est arrivé, sinon le programme du mois.
    expect(serieChoice(serie, relief.iso, new Set([relief.n]), new Set([demo.demo!.feature])).entry?.n).toBe(6);
    expect(serieChoice(serie, relief.iso, new Set([relief.n]), new Set()).entry).toBeNull();
    expect(serieChoice(serie, '2026-11-22T20:00:00+01:00', new Set(), new Set()).entry).toBeNull();
    expect(producedNumbers([{serie: 3, status: 'rendered'}, {serie: 4, status: 'failed'}, {serie: 5, status: 'created'}, {serie: null, status: 'published'}])).toEqual(new Set([3]));
  });

  it('remplace le programme sur ses créneaux et le garde ailleurs', async () => {
    const editorial = await loadEditorial();
    const cfg = await readValidated(PROGRAMME_CONFIG, ProgrammeConfigSchema);
    const base = buildProgramme(cfg, editorial, {from: '2026-11-21', days: 40, timezone: 'Europe/Paris', times: ['10:00', '20:00']});
    const merged = withSerie(base, serie, editorial, 'Europe/Paris');
    const inSerie = merged.filter((s) => s.family === 'serie');
    expect(inSerie).toHaveLength(60);
    expect(serieEntryAt(serie, inSerie[0]!.iso)?.n).toBe(1);
    expect(inSerie[0]!.label).toBe('lundi 23 novembre à 10:00');
    expect(inSerie[0]!.themeLabel).toMatch(/^Vidéo 1\/60 : /);
    // Avant et après la série, le programme du mois reste ; jamais deux sujets au même créneau.
    expect(merged.filter((s) => s.date === '2026-11-22')).toHaveLength(2);
    expect(merged.filter((s) => s.date === '2026-12-23').every((s) => s.family !== 'serie')).toBe(true);
    expect(new Set(merged.map((s) => Date.parse(s.iso))).size).toBe(merged.length);
  });
});

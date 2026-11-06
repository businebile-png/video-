import {describe, expect, it} from 'vitest';
import {extractNumbers, normalize, similarity, wordErrorRate} from '../src/core/text.js';
import {formatWithOffset, zonedInstant} from '../src/core/time.js';
import {affiliateLinkProblems} from '../src/core/config.js';
import {alignmentToWords, displayWords, mapToDisplay, prepareSpeech, spokenForm} from '../src/voice/speech.js';
import {normalizeDocs} from '../src/panel/panel.js';
import {cropFilter} from '../src/edit/edit-step.js';
import {nextSlots, postText} from '../src/publish/publish.js';
import {voiceMetrics, scoreVoice} from '../src/voice/voice-step.js';
import {loadConfig} from '../src/core/config.js';
import {sampleScript} from './fixtures.js';

describe('texte', () => {
  it('normalise accents, apostrophes et ponctuation', () => {
    expect(normalize('Tu n’as « jamais » testé ? Systeme.io')).toBe('tu n as jamais teste systeme io');
  });
  it('mesure la proximité de deux accroches', () => {
    expect(similarity('Tu utilises cinq outils pour vendre ?', 'Tu utilises 5 outils pour vendre ?')).toBeGreaterThan(0.6);
    expect(similarity('Tu utilises cinq outils pour vendre ?', 'Ta formation dort dans ton ordinateur')).toBeLessThan(0.3);
  });
  it('calcule le taux d’erreur de mots', () => {
    const r = wordErrorRate('tu crées ta page en deux minutes', 'tu crées ta page en 2 minutes');
    expect(r.wer).toBeCloseTo(1 / 7, 3);
    expect(r.substitutions).toEqual([['deux', '2']]);
  });
  it('extrait les nombres sous une forme comparable', () => {
    expect(extractNumbers('jusqu’à 2 000 contacts pour 17 $')).toEqual(['2000', '17']);
  });
});

describe('horaires de publication', () => {
  it('convertit une heure de Paris en instant exact (hiver et été)', () => {
    expect(formatWithOffset(zonedInstant('2026-11-06', '19:07', 'Europe/Paris'), 'Europe/Paris')).toBe('2026-11-06T19:07:00+01:00');
    expect(formatWithOffset(zonedInstant('2026-07-01', '12:23', 'Europe/Paris'), 'Europe/Paris')).toBe('2026-07-01T12:23:00+02:00');
  });
  it('propose les prochains créneaux en respectant le délai minimum', async () => {
    const config = await loadConfig();
    // Fixed schedule: the test must not depend on the hours chosen in the panel.
    config.platforms.tiktok = {...config.platforms.tiktok, enabled: true, postTimes: ['19:07']};
    config.platforms.instagram = {...config.platforms.instagram, enabled: false};
    config.publish.leadTimeMinutes = 90;
    const slots = nextSlots(config, new Date('2026-11-06T17:00:00Z'));
    expect(slots[0]!.network).toBe('tiktok');
    expect(slots[0]!.iso).toBe('2026-11-07T19:07:00+01:00');
  });
});

describe('lien affilié', () => {
  it('refuse les liens sans « sa » ou avec « www »', () => {
    expect(affiliateLinkProblems('')).toHaveLength(1);
    expect(affiliateLinkProblems('https://www.systeme.io/?sa=sa0012345')).toEqual(expect.arrayContaining([expect.stringContaining('www')]));
    expect(affiliateLinkProblems('https://systeme.io/fr')).toEqual(expect.arrayContaining([expect.stringContaining('« sa »')]));
    expect(affiliateLinkProblems('https://systeme.io/?sa=sa0012345678')).toEqual([]);
  });
});

describe('voix et sous-titres', () => {
  it('colle la ponctuation française au mot précédent', () => {
    expect(displayWords('Tu utilises cinq outils ?')).toEqual(['Tu', 'utilises', 'cinq', 'outils ?']);
  });
  it('prononce les marques et les montants correctement', () => {
    const pron = {'Systeme.io': 'Système I O'};
    expect(spokenForm('Systeme.io ?', pron)).toEqual(['Système', 'I', 'O?']);
    expect(spokenForm('17 $', pron)).toEqual(['17', 'dollars']);
    expect(spokenForm('60%', pron)).toEqual(['60', 'pour', 'cent']);
  });
  it('recolle le minutage de la synthèse sur les mots affichés', () => {
    const script = sampleScript();
    const speech = prepareSpeech(script, {'Systeme.io': 'Système I O'}, '\n\n');
    // Fake character alignment: every spoken word lasts 0.3 s.
    const chars: string[] = [];
    const starts: number[] = [];
    const ends: number[] = [];
    let t = 0;
    for (const ch of speech.text) {
      chars.push(ch);
      starts.push(t);
      ends.push(t + 0.05);
      t += 0.05;
    }
    const spoken = alignmentToWords({characters: chars, character_start_times_seconds: starts, character_end_times_seconds: ends});
    const words = mapToDisplay(speech.tokens, spoken);
    expect(words).toHaveLength(speech.tokens.length);
    const brand = words.find((w) => w.text.startsWith('Systeme.io'))!;
    expect(brand.end - brand.start).toBeGreaterThan(0.3);
    for (let i = 1; i < words.length; i++) expect(words[i]!.start).toBeGreaterThanOrEqual(words[i - 1]!.start);
  });
  it('note la voix à partir des mesures uniquement', async () => {
    const config = await loadConfig();
    const words = Array.from({length: 60}, (_, i) => ({text: `mot${i}`, start: 0.05 + i * 0.36, end: 0.05 + i * 0.36 + 0.3, sceneId: 's1', index: i}));
    const m = voiceMetrics(words, 22, config.voice.targets.maxInternalPauseSec);
    expect(m.wpm).toBeGreaterThan(150);
    const good = scoreVoice(m, 0.02, true, config.voice.targets);
    expect(good.score).toBe(15);
    expect(scoreVoice(m, 0.02, false, config.voice.targets).score).toBe(0);
  });
});

describe('recadrage vertical', () => {
  it('recadre au centre en 9:16', () => {
    expect(cropFilter(3840, 2160)).toBe('crop=1214:2160:1313:0');
    expect(cropFilter(1080, 1920)).toBe('crop=1080:1920:0:0');
  });
});

describe('légendes de publication', () => {
  it('commence par la mention publicitaire et contient le lien en bio', async () => {
    const config = await loadConfig();
    const text = postText(sampleScript(), 'tiktok', config);
    expect(text.startsWith('Publicité')).toBe(true);
    expect(text).toMatch(/bio/i);
  });
});

describe('import du panneau', () => {
  it('accepte plusieurs formes de listes de documents', () => {
    expect(normalizeDocs([{id: 'a', data: {x: 1}}])).toEqual([{id: 'a', data: {x: 1}}]);
    expect(normalizeDocs({documents: [{path: 'videos/2026-11-06-a', data: {runId: '2026-11-06-a'}}]})[0]!.id).toBe('2026-11-06-a');
    expect(normalizeDocs([{runId: 'r1', status: 'refusee'}])[0]!.id).toBe('r1');
  });
});

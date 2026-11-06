import {describe, expect, it} from 'vitest';
import {displayWords, frenchNumber, heardForm, numericValue, pronunciationCheck, soundKey, spokenForm, type Token} from '../src/voice/speech.js';

const PRON = {'Systeme.io': 'Système I O', 'e-mails': 'i-mèles'};

function tokens(text: string): Token[] {
  return displayWords(text).map((w, i) => ({display: w, spoken: spokenForm(w, PRON), sceneId: 's1', index: i}));
}

describe('pronunciation check', () => {
  it('accepts digits, brand spelling, respellings and silent endings', () => {
    const t = tokens('Tu jongles entre cinq outils pour vendre en ligne ? Avec Systeme.io, tes e-mails sont réunis au même endroit.');
    const res = pronunciationCheck(t, 'Tu jongles entre 5 outils pour vendre en ligne. Avec système IO, tes emails sont réunies au même endroit.');
    expect(res.wer).toBe(0);
  });

  it('flags a word heard differently', () => {
    const t = tokens('Tu veux vendre en ligne ?');
    const res = pronunciationCheck(t, 'Tu veux vendre en lit.');
    expect(res.substitutions).toEqual([['ligne', 'lit']]);
    expect(res.wer).toBeCloseTo(1 / 5);
  });

  it('flags a missing word', () => {
    const t = tokens('Le lien est dans ma bio.');
    const res = pronunciationCheck(t, 'Le lien est dans bio.');
    expect(res.deletions).toEqual(['ma']);
  });

  it('normalises homophones and numbers', () => {
    expect(heardForm('réunies')).toBe(heardForm('réunis'));
    expect(heardForm('cinq')).toBe('5');
    expect(heardForm('ligne')).not.toBe(heardForm('lit'));
  });
});

describe('numbers and homophones', () => {
  it('reads French numbers', () => {
    expect(frenchNumber(['deux', 'mille'])).toBe(2000);
    expect(frenchNumber(['cent', 'soixante', 'dix'])).toBe(170);
    expect(frenchNumber(['quarante', 'sept'])).toBe(47);
    expect(frenchNumber(['quatre', 'vingt', 'dix'])).toBe(90);
    expect(frenchNumber(['vingt', 'et', 'un'])).toBe(21);
    expect(frenchNumber(['cinq', 'mille'])).toBe(5000);
    expect(frenchNumber(['tunnels'])).toBeNull();
    expect(numericValue(['2', '000'])).toBe('2000');
  });

  it('treats homophones across words as the same sound', () => {
    expect(soundKey(['c', 'est', 'vite'])).toBe(soundKey(['s', 'evite']));
    expect(soundKey(['dix', 'tunnels'])).toBe(soundKey(['dit', 'tunnel']));
    expect(soundKey(['ligne'])).not.toBe(soundKey(['lit']));
    expect(soundKey(['webinaires'])).not.toBe(soundKey(['webinets']));
  });

  it('only flags real mispronunciations in a real transcript', () => {
    const t = tokens(
      "Trois tunnels de vente, une seule règle d'automatisation et deux mille contacts : quand ton activité grandit, c'est vite atteint. " +
        'La formule Startup, c’est 17 € par mois. Tu passes à dix tunnels de vente et cinq mille contacts. La formule Webinaire inclut les webinaires automatiques.',
    );
    const heard =
      "Trois tunnels de vente, une seule règle d'automatisation et 2000 contacts quand ton activité grandit s'évite atteint. " +
      "La formule startup, c'est 17 euros par mois. Tu passes à dit tunnels de vente et 5000 contacts. La formule webinets inclut les webinets automatiques.";
    const res = pronunciationCheck(t, heard);
    expect(res.deletions).toEqual([]);
    expect(res.substitutions).toEqual([
      ['Webinaire', 'webinets'],
      ['webinaires', 'webinets'],
    ]);
  });
});

describe('homophones courts', () => {
  it('treats « ta » and « t’as » as the same sound', () => {
    expect(soundKey(['ta'])).toBe(soundKey(['t', 'as']));
  });
});

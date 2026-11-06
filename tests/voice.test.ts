import {describe, expect, it} from 'vitest';
import {displayWords, heardForm, pronunciationCheck, spokenForm, type Token} from '../src/voice/speech.js';

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

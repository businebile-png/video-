import {describe, expect, it} from 'vitest';
import {googleRequest, isChirp} from '../src/voice/google.js';
import {creditLineFor} from '../src/publish/publish.js';
import type {StudioConfig} from '../src/schemas/config.js';

const opts = {languageCode: 'fr-FR', speakingRate: 1.05, sceneBreakMs: 260, sampleRateHertz: 48000};

describe('voix Google', () => {
  it('envoie du texte simple aux voix Chirp 3 HD (sans SSML), une scène par paragraphe', () => {
    const req = googleRequest(['Tu prends Startup ?', 'Il n’en inclut aucun.'], 'fr-FR-Chirp3-HD-Leda', opts);
    expect(isChirp('fr-FR-Chirp3-HD-Leda')).toBe(true);
    expect(req.body.input).toEqual({text: 'Tu prends Startup ?\n\nIl n’en inclut aucun.'});
    expect(req.body.voice).toEqual({languageCode: 'fr-FR', name: 'fr-FR-Chirp3-HD-Leda'});
    expect(req.body.audioConfig).toEqual({audioEncoding: 'LINEAR16', sampleRateHertz: 48000, speakingRate: 1.05});
    expect(req.characters).toBe('Tu prends Startup ?\n\nIl n’en inclut aucun.'.length);
  });

  it('sépare les scènes par une pause SSML pour les autres voix, caractères spéciaux échappés et comptés', () => {
    const req = googleRequest(['Prix : 17 € & plus', 'Fin'], 'fr-FR-Neural2-F', {...opts, speakingRate: 1});
    const ssml = '<speak>Prix : 17 € &amp; plus<break time="260ms"/>Fin</speak>';
    expect(req.body.input).toEqual({ssml});
    // Vitesse normale : rien d'envoyé ; Google compte aussi les balises.
    expect(req.body.audioConfig).toEqual({audioEncoding: 'LINEAR16', sampleRateHertz: 48000});
    expect(req.characters).toBe(ssml.length);
    expect((googleRequest(['x'], 'fr-FR-Neural2-F', {...opts, speakingRate: 3}).body.audioConfig as {speakingRate: number}).speakingRate).toBe(1.25);
  });

  it('crédite dans la légende la voix qui a vraiment parlé', () => {
    const config = {
      voice: {
        creditLine: 'Voix de synthèse IA, d’après « SIWIS »',
        approvedVoices: [
          {id: 'fr-FR-Chirp3-HD-Leda', name: 'Google', creditLine: 'Voix de synthèse IA (Google).'},
          {id: 'claire', name: 'Claire'},
        ],
      },
    } as unknown as StudioConfig;
    expect(creditLineFor('fr-FR-Chirp3-HD-Leda', config)).toBe('Voix de synthèse IA (Google).');
    expect(creditLineFor('claire', config)).toBe('Voix de synthèse IA, d’après « SIWIS »');
    expect(creditLineFor(null, config)).toBe('Voix de synthèse IA, d’après « SIWIS »');
  });
});

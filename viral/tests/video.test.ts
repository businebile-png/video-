import {describe, expect, it} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {buildCaptions, buildTimeline} from '../src/video/timeline.js';
import {splitSentences, alignWords, frenchNumber, spokenTokens, voiceChain} from '../src/video/voice.js';
import {videoWording, withoutLinkMention, scriptFromDraft, spokenHook, speakable} from '../src/video/script.js';
import {composeMusic, musicCandidates, musicGrid, MUSIC_CATEGORIES} from '../src/video/music.js';
import {placeSfx, sfxFile} from '../src/video/sfx.js';
import {readWav, writeWav, envelope} from '../src/video/wav.js';
import {checkTrack} from '../src/video/music-library.js';
import {formatDef, VIDEO_FORMATS, wordBudget} from '../src/video/formats.js';
import {mixAudio} from '../src/video/render.js';
import {moovBeforeMdat, frameHash, hamming} from '../src/video/qc.js';
import {planBatch} from '../src/video/factory.js';
import {composeBatch} from '../src/generate/composer.js';
import {getAccount} from '../src/core/accounts.js';
import {findForbidden} from '../src/qc/rules.js';
import {tmpDb} from './helpers.js';
import type {WordTiming} from '../src/video/types.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'viral-video-'));
const words = (text: string, start = 0, step = 0.3): WordTiming[] => text.split(' ').map((w, i) => ({text: w, start: start + i * step, end: start + i * step + step * 0.9}));

describe('sous-titres', () => {
  it('ne coupent jamais une ligne sur un petit mot ni à travers une coupe', () => {
    const caps = buildCaptions(words('Tu offres un guide utile en échange de ton adresse e-mail.'), [], 'tiktok');
    for (const c of caps.slice(0, -1)) expect(/^(un|en|de|ton|la|le)$/i.test(c.words[c.words.length - 1].text)).toBe(false);
    const cut = buildCaptions(words('un deux trois quatre cinq six'), [0.85], 'minimal');
    for (const c of cut) expect(c.words.every((w) => w.start < 0.85) || c.words.every((w) => w.start >= 0.8)).toBe(true);
  });
  it('respectent chaque style : mot par mot, TikTok, phrase entière', () => {
    const w = words('Elle démarre à l’inscription : c’est le déclencheur.');
    expect(buildCaptions(w, [], 'mot').every((c) => c.words.length === 1)).toBe(true);
    expect(buildCaptions(w, [], 'tiktok').every((c) => c.words.length <= 3)).toBe(true);
    expect(buildCaptions(w, [], 'phrase').length).toBeLessThanOrEqual(2);
    const all = buildCaptions(w, [], 'documentaire').flatMap((c) => c.words.map((x) => x.text));
    expect(all.join(' ')).toBe(w.map((x) => x.text).join(' '));
  });
});

describe('narration', () => {
  it('découpe en phrases sans casser la marque, les nombres ni les abréviations', () => {
    expect(splitSentences('Systeme.io réunit tout. Le plan coûte 17,5 € par mois, etc. Ensuite tu testes !')).toEqual(['Systeme.io réunit tout.', 'Le plan coûte 17,5 € par mois, etc. Ensuite tu testes !']);
    expect(splitSentences('Une phrase… Puis une autre ? Oui.')).toEqual(['Une phrase…', 'Puis une autre ?', 'Oui.']);
  });
  it('prononce les symboles et compte les mots dits', () => {
    expect(speakable('17 € /mois → 100 % «gratuit»')).toBe('17 euros par mois, 100 pour cent gratuit');
    expect(frenchNumber(2000)).toBe('deux mille');
    expect(frenchNumber(97)).toBe('quatre vingt dix sept');
    expect(spokenTokens('Systeme.io : 2 000 contacts')).toEqual(['deux', 'mille', 'contacts']);
  });
  it('cale chaque mot du script sur ce que la voix a dit, dans l’ordre', () => {
    const heard = [
      {text: 'Bonjour', start: 0.1, end: 0.5},
      {text: 'à', start: 0.55, end: 0.6},
      {text: 'tous', start: 0.62, end: 0.9},
      {text: 'Suite', start: 1.4, end: 1.8},
    ];
    const out = alignWords(['Bonjour à tous.', 'Suite.'], [{start: 0, end: 1}, {start: 1.3, end: 1.9}], heard);
    expect(out.map((w) => w.text)).toEqual(['Bonjour', 'à', 'tous.', 'Suite.']);
    for (let i = 1; i < out.length; i++) expect(out[i].start).toBeGreaterThanOrEqual(out[i - 1].start);
    expect(out[3].start).toBeGreaterThanOrEqual(1.3);
  });
  it('choisit une voix de la bonne langue et du bon genre, voix locales gratuites d’abord', () => {
    expect(voiceChain({voice: 'auto', gender: 'male', language: 'fr-FR'})[0].gender).toBe('male');
    expect(voiceChain({voice: 'auto', gender: 'female', language: 'fr-FR'})[0].id).toBe('claire');
    const en = voiceChain({voice: 'auto', gender: 'female', language: 'en-GB'});
    expect(en[0].language).toBe('en-GB');
    expect(voiceChain({voice: 'auto', gender: 'female', language: 'fr-FR'}).some((v) => v.engine === 'elevenlabs' || v.engine === 'google')).toBe(false);
  });
});

describe('scripts vidéo', () => {
  it('remplacent le vocabulaire de carrousel et ne répètent pas le lien dans l’encadré produit', () => {
    expect(videoWording('Enregistre ce carrousel. Le pas-à-pas, slide par slide.')).toBe('Enregistre cette vidéo. Le pas-à-pas, point par point.');
    expect(withoutLinkMention('Systeme.io a un plan gratuit. Le lien est dans ma bio.')).toBe('Systeme.io a un plan gratuit.');
    expect(spokenHook('Pourquoi ta liste e-mail ne grandit pas : les trois erreurs qui bloquent tout').hook.split(' ').length).toBeLessThanOrEqual(11);
  });
  it('tiennent la structure de rétention et le budget de mots, sans formule interdite', () => {
    const {db, cfg} = tmpDb();
    const acc = getAccount(db, 'tiktok-12eure21');
    const [d] = composeBatch(db, cfg, acc, {accountId: acc.id, quantity: 1, seed: 'video'});
    expect(d).toBeDefined();
    const s = scriptFromDraft(d, {format: 'educatif', duration: 30, cta: 'Lien en bio', linkHint: 'bio', seed: 'x'});
    expect(s.scenes[0].role).toBe('hook');
    expect(s.scenes[s.scenes.length - 1].role).toBe('cta');
    expect(s.words.actual).toBeLessThanOrEqual(Math.round(wordBudget(30) * 1.2));
    const all = s.scenes.map((x) => x.narration).join(' ');
    expect(findForbidden(all)).toEqual([]);
    expect(/carrousel|slide/i.test(all)).toBe(false);
  });
  it('13 formats, chacun avec son modèle, sa musique, ses transitions et son style de sous-titres', () => {
    expect(Object.keys(VIDEO_FORMATS).length).toBe(13);
    for (const f of Object.values(VIDEO_FORMATS)) {
      expect(f.transitions.length).toBeGreaterThan(0);
      expect(MUSIC_CATEGORIES[f.music]).toBeDefined();
      expect(formatDef(f.id).template).toBeTruthy();
    }
  });
});

describe('musique et effets', () => {
  it('compose une musique originale déterministe, calée sur les coupes', () => {
    const dir = tmp();
    const a = composeMusic(path.join(dir, 'a.wav'), {mood: 'suspense', seconds: 6, seed: 3, cues: {drop: 1.5, cuts: [3], outro: 5}});
    composeMusic(path.join(dir, 'b.wav'), {mood: 'suspense', seconds: 6, seed: 3, cues: {drop: 1.5, cuts: [3], outro: 5}});
    expect(fs.readFileSync(path.join(dir, 'a.wav')).equals(fs.readFileSync(path.join(dir, 'b.wav')))).toBe(true);
    expect(a.beats.length).toBeGreaterThan(5);
    expect(musicGrid('suspense', 3, 6).bpm).toBe(a.bpm);
    const pcm = readWav(path.join(dir, 'a.wav'));
    expect(pcm.channels).toBe(2);
    expect(Math.max(...pcm.data.slice(0, 48000 * 2).map(Math.abs))).toBeLessThan(1);
  });
  it('choisit l’ambiance selon le sujet', () => {
    expect(musicCandidates('educatif', 'erreurs', 'Attention à cette erreur', 'chill')[0]).toBe('suspense');
    expect(musicCandidates('top5', 'liste', 'cinq outils', 'driving')).toContain('driving');
    expect(Object.keys(MUSIC_CATEGORIES)).toEqual(expect.arrayContaining(['cinematic', 'uplifting', 'mysterious', 'emotional', 'driving', 'corporate', 'documentary', 'suspense', 'chill']));
  });
  it('place les effets dans les pauses, espacés, adoucis quand ils touchent un mot', () => {
    const scenes = [0, 3, 6, 9].map((t, i) => ({start: t, end: t + 3, layout: i === 1 ? 'number' : 'title', role: i === 3 ? 'cta' : 'point', speechStart: t + 0.2, transition: 'cube' as const}));
    const cues = placeSfx({scenes, words: words('un deux trois quatre cinq six sept huit neuf dix', 0.2, 1), duration: 12, format: 'educatif', mood: 'suspense', settings: {enabled: true, volume: 1, ambience: true}});
    const timed = cues.filter((c) => !c.bed);
    for (let i = 1; i < timed.length; i++) if (timed[i].name !== 'riser-cine') expect(timed[i].at - timed[i - 1].at).toBeGreaterThanOrEqual(0.9);
    expect(cues.some((c) => c.bed && c.name === 'amb-tension')).toBe(true);
    expect(placeSfx({scenes, words: [], duration: 12, format: 'educatif', mood: 'chill', settings: {enabled: false, volume: 1, ambience: true}})).toEqual([]);
    expect(fs.existsSync(sfxFile('whoosh-up'))).toBe(true);
  });
  it('refuse une piste sous licence non commerciale, sans preuve ou déclarée à Content ID', () => {
    const base = {id: 'x', title: 't', artist: 'a', file: 'x.mp3', proof: 'https://exemple', commercial: true, platforms: [], contentId: false, moods: []};
    expect(checkTrack({...base, license: 'CC0'})).toEqual([]);
    expect(checkTrack({...base, license: 'CC BY-NC 4.0'}).length).toBeGreaterThan(0);
    expect(checkTrack({...base, license: 'CC0', proof: ''}).length).toBeGreaterThan(0);
    expect(checkTrack({...base, license: 'CC0', contentId: true}).length).toBeGreaterThan(0);
    expect(checkTrack({...base, license: 'CC BY 4.0'}).some((p) => /crédit/.test(p))).toBe(true);
  });
});

describe('mixage et contrôle du fichier', () => {
  it('mixe voix, musique baissée sous la voix et effets à -14 LUFS sans saturer', () => {
    const dir = tmp();
    const voice = path.join(dir, 'voice.wav');
    const n = 24000 * 4;
    const data = new Float32Array(n);
    for (let i = 0; i < n; i++) data[i] = (i / 24000 > 0.5 && i / 24000 < 3.5 ? 0.5 : 0) * Math.sin((2 * Math.PI * 220 * i) / 24000) * (0.6 + 0.4 * Math.sin((2 * Math.PI * 3 * i) / 24000));
    writeWav(voice, {sampleRate: 24000, channels: 1, data});
    const music = composeMusic(path.join(dir, 'm.wav'), {mood: 'chill', seconds: 5, seed: 1}).file;
    const r = mixAudio({out: path.join(dir, 'audio.wav'), duration: 4.5, voice, voiceOffset: 0.15, music, sfx: [{file: sfxFile('whoosh-up'), at: 1, gain: 0.3}], musicVolume: 0.3});
    expect(Math.abs(r.lufs + 14)).toBeLessThan(1.5);
    expect(r.peak).toBeLessThan(0);
    expect(envelope(voice, 30, 120).some((x) => x > 0.5)).toBe(true);
  });
  it('reconnaît un MP4 lisible en ligne et compare les images', () => {
    const dir = tmp();
    const f = path.join(dir, 'v.mp4');
    const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=180x320:rate=24:duration=2', '-f', 'lavfi', '-i', 'sine=d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', f]);
    expect(r.status).toBe(0);
    expect(moovBeforeMdat(f)).toBe(true);
    const a = frameHash(f, 0.5)!;
    expect(hamming(a, frameHash(f, 0.5)!)).toBe(0);
  });
});

describe('usine', () => {
  it('planifie un lot varié dans les formats et durées autorisés du compte', () => {
    const {db} = tmpDb();
    const plan = planBatch(db, {accountId: 'tiktok-12eure21', quantity: 20, durations: [30, 45]});
    expect(plan.length).toBe(20);
    expect(new Set(plan.map((p) => p.format)).size).toBeGreaterThan(3);
    for (const p of plan) expect(formatDef(p.format).durations).toContain(p.duration);
  });
  it('construit une frise : scènes sur la narration, coupes sur le rythme, sous-titres dans la vidéo', () => {
    const scenes = scriptFromDraft(
      {accountId: 'a', platform: 'tiktok', topic: 'automatisation', topicLabel: 'Automatisation', structure: 'etapes', hookType: 'question', hook: 'Et si ça partait tout seul ?', title: 't', template: 'educatif', format: '9:16', tone: 'direct', style: 'educatif', language: 'fr', caption: 'Publicité · Systeme.io', hashtags: [], cta: '', factIds: [], engine: 'test', slides: [{kind: 'cover', title: 'Et si ça partait tout seul ?'}, {kind: 'item', number: 1, title: 'Un formulaire', body: 'Une adresse e-mail.'}, {kind: 'item', number: 2, title: 'Une règle', body: 'Un déclencheur.'}, {kind: 'cta', title: 'Enregistre-la'}]},
      {format: 'educatif', duration: 15, cta: 'Lien en bio', linkHint: 'bio', seed: 's'},
    ).scenes;
    const parts = scenes.map((_, i) => ({start: i * 2, end: i * 2 + 1.6}));
    const voice = {provider: 'test', voice: 'test', file: '', seconds: parts[parts.length - 1].end, words: scenes.flatMap((s, i) => words(s.narration, i * 2, 0.2)), parts, mismatch: 0, costEur: 0, assetId: '', warnings: []};
    const tl = buildTimeline({scenes, def: formatDef('educatif'), transitions: ['cube'], voice, beats: [1.85, 3.9, 6], fps: 30, width: 1080, height: 1920, aspect: '9:16', targetSeconds: 15, rand: () => 0.3, captionStyle: 'tiktok', mood: 'chill', sfx: {enabled: true, volume: 1, ambience: false}, format: 'educatif'});
    expect(tl.scenes[0].start).toBe(0);
    expect(tl.scenes[1].start).toBeCloseTo(1.85, 2);
    for (const c of tl.captions) expect(c.end).toBeLessThanOrEqual(tl.duration);
    expect(tl.duration).toBeGreaterThan(voice.seconds);
  });
});

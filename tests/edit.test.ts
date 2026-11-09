import {describe, expect, it} from 'vitest';
import {buildCaptions, buildTimeline, findCueTime, joinThousands, planCuts, sceneSpans, upscaleOf, makeMove, type PreparedClip} from '../src/edit/timeline.js';
import {ART_DIRECTIONS} from '../src/edit/art-directions.js';
import {Rng} from '../src/core/rng.js';
import {loadConfig} from '../src/core/config.js';
import {displayWords} from '../src/voice/speech.js';
import {computeScore} from '../src/qc/score.js';
import {sampleScript} from './fixtures.js';
import type {VoiceWord} from '../src/schemas/records.js';

function fakeWords(): VoiceWord[] {
  const script = sampleScript();
  const out: VoiceWord[] = [];
  let t = 0.05;
  let index = 0;
  for (const scene of script.scenes) {
    for (const w of displayWords(scene.voiceover)) {
      const d = 0.18 + w.length * 0.035;
      out.push({text: w, start: t, end: t + d, sceneId: scene.id, index: index++});
      t += d + (/[.?!:]$/.test(w) ? 0.25 : 0.04);
    }
    t += 0.3;
  }
  return out;
}

function clips(): Record<string, PreparedClip[]> {
  const make = (i: number): PreparedClip => ({clipId: `pexels-${100 + i}`, pexelsId: 100 + i, file: `footage/src/${100 + i}.mp4`, durationSec: 12, width: 1080, height: 1920, fps: 30, author: `auteur ${i}`});
  return {s1: [make(1), make(2)], s2: [make(3), make(4)], s3: [make(5), make(6)], s4: [make(7), make(8)], s5: [make(9)]};
}

describe('montage', () => {
  it('découpe les scènes sur la voix, sans trou ni chevauchement', () => {
    const words = fakeWords();
    const spans = sceneSpans(sampleScript(), words, words[words.length - 1]!.end + 0.3);
    for (let i = 1; i < spans.length; i++) expect(spans[i]!.startSec).toBeCloseTo(spans[i - 1]!.endSec, 5);
    for (const s of spans) expect(s.startSec).toBeLessThanOrEqual(s.words[0]!.start);
  });

  it('place les coupes près des fins de phrase et respecte les durées minimales', () => {
    const words = fakeWords();
    const spans = sceneSpans(sampleScript(), words, 30);
    const cuts = planCuts(spans[1]!, 1.5, new Rng(1));
    for (let i = 1; i < cuts.length; i++) expect(cuts[i]! - cuts[i - 1]!).toBeGreaterThanOrEqual(0.5);
  });

  it('construit une timeline complète et lisible', async () => {
    const config = await loadConfig();
    for (const ad of ART_DIRECTIONS) {
      const words = fakeWords();
      const t = buildTimeline({runId: 'test', script: sampleScript(), words, voiceDurationSec: words[words.length - 1]!.end + 0.3, voiceSrc: 'voice.wav', clipsByScene: clips(), captures: [], music: null, ad, config, facts: [], seed: 7});
      expect(t.shots[0]!.from).toBe(0);
      const end = Math.max(...t.shots.map((s) => s.from + s.duration));
      expect(end).toBeGreaterThanOrEqual(t.durationInFrames);
      // No two consecutive shots from the same clip.
      const footage = t.shots.filter((s) => s.kind === 'footage');
      for (let i = 1; i < footage.length; i++) {
        if (footage[i]!.kind === 'footage' && footage[i - 1]!.kind === 'footage') expect(footage[i]!.source.clipId).not.toBe(footage[i - 1]!.source.clipId);
      }
      expect(t.metrics.stylizedTransitions).toBeLessThanOrEqual(3);
      expect(t.metrics.safeZoneViolations).toEqual([]);
      expect(t.captions.every((c) => c.to <= t.endCard.from)).toBe(true);
      expect(t.disclosure.text).toBe('Publicité');
      const allWords = t.captions.flatMap((c) => c.words.map((w) => w.text));
      expect(allWords.length).toBeGreaterThan(30);
    }
  });

  it('ne termine jamais un sous-titre sur un article ou une préposition', () => {
    const script = sampleScript();
    script.scenes[0] = {...script.scenes[0]!, voiceover: 'Tes pages et tes e-mails dans un seul outil ?'};
    const words: VoiceWord[] = displayWords(script.scenes[0]!.voiceover).map((w, i) => ({text: w, start: 0.1 + i * 0.3, end: 0.1 + i * 0.3 + 0.25, sceneId: 's1', index: i}));
    const spans = sceneSpans({...script, scenes: [script.scenes[0]!]}, words, 3.5);
    const ad = ART_DIRECTIONS.find((a) => a.id === 'nuit-edit')!;
    const groups = buildCaptions(spans, ad, 10_000).map((g) => g.words.map((w) => w.text).join(' '));
    for (const g of groups) expect(g).not.toMatch(/\b(dans|un|et|tes)$/);
    expect(groups).not.toContain('et');
  });

  it('ne laisse aucun sous-titre à l’écran moins de 0,4 s quand il peut rejoindre le suivant', () => {
    // « Ta page » est coupé par « ici, » qui commence avant sa fin : il ne resterait que 0,27 s à l'écran.
    const w = (text: string, start: number, end: number, index: number): VoiceWord => ({text, start, end, sceneId: 's1', index});
    const words = [w('Ta', 0.07, 0.1, 0), w('page', 0.1, 0.33, 1), w('ici,', 0.33, 0.73, 2), w('tes', 1.03, 1.07, 3), w('e-mails', 1.27, 1.47, 4), w('là.', 1.47, 1.7, 5)];
    const script = sampleScript();
    const spans = [{scene: script.scenes[0]!, index: 0, startSec: 0, endSec: 2, words}];
    const ad = ART_DIRECTIONS.find((a) => a.id === 'nuit-edit')!;
    const groups = buildCaptions(spans, ad, 10_000);
    expect(groups[0]!.words.map((x) => x.text).join(' ')).toBe('Ta page ici,');
    for (let i = 0; i < groups.length - 1; i++) expect(groups[i]!.to - groups[i]!.from).toBeGreaterThanOrEqual(12);
  });

  it('repère un chiffre dit à la voix pour y amener la caméra', () => {
    const w = (text: string, start: number, index: number): VoiceWord => ({text, start, end: start + 0.2, sceneId: 's4', index});
    const words = [w('Le', 0, 0), w('gratuit', 0.2, 1), w('inclut', 0.5, 2), w('2', 0.8, 3), w('000', 0.9, 4), w('contacts.', 1.1, 5), w('jusqu’à', 1.6, 6), w('5', 1.9, 7), w('000,', 2.0, 8), w('17', 2.6, 9), w('€', 2.7, 10)];
    expect(findCueTime('5 000', words)).toEqual({time: 1.9, index: 7});
    expect(findCueTime('2 000', words, 5)).toBeNull();
    expect(findCueTime('17 €', words)?.index).toBe(9);
    expect(findCueTime('50', words)).toBeNull();
  });

  it('enchaîne plusieurs captures réelles dans une scène, chacune sur le mot qui la nomme', async () => {
    const config = await loadConfig();
    const words = fakeWords();
    const cap = (id: string, regionId: string) => ({
      id, file: `${id}.png`, type: 'image' as const, feature: 'funnels', title: id, description: id, capturedAt: '2026-11-07T10:00:00.000Z',
      source: 'user-screenshot' as const, width: 1600, height: 1000, personalDataChecked: true,
      focusRegions: [{id: regionId, x: 0.1, y: 0.1, w: 0.3, h: 0.3, label: regionId}],
    });
    const base = sampleScript();
    const script = sampleScript({
      scenes: base.scenes.map((s) =>
        s.id === 's3'
          ? {...s, visual: {...s.visual, kind: 'demo' as const, captureIds: ['page', 'mail'], captureCues: ['Systeme.io', 'endroit'], focusRegionIds: ['bloc', 'objet']}}
          : s,
      ),
    });
    const timeline = buildTimeline({runId: 'r', script, words, voiceDurationSec: 25, voiceSrc: 'voice.wav', clipsByScene: clips(), captures: [cap('page', 'bloc'), cap('mail', 'objet')] as never, music: null, ad: ART_DIRECTIONS[0]!, config, facts: [], seed: 1});
    const shots = timeline.shots.filter((s) => s.sceneId === 's3');
    expect(shots.map((s) => (s.kind === 'capture' ? s.captureId : s.kind))).toEqual(['page', 'mail']);
    const [a, b] = shots as Array<{from: number; duration: number}>;
    expect(a!.from + a!.duration).toBe(b!.from);
    const endroit = words.find((w) => w.text.startsWith('endroit'))!;
    expect(Math.abs(b!.from / 30 - endroit.start)).toBeLessThan(0.2);
  });

  it('enchaîne deux scènes sur la même page sans revenir à la page entière', async () => {
    const config = await loadConfig();
    const words = fakeWords();
    const page = {
      id: 'page', file: 'page.png', type: 'image' as const, feature: 'pricing', title: 'page', description: 'page', capturedAt: '2026-11-07T10:00:00.000Z',
      source: 'user-screenshot' as const, width: 1280, height: 1100, personalDataChecked: true,
      focusRegions: [
        {id: 'a', x: 0.05, y: 0.4, w: 0.2, h: 0.4, label: 'Alpha', cues: ['Systeme.io']},
        {id: 'b', x: 0.3, y: 0.4, w: 0.2, h: 0.4, label: 'Beta', cues: ['endroit']},
      ],
    };
    const base = sampleScript();
    const script = sampleScript({
      scenes: base.scenes.map((s) =>
        s.id === 's2' || s.id === 's3'
          ? {...s, headline: undefined, visual: {...s.visual, kind: 'demo' as const, captureId: 'page', captureIds: undefined, focusRegionIds: s.id === 's2' ? ['a'] : ['b']}}
          : s,
      ),
    });
    const timeline = buildTimeline({runId: 'r', script, words, voiceDurationSec: 25, voiceSrc: 'voice.wav', clipsByScene: clips(), captures: [page] as never, music: null, ad: ART_DIRECTIONS[0]!, config, facts: [], seed: 1});
    const [first, second] = timeline.shots.filter((s) => s.sceneId === 's2' || s.sceneId === 's3') as Array<Extract<(typeof timeline.shots)[number], {kind: 'capture'}>>;
    expect(first!.from + first!.duration).toBe(second!.from);
    expect(second!.continues).toBe(true);
    // The second scene opens on the zone the first one ended on, already labelled, then moves on.
    const lastFocus = first!.keyframes[first!.keyframes.length - 1]!.focus;
    expect(second!.keyframes[0]!.focus).toEqual(lastFocus);
    expect(second!.keyframes[0]!.at).toBeLessThanOrEqual(0);
    expect(second!.highlights[0]!.carried).toBe(true);
    expect(second!.highlights[0]!.label).toBe('Alpha');
    expect(second!.keyframes.some((k) => k.focus === null)).toBe(false);
  });

  it('sur une ligne de tableau, les cadres s’ajoutent et la caméra ne revient jamais en arrière', async () => {
    const config = await loadConfig();
    const words = fakeWords();
    const row = {
      id: 'row', file: 'row.png', type: 'image' as const, feature: 'pricing', title: 'row', description: 'row', capturedAt: '2026-11-07T10:00:00.000Z',
      source: 'user-screenshot' as const, width: 470, height: 250, personalDataChecked: true,
      focusRegions: [
        {id: 'g', x: 0.08, y: 0.05, w: 0.36, h: 0.9, label: 'Gauche', cues: ['endroit']},
        {id: 'd', x: 0.55, y: 0.05, w: 0.36, h: 0.9, label: 'Droite', cues: ['Systeme.io']},
      ],
    };
    const base = sampleScript();
    const script = sampleScript({
      scenes: base.scenes.map((s) => (s.id === 's3' ? {...s, headline: undefined, visual: {...s.visual, kind: 'demo' as const, captureId: 'row', captureIds: undefined, focusRegionIds: ['g', 'd']}} : s)),
    });
    const timeline = buildTimeline({runId: 'r', script, words, voiceDurationSec: 25, voiceSrc: 'voice.wav', clipsByScene: clips(), captures: [row] as never, music: null, ad: ART_DIRECTIONS[0]!, config, facts: [], seed: 1});
    const shot = timeline.shots.find((s) => s.sceneId === 's3') as Extract<(typeof timeline.shots)[number], {kind: 'capture'}>;
    const ats = shot.keyframes.map((k) => k.at);
    expect([...ats].sort((a, b) => a - b)).toEqual(ats);
    // Both frames stay to the end of the shot; the first label leaves when the second arrives.
    for (const h of shot.highlights) expect(h.from + h.duration).toBeGreaterThanOrEqual(shot.duration);
    expect(shot.highlights[0]!.labelDuration).toBeLessThanOrEqual(shot.highlights[1]!.from - shot.highlights[0]!.from);
  });

  it('mesure l’agrandissement nécessaire', () => {
    const move = makeMove('push-in', 2, 1, 0);
    expect(upscaleOf({width: 3840, height: 2160}, move)).toBeLessThan(1);
    expect(upscaleOf({width: 1080, height: 1920}, move)).toBeCloseTo(1.1, 1);
    expect(upscaleOf({width: 1920, height: 1080}, move)).toBeGreaterThan(1.8);
  });
});

describe('note sur 100', () => {
  it('ne publie jamais si un verrou échoue, quelle que soit la note', async () => {
    // Independent of the real settings: start from a studio without affiliate link.
    const real = await loadConfig();
    const config = {...real, affiliate: {...real.affiliate, url: ''}};
    const words = fakeWords();
    const timeline = buildTimeline({runId: 'r', script: sampleScript(), words, voiceDurationSec: 25, voiceSrc: 'voice.wav', clipsByScene: clips(), captures: [], music: null, ad: ART_DIRECTIONS[0]!, config, facts: [], seed: 1});
    const review = {
      runId: 'r',
      reviewer: 'independent-subagent' as const,
      reviewedAt: '2026-11-06',
      framesSeen: ['a', 'b', 'c', 'd'],
      criteria: {
        visual: {score: 20, justification: 'x'.repeat(50)},
        editing: {score: 15, justification: 'x'.repeat(50)},
        script: {score: 15, justification: 'x'.repeat(50)},
        explanation: {score: 15, justification: 'x'.repeat(50)},
        conversion: {score: 15, justification: 'x'.repeat(50)},
      },
      blockingIssues: [],
      improvements: [],
      factualConcerns: [],
      rightsConcerns: [],
      verdict: {coherent: true, goodQuality: true, justification: 'La voix et les images disent la même chose, tout est net.'},
    };
    const technical = {runId: 'r', checkedAt: '', durationSec: 25, loudnessLufs: -14, truePeakDb: -1.2, finalWer: 0.03, frames: [], contactSheet: null, checks: [{id: 'disclosure', label: 'Mention', ok: true, value: 'Publicité', expected: 'Publicité', impact: 'gate' as const}, {id: 'voice-present', label: 'Voix', ok: true, value: '60 mots', expected: 'voix', impact: 'gate' as const}]};
    const voice = {voiceId: 'v', voiceName: 'Voix', modelId: 'm', attempt: 1, durationSec: 25, speechSec: 24, wpm: 170, leadingSilenceSec: 0.06, trailingSilenceSec: 0.3, maxInternalPauseSec: 0.4, pausesOver: [], wer: 0.02, sttText: '', mismatches: [], loudnessLufs: -16, truePeakDb: -1.5, approvedVoice: true, pass: true, problems: [], score: 15, characters: 400, generatedAt: ''};
    const base = {runId: 'r', config, script: sampleScript(), lint: {ok: true, errors: [], warnings: [], estimatedDurationSec: 25, wordCount: 60, factIdsUsed: []}, voice, technical, timeline, review, licenses: [], music: null, capturesOk: true};
    // Missing affiliate link + no licences for footage → blocked despite 100/100 review.
    const blocked = computeScore(base);
    expect(blocked.decision).toBe('redo');
    expect(blocked.gates.find((g) => g.id === 'affiliate')!.ok).toBe(false);
    expect(blocked.gates.find((g) => g.id === 'rights')!.ok).toBe(false);
    const licenses = Object.values(clips())
      .flat()
      .map((c) => ({pexelsId: c.pexelsId, pageUrl: '', author: c.author, authorUrl: '', fileUrl: '', license: 'Pexels', licenseUrl: '', downloadedAt: ''}));
    const ok = computeScore({...base, config: {...config, affiliate: {...config.affiliate, url: 'https://systeme.io/?sa=sa0012345678'}}, licenses});
    // Pixabay clips (clip ids "pixabay-…") are covered by Pixabay licences, not Pexels ones.
    const pixTimeline = {...timeline, shots: timeline.shots.map((s) => (s.kind === 'footage' ? {...s, source: {...s.source, clipId: s.source.clipId.replace('pexels-', 'pixabay-')}} : s))};
    const pixOk = computeScore({...base, timeline: pixTimeline, config: {...config, affiliate: {...config.affiliate, url: 'https://systeme.io/?sa=sa0012345678'}}, licenses: licenses.map((l) => ({...l, source: 'Pixabay'}))});
    expect(pixOk.gates.find((g) => g.id === 'rights')!.ok).toBe(true);
    const pixMissing = computeScore({...base, timeline: pixTimeline, licenses});
    expect(pixMissing.gates.find((g) => g.id === 'rights')!.ok).toBe(false);
    expect(ok.gates.every((g) => g.ok)).toBe(true);
    expect(ok.decision).toBe('publishable');
    // A silent video is blocked whatever the review says.
    const silent = computeScore({...base, config: {...config, affiliate: {...config.affiliate, url: 'https://systeme.io/?sa=sa0012345678'}}, licenses, technical: {...technical, checks: [technical.checks[0]!, {...technical.checks[1]!, ok: false}]}});
    expect(silent.gates.find((g) => g.id === 'sound')!.ok).toBe(false);
    expect(silent.decision).toBe('redo');

    // Rule chosen by the user (09/11/2026): no minimum score, a coherent video of good quality goes out…
    const linked = {...base, licenses, config: {...config, publish: {...config.publish, decisionRule: 'coherence' as const}, affiliate: {...config.affiliate, url: 'https://systeme.io/?sa=sa0012345678'}}};
    const low = (n: number) => ({score: n, justification: 'x'.repeat(50)});
    const modest = computeScore({...linked, review: {...review, criteria: {visual: low(11), editing: low(8), script: low(8), explanation: low(8), conversion: low(8)}}});
    expect(modest.total).toBeLessThan(80);
    expect(modest.decision).toBe('publishable');
    // …but not one the reviewer finds incoherent or sloppy (corrected), nor one that fails a mandatory check.
    const incoherent = computeScore({...linked, review: {...review, verdict: {coherent: false, goodQuality: true, justification: 'Le plan de la scène 3 ne montre pas ce que dit la voix.'}}});
    expect(incoherent.decision).toBe('improve');
    expect(incoherent.gates.find((g) => g.id === 'coherence')!.ok).toBe(false);
    const noVerdict = computeScore({...linked, review: {...review, verdict: undefined}});
    expect(noVerdict.decision).toBe('improve');
    const silentCoherent = computeScore({...linked, technical: {...technical, checks: [technical.checks[0]!, {...technical.checks[1]!, ok: false}]}});
    expect(silentCoherent.decision).toBe('redo');
  });
});

describe('nombres dans les sous-titres', () => {
  it('garde « 5 000 » entier quand la transcription coupe le nombre aux milliers', () => {
    const w = (text: string, start: number, end: number, index: number) => ({text, start, end, sceneId: 's4', index});
    const out = joinThousands([w('passe', 0, 0.2, 0), w('à', 0.2, 0.3, 1), w('5', 0.3, 0.4, 2), w('000', 0.4, 0.7, 3), w('contacts', 0.7, 1.1, 4), w('et', 1.1, 1.2, 5), w('5', 1.2, 1.4, 6), w('formations.', 1.4, 1.9, 7)]);
    expect(out.map((x) => x.text)).toEqual(['passe', 'à', '5 000', 'contacts', 'et', '5', 'formations.']);
    expect(out[2]!.start).toBe(0.3);
    expect(out[2]!.end).toBe(0.7);
    expect(joinThousands([w('2', 0, 0.1, 0), w('000.', 0.1, 0.4, 1)]).map((x) => x.text)).toEqual(['2 000.']);
  });
});

describe('rythme réel des images', () => {
  it('compte un recadrage de la caméra comme une nouvelle image, pas un cadre ajouté sans mouvement', async () => {
    const {imageSegments} = await import('../src/edit/timeline.js');
    const base = {kind: 'capture' as const, sceneId: 's', transitionIn: 'cut' as const, transitionOut: 'cut' as const, src: 'c.png', mediaType: 'image' as const, width: 1280, height: 1100, backgroundSrc: null, captureId: 'c', highlights: []};
    const moving = {...base, id: 'a', from: 0, duration: 300, keyframes: [{at: 0, focus: null}, {at: 100, focus: {x: 0.05, y: 0.37, w: 0.2, h: 0.44}}, {at: 200, focus: {x: 0.75, y: 0.37, w: 0.2, h: 0.44}}]};
    const still = {...base, id: 'b', from: 300, duration: 90, keyframes: [{at: 0, focus: null}, {at: 40, focus: {x: 0.08, y: 0.05, w: 0.36, h: 0.9}}]};
    const t = {fps: 30, shots: [moving, still]} as never;
    expect(imageSegments(t)).toEqual([100 / 30, 100 / 30, 100 / 30, 3]);
  });
});

import {describe, expect, it} from 'vitest';
import {buildCaptions, buildTimeline, planCuts, sceneSpans, upscaleOf, makeMove, type PreparedClip} from '../src/edit/timeline.js';
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
  });
});

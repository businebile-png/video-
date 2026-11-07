import {z} from 'zod';
import {PhaseSchema} from './config.js';

export const GraphicSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('checklist'),
    title: z.string().max(40).optional(),
    items: z.array(z.string().min(2).max(34)).min(2).max(4),
  }),
  z.object({
    type: z.literal('steps'),
    title: z.string().max(40).optional(),
    steps: z
      .array(z.object({title: z.string().min(2).max(30), detail: z.string().max(48).optional()}))
      .min(2)
      .max(4),
  }),
  z.object({
    type: z.literal('stack-merge'),
    /** Generic tool categories only ("Emails", "Pages de vente"…), never third-party brand names. */
    items: z.array(z.string().min(2).max(18)).min(3).max(6),
    result: z.string().min(2).max(24),
  }),
  z.object({
    type: z.literal('compare'),
    left: z.object({title: z.string().max(22), items: z.array(z.string().max(28)).min(2).max(4)}),
    right: z.object({title: z.string().max(22), items: z.array(z.string().max(28)).min(2).max(4)}),
    /** "cross": the left column lists what is missing (default); "dot": it lists what it includes (e.g. a free plan). */
    leftStyle: z.enum(['cross', 'dot']).optional(),
  }),
  z.object({
    type: z.literal('stat'),
    value: z.string().min(1).max(12),
    label: z.string().min(2).max(40),
    factId: z.string(),
  }),
  z.object({
    type: z.literal('price'),
    plan: z.string().min(2).max(20),
    price: z.string().min(1).max(16),
    period: z.string().max(16),
    note: z.string().max(60).optional(),
    factId: z.string(),
  }),
]);
export type Graphic = z.infer<typeof GraphicSchema>;

export const SceneSchema = z.object({
  id: z.string().regex(/^s\d{1,2}$/, 'identifiants de scène attendus : s1, s2…'),
  phase: PhaseSchema,
  /** Spoken French text, as it should be heard (brand names written normally; pronunciation is handled later). */
  voiceover: z.string().min(3).max(320),
  /** Short on-screen label shown at the top (not a copy of the voice-over). */
  headline: z.string().min(2).max(42).optional(),
  /** Words or short phrases of the voice-over to highlight in captions. */
  emphasis: z.array(z.string().min(2)).max(4).default([]),
  visual: z.object({
    kind: z.enum(['broll', 'demo', 'graphic']),
    /** Pexels search queries in English (better catalogue coverage), most specific first. */
    queries: z.array(z.string().min(3)).max(5).default([]),
    /** What the shots should show, in plain words (used by the footage reviewer). */
    shotIdeas: z.array(z.string()).max(4).default([]),
    mood: z.string().max(40).optional(),
    captureId: z.string().optional(),
    // One zone per thing the voice names ("0 € sans carte", "3 tunnels", "10 tunnels", "17 €"): at most four moves.
    focusRegionIds: z.array(z.string()).max(4).default([]),
    /** Text of each zone's label pill when it should say what the voice says ("1 formation · 500 élèves"); a verified fact. */
    focusLabels: z.array(z.string().min(2).max(42)).max(4).optional(),
    graphic: GraphicSchema.optional(),
  }),
  /** Ids from data/facts/systeme-io.json backing every factual claim of the scene. */
  claimFactIds: z.array(z.string()).default([]),
});
export type Scene = z.infer<typeof SceneSchema>;

export const ScriptSchema = z.object({
  runId: z.string(),
  category: z.string(),
  angle: z.string().min(10),
  persona: z.string().min(5),
  hookStyle: z.string(),
  workingTitle: z.string().min(3),
  targetDurationSec: z.number().min(15).max(95),
  scenes: z.array(SceneSchema).min(4).max(14),
  cta: z.object({
    onScreen: z.string().min(4).max(48),
    subline: z.string().min(4).max(64),
    /** The concrete reason to click (the benefit of visiting), not just "clique". */
    reason: z.string().min(10),
  }),
  captions: z.object({
    tiktok: z.string().min(20).max(2000),
    instagram: z.string().min(20).max(2200),
    hashtags: z.array(z.string().regex(/^#[\p{L}\p{N}_]+$/u)).min(2).max(8),
  }),
  author: z.enum(['agent', 'human', 'api']).default('agent'),
});
export type Script = z.infer<typeof ScriptSchema>;

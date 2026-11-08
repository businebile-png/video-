import {z} from 'zod';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'format attendu HH:MM');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'format attendu AAAA-MM-JJ');

export const VoiceSettingsSchema = z.object({
  stability: z.number().min(0).max(1),
  similarity_boost: z.number().min(0).max(1),
  style: z.number().min(0).max(1),
  use_speaker_boost: z.boolean(),
  speed: z.number().min(0.7).max(1.2),
});
export type VoiceSettings = z.infer<typeof VoiceSettingsSchema>;

export const ApprovedVoiceSchema = z.object({
  id: z.string().min(5),
  name: z.string().min(1),
  approvedOn: isoDate,
  approvedBy: z.string().default('utilisateur'),
  modelId: z.string().optional(),
  /** Engine that speaks this voice (defaults to voice.provider). */
  provider: z.enum(['local', 'chatterbox', 'azure', 'elevenlabs']).optional(),
  settings: VoiceSettingsSchema.partial().default({}),
  notes: z.string().optional(),
});
export type ApprovedVoice = z.infer<typeof ApprovedVoiceSchema>;

/** Who gives the final go: the user in the validation panel, or the studio itself when every check passes. */
export const ApprovalSchema = z.enum(['panel', 'auto']);
/** How Metricool delivers: publish automatically, push a notification to finish by hand, or keep a draft. */
export const DeliverySchema = z.enum(['auto', 'notification', 'draft']);
export type Delivery = z.infer<typeof DeliverySchema>;

export const StudioConfigSchema = z.object({
  brand: z.object({
    name: z.string(),
    accountName: z.string().optional(),
  }),
  affiliate: z.object({
    /** Personal Systeme.io affiliate link, e.g. https://systeme.io?sa=sa00XXXX (never "www"). Empty = publishing blocked. */
    url: z.string(),
    /** Date the user last confirmed the TikTok/Instagram bio link points to `url`. */
    bioLinkCheckedOn: isoDate.nullable(),
    disclosureBadge: z.string().min(3),
    disclosureCaption: z.string().min(10),
  }),
  platforms: z.object({
    tiktok: z.object({
      enabled: z.boolean(),
      postTimes: z.array(hhmm).min(1),
      privacy: z.enum(['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY']),
      aiLabel: z.boolean(),
      commercialContentThirdParty: z.boolean(),
    }),
    instagram: z.object({
      enabled: z.boolean(),
      postTimes: z.array(hhmm).min(1),
      aiLabel: z.boolean(),
      showReelOnFeed: z.boolean(),
    }),
  }),
  metricool: z.object({
    brandId: z.string().min(1),
    timezone: z.string().min(3),
  }),
  publish: z.object({
    approval: ApprovalSchema,
    delivery: DeliverySchema,
    minScore: z.number().int().min(50).max(100),
    improveFrom: z.number().int().min(50).max(100),
    leadTimeMinutes: z.number().int().min(15),
  }),
  media: z.object({
    repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
    /**
     * session-branch: the MP4 is committed on the branch the session works on (no special permission).
     * media-branch: one orphan branch rebuilt with the last `retentionDays` days (keeps the repo small);
     * only when the user has explicitly allowed pushes to that branch.
     */
    mode: z.enum(['session-branch', 'media-branch']),
    branch: z.string().min(1),
    retentionDays: z.number().int().min(3).max(120),
  }),
  voice: z.object({
    /**
     * local = free voice on this machine, no account (default: Kokoro-82M, Apache-2.0);
     * azure = free F0 tier (account required); elevenlabs = paid plans only.
     */
    provider: z.enum(['local', 'chatterbox', 'azure', 'elevenlabs']),
    /** Credit line added to every post caption (licence of the voice's source recordings), empty for none. */
    creditLine: z.string().max(140).default(''),
    /** Speech-to-text used to time captions and verify pronunciation (local = faster-whisper). */
    sttProvider: z.enum(['local', 'azure', 'elevenlabs']),
    local: z
      .object({
        python: z.string().min(1),
        model: z.string().min(1),
        voices: z.string().min(1),
        whisperModel: z.string().min(1),
        lang: z.string().min(2),
        sceneBreakMs: z.number().int().min(0).max(1500),
      })
      .default({
        python: '.venv-voice/bin/python',
        model: 'models/kokoro/onnx/model.onnx',
        voices: 'models/kokoro/voices.npz',
        whisperModel: 'models/whisper/small',
        lang: 'fr-fr',
        sceneBreakMs: 300,
      }),
    /** Voice « Claire »: Chatterbox Multilingual (MIT) with a SIWIS reference recording (CC BY 4.0). */
    chatterbox: z
      .object({
        python: z.string().min(1),
        modelDir: z.string().min(1),
        reference: z.string().min(1),
        exaggeration: z.number().min(0).max(2),
        cfgWeight: z.number().min(0).max(1),
        temperature: z.number().min(0.1).max(1.5),
        maxTakes: z.number().int().min(1).max(8),
        sentenceBreakMs: z.number().int().min(0).max(1000),
        sceneBreakMs: z.number().int().min(0).max(1500),
        /** This voice speaks slowly: the result is stretched (pitch kept) towards this pace, up to maxSpeedup. */
        targetWpm: z.number().min(100).max(220).default(160),
        maxSpeedup: z.number().min(1).max(1.5).default(1.25),
        /** Spellings for this engine, on top of voice.pronunciations (it reads text, not phonemes). */
        pronunciations: z.record(z.string(), z.string()).default({}),
      })
      .default({
        python: '.venv-chatterbox/bin/python',
        modelDir: 'models/chatterbox',
        reference: 'models/voice-refs/claire.wav',
        exaggeration: 0.5,
        cfgWeight: 0.5,
        temperature: 0.7,
        maxTakes: 4,
        sentenceBreakMs: 160,
        sceneBreakMs: 300,
        targetWpm: 160,
        maxSpeedup: 1.25,
        pronunciations: {},
      }),
    azure: z.object({
      region: z.string().regex(/^[a-z0-9]+$/),
      locale: z.string().min(4),
      outputFormat: z.string(),
      sceneBreakMs: z.number().int().min(0).max(1500),
    }),
    modelId: z.string(),
    outputFormat: z.string(),
    sttModelId: z.string(),
    languageCode: z.string().min(2),
    sceneBreakSec: z.number().min(0).max(1.5),
    approvedVoices: z.array(ApprovedVoiceSchema),
    defaultSettings: VoiceSettingsSchema,
    pronunciations: z.record(z.string(), z.string()),
    targets: z.object({
      wpmMin: z.number(),
      wpmMax: z.number(),
      maxInternalPauseSec: z.number(),
      maxLeadingSilenceSec: z.number(),
      maxWer: z.number().min(0).max(1),
    }),
    maxAttempts: z.number().int().min(1).max(6),
  }),
  footage: z.object({
    /** pixabay (default: free key, shown instantly) or pexels (new keys paused since autumn 2026). */
    provider: z.enum(['pixabay', 'pexels']),
    reuseCooldownDays: z.number().int().min(0),
    perQuery: z.number().int().min(5).max(80),
    candidatesPerScene: z.number().int().min(3).max(12),
    minShortSide: z.number().int().min(720),
    allowLandscapeCrop: z.boolean(),
  }),
  music: z.object({
    mode: z.enum(['library', 'generate', 'library-then-generate', 'none']),
    generateModelId: z.string().optional(),
    underVoiceDb: z.number().max(0),
    openDb: z.number().max(0),
    recentTrackCooldown: z.number().int().min(0),
    /**
     * Song chosen by the user for every video (their decision and their declared right to use it): laid under
     * the voice after the review, a different excerpt each time. The file itself is never committed (public
     * repository): it is kept in the panel's private file store.
     */
    userTrack: z
      .object({
        id: z.string(),
        title: z.string(),
        artist: z.string(),
        credit: z.string(),
        licence: z.string(),
        panelAssetId: z.string().optional(),
        excerpts: z.array(z.number().min(0)).min(1),
        targetLufs: z.number().max(0).default(-19),
      })
      .optional(),
  }),
  render: z.object({
    fps: z.literal(30),
    width: z.literal(1080),
    height: z.literal(1920),
    crf: z.number().int().min(10).max(28),
    x264Preset: z.enum(['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower']),
    browserExecutable: z.string().nullable(),
    concurrency: z.number().int().min(1).nullable(),
  }),
  qc: z.object({
    loudnessTargetLufs: z.number(),
    loudnessTolerance: z.number(),
    truePeakMaxDb: z.number(),
    maxUpscale: z.number().min(1),
    maxFinalWer: z.number().min(0).max(1),
  }),
});
export type StudioConfig = z.infer<typeof StudioConfigSchema>;

export const PHASES = ['hook', 'problem', 'agitation', 'solution', 'demo', 'benefits', 'proof', 'objection', 'cta'] as const;
export const PhaseSchema = z.enum(PHASES);
export type Phase = z.infer<typeof PhaseSchema>;

/** Systeme.io capabilities a video may talk about (each must be backed by a verified fact). */
export const FEATURES = [
  'funnels',
  'landing-pages',
  'email-marketing',
  'automations',
  'courses',
  'community',
  'digital-products',
  'physical-products',
  'payments',
  'website',
  'blog',
  'webinars',
  'affiliate-program',
  'contacts',
  'coupons',
  'ab-testing',
  'pricing',
  'free-plan',
] as const;
export const FeatureSchema = z.enum(FEATURES);
export type Feature = z.infer<typeof FeatureSchema>;

export const CategorySchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  label: z.string(),
  description: z.string(),
  durationSec: z.tuple([z.number().min(15), z.number().max(95)]),
  phases: z.array(PhaseSchema).min(3),
  requiresDemo: z.boolean(),
  features: z.array(FeatureSchema),
  angleSeeds: z.array(z.string()).min(3),
  weight: z.number().min(0).default(1),
  /** Fresh verified facts carrying these tags must exist, or the category is skipped (e.g. prices). */
  requiresFactTags: z.array(z.string()).default([]),
  /** Art directions suited to this format (any when absent). */
  artDirections: z.array(z.string()).optional(),
});
export type Category = z.infer<typeof CategorySchema>;

export const EditorialSchema = z.object({
  categories: z.array(CategorySchema).min(6),
  hookStyles: z.array(z.object({id: z.string(), label: z.string(), principle: z.string()})).min(5),
  rules: z.object({
    minDaysBetweenSameCategory: z.number().int().min(1),
    hookSimilarityMax: z.number().min(0).max(1),
    angleSimilarityMax: z.number().min(0).max(1),
    recentWindow: z.number().int().min(5),
  }),
});
export type Editorial = z.infer<typeof EditorialSchema>;

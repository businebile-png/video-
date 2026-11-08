import {z} from 'zod';

/** One display word of the voice-over with its timing (seconds, voice timeline). */
export const VoiceWordSchema = z.object({
  text: z.string(),
  start: z.number().min(0),
  end: z.number().min(0),
  sceneId: z.string(),
  index: z.number().int().min(0),
});
export type VoiceWord = z.infer<typeof VoiceWordSchema>;

export const VoiceReportSchema = z.object({
  voiceId: z.string(),
  voiceName: z.string(),
  modelId: z.string(),
  attempt: z.number().int(),
  durationSec: z.number(),
  speechSec: z.number(),
  wpm: z.number(),
  leadingSilenceSec: z.number(),
  trailingSilenceSec: z.number(),
  maxInternalPauseSec: z.number(),
  pausesOver: z.array(z.object({afterWord: z.string(), sec: z.number()})),
  wer: z.number().nullable(),
  sttText: z.string().nullable(),
  mismatches: z.array(z.string()),
  loudnessLufs: z.number().nullable(),
  truePeakDb: z.number().nullable(),
  approvedVoice: z.boolean(),
  pass: z.boolean(),
  problems: z.array(z.string()),
  score: z.number().min(0).max(15),
  characters: z.number().int(),
  generatedAt: z.string(),
});
export type VoiceReport = z.infer<typeof VoiceReportSchema>;

export const ReviewCriterionSchema = z.object({
  score: z.number().min(0),
  justification: z.string().min(40, 'justification trop courte (40 caractères minimum)'),
});

/** Written by an independent reviewer (fresh-context subagent or human) after looking at the frames. */
export const ReviewSchema = z.object({
  runId: z.string(),
  reviewer: z.enum(['independent-subagent', 'human']),
  reviewedAt: z.string(),
  framesSeen: z.array(z.string()).min(4, 'le relecteur doit avoir regardé au moins 4 images'),
  criteria: z.object({
    visual: ReviewCriterionSchema.extend({score: z.number().min(0).max(20)}),
    editing: ReviewCriterionSchema.extend({score: z.number().min(0).max(15)}),
    script: ReviewCriterionSchema.extend({score: z.number().min(0).max(15)}),
    explanation: ReviewCriterionSchema.extend({score: z.number().min(0).max(15)}),
    conversion: ReviewCriterionSchema.extend({score: z.number().min(0).max(15)}),
  }),
  blockingIssues: z.array(z.string()).default([]),
  improvements: z.array(z.string()).default([]),
  factualConcerns: z.array(z.string()).default([]),
  rightsConcerns: z.array(z.string()).default([]),
});
export type Review = z.infer<typeof ReviewSchema>;

export const HistoryRecordSchema = z.object({
  runId: z.string(),
  date: z.string(),
  category: z.string(),
  hookStyle: z.string().nullable(),
  hook: z.string().nullable(),
  angle: z.string().nullable(),
  workingTitle: z.string().nullable(),
  artDirection: z.string().nullable(),
  musicTrack: z.string().nullable(),
  /** Start (s) of the excerpt of the user's chosen song laid under this video: each video gets another one. */
  musicStart: z.number().nullable().optional(),
  voiceId: z.string().nullable(),
  durationSec: z.number().nullable(),
  score: z.number().nullable(),
  decision: z.enum(['publishable', 'improve', 'redo', 'failed', 'abandoned']).nullable(),
  status: z.enum(['created', 'rendered', 'rejected', 'scheduled', 'published', 'failed', 'abandoned']),
  reason: z.string().nullable(),
  pexelsIds: z.array(z.number()).default([]),
  updatedAt: z.string(),
});
export type HistoryRecord = z.infer<typeof HistoryRecordSchema>;

export const PublicationSchema = z.object({
  runId: z.string(),
  network: z.enum(['tiktok', 'instagram']),
  contentSha256: z.string(),
  mediaUrl: z.string(),
  scheduledFor: z.string(),
  delivery: z.enum(['draft', 'notification', 'auto']),
  approvedBy: z.enum(['panel', 'auto']),
  status: z.enum(['draft', 'scheduled', 'published', 'failed', 'cancelled']),
  metricoolPostId: z.string().nullable(),
  metricoolUuid: z.string().nullable(),
  plannerUrl: z.string().nullable(),
  permalink: z.string().nullable(),
  captionStart: z.string(),
  confirmedAt: z.string().nullable(),
  note: z.string().nullable(),
  recordedAt: z.string(),
});
export type Publication = z.infer<typeof PublicationSchema>;

/** Normalised post metrics, assembled from Metricool (or official APIs) by the daily agent. */
export const PostMetricsSchema = z.object({
  network: z.enum(['tiktok', 'instagram']),
  permalink: z.string().nullable().default(null),
  postId: z.string().nullable().default(null),
  publishedAt: z.string(),
  caption: z.string().default(''),
  metrics: z.object({
    views: z.number().nullable().default(null),
    reach: z.number().nullable().default(null),
    likes: z.number().nullable().default(null),
    comments: z.number().nullable().default(null),
    shares: z.number().nullable().default(null),
    saves: z.number().nullable().default(null),
    avgWatchTimeSec: z.number().nullable().default(null),
    completionRate: z.number().nullable().default(null),
    profileVisits: z.number().nullable().default(null),
    linkClicks: z.number().nullable().default(null),
  }),
});
export type PostMetrics = z.infer<typeof PostMetricsSchema>;
export const StatsImportSchema = z.object({
  collectedAt: z.string(),
  source: z.string(),
  posts: z.array(PostMetricsSchema),
});

export const AffiliateDaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  clicks: z.number().int().min(0).nullable(),
  signups: z.number().int().min(0).nullable(),
  paidSubscriptions: z.number().int().min(0).nullable(),
  commission: z.number().min(0).nullable(),
  currency: z.string().default('EUR'),
  source: z.string(),
  recordedAt: z.string(),
});
export type AffiliateDay = z.infer<typeof AffiliateDaySchema>;

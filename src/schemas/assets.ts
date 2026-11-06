import {z} from 'zod';
import {FeatureSchema} from './config.js';

const rel = z.number().min(0).max(1);

export const FocusRegionSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    /** Relative box (0..1) inside the capture. */
    x: rel,
    y: rel,
    w: rel,
    h: rel,
    label: z.string().max(32),
  })
  .refine((r) => r.x + r.w <= 1.0001 && r.y + r.h <= 1.0001, 'la zone dépasse la capture');

export const CaptureSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  file: z.string(),
  type: z.enum(['image', 'video']),
  feature: FeatureSchema,
  title: z.string().min(3),
  description: z.string().min(10),
  capturedAt: z.string(),
  source: z.enum(['user-recording', 'user-screenshot', 'public-page']),
  sourceUrl: z.string().optional(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  durationSec: z.number().positive().optional(),
  focusRegions: z.array(FocusRegionSchema).default([]),
  /** The user confirmed no personal data (emails, names, revenue of others) is visible. */
  personalDataChecked: z.boolean(),
  notes: z.string().optional(),
});
export type Capture = z.infer<typeof CaptureSchema>;
export const CapturesManifestSchema = z.object({captures: z.array(CaptureSchema)});

export const TrackSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  file: z.string(),
  title: z.string(),
  artist: z.string().optional(),
  /** Where it comes from (store, generator…). */
  source: z.string().min(2),
  /** Licence name / plan covering commercial use on TikTok and Instagram. */
  license: z.string().min(3),
  licenseUrl: z.string().optional(),
  /** Where the proof lives (invoice, licence certificate, generation id…). */
  proof: z.string().min(3),
  moods: z.array(z.string()).min(1),
  bpm: z.number().optional(),
  energy: z.number().int().min(1).max(5),
  durationSec: z.number().positive(),
  addedAt: z.string(),
  generated: z
    .object({provider: z.string(), prompt: z.string(), requestId: z.string().optional(), generatedAt: z.string()})
    .optional(),
});
export type Track = z.infer<typeof TrackSchema>;
export const MusicManifestSchema = z.object({tracks: z.array(TrackSchema)});

import fs from 'node:fs';
import path from 'node:path';
import {z} from 'zod';
import {PATHS} from './paths.js';

export const PLATFORMS = ['tiktok', 'instagram', 'threads', 'youtube', 'linkedin', 'facebook', 'pinterest'] as const;
export type Platform = (typeof PLATFORMS)[number];
export const FORMATS = ['9:16', '4:5', '1:1'] as const;
export type Format = (typeof FORMATS)[number];

const Palette = z.object({
  bg: z.string(),
  fg: z.string(),
  accent: z.string(),
  accent2: z.string(),
  muted: z.string(),
});

export const BrandSchema = z.object({
  name: z.string(),
  handle: z.string(),
  palette: Palette,
  fonts: z.object({heading: z.string(), body: z.string()}),
  templates: z.array(z.string()).default([]),
  defaultFormat: z.enum(FORMATS),
});
export type Brand = z.infer<typeof BrandSchema>;

export const LimitsSchema = z.object({
  maxPerDay: z.number().int().min(0),
  maxPerWeek: z.number().int().min(0),
  minGapMinutes: z.number().int().min(0),
  window: z.tuple([z.string(), z.string()]),
  preferredTimes: z.array(z.string()).default([]),
});
export type Limits = z.infer<typeof LimitsSchema>;

export const AccountSettingsSchema = z
  .object({
    requireApproval: z.boolean().default(true),
    autoPublish: z.boolean().default(false),
    disclosure: z.boolean().default(true),
    privacy: z.string().optional(),
    autoAddMusic: z.boolean().optional(),
    allowComments: z.boolean().optional(),
  })
  .passthrough();
export type AccountSettings = z.infer<typeof AccountSettingsSchema>;

/** Video choices of an account (the factory reads them; every field can be changed per batch). */
export const VideoAccountSchema = z
  .object({
    enabled: z.boolean().default(true),
    /** Publication profile: tiktok, reels or shorts. */
    profile: z.enum(['tiktok', 'reels', 'shorts', 'threads']).optional(),
    aspects: z.array(z.enum(['9:16', '1:1', '16:9'])).default(['9:16']),
    durations: z.array(z.number().int()).default([30, 45]),
    /** Allowed video formats (empty = all). */
    formats: z.array(z.string()).default([]),
    voice: z
      .object({
        id: z.string().default('auto'),
        gender: z.enum(['female', 'male']).default('female'),
        speed: z.number().min(0.7).max(1.4).default(1),
        intonation: z.enum(['neutre', 'expressive', 'calme']).default('neutre'),
        language: z.string().default('fr-FR'),
      })
      .prefault({}),
    visuals: z.enum(['auto', 'motion', 'stock', 'images', 'ai']).default('auto'),
    music: z.enum(['original', 'licence', 'aucune']).default('original'),
    maxPerDay: z.number().int().min(0).default(1),
    /** Declare synthetic voice / AI visuals on the platform (TikTok, YouTube, Instagram labels). */
    aiLabel: z.boolean().default(true),
  })
  .passthrough();
export type VideoAccountSettings = z.infer<typeof VideoAccountSchema>;

export const AccountConfigSchema = z.object({
  id: z.string(),
  platform: z.enum(PLATFORMS),
  handle: z.string(),
  displayName: z.string().optional(),
  provider: z.enum(['zernio', 'meta', 'metricool', 'manual']),
  fallbackProvider: z.enum(['zernio', 'meta', 'metricool', 'manual']).optional(),
  providerAccountId: z.string().nullable().optional(),
  providerProfileId: z.string().optional(),
  niche: z.string(),
  language: z.string().default('fr'),
  slideshows: z.boolean().default(true),
  notes: z.string().optional(),
  brand: BrandSchema,
  limits: LimitsSchema,
  settings: AccountSettingsSchema,
  video: VideoAccountSchema.optional(),
});
export type AccountConfig = z.infer<typeof AccountConfigSchema>;

export const AccountsFileSchema = z.object({
  timezone: z.string().default('Europe/Paris'),
  reservedTimes: z.object({note: z.string().optional(), times: z.array(z.string()), gapMinutes: z.number()}).optional(),
  accounts: z.array(AccountConfigSchema),
});
export type AccountsFile = z.infer<typeof AccountsFileSchema>;

const PlatformSpecSchema = z.object({
  label: z.string(),
  carousel: z.boolean(),
  formats: z.array(z.enum(FORMATS)),
  defaultFormat: z.enum(FORMATS),
  minSlides: z.number(),
  maxSlides: z.number(),
  imageType: z.string(),
  maxImageBytes: z.number(),
  captionMax: z.number(),
  titleMax: z.number().optional(),
  hashtagsRecommended: z.number(),
  hashtagsMax: z.number(),
  linksClickable: z.boolean(),
  dailyCap: z.number(),
  sources: z.array(z.string()),
});
export type PlatformSpec = z.infer<typeof PlatformSpecSchema>;

const SizeSchema = z.object({
  width: z.number(),
  height: z.number(),
  safe: z.object({top: z.number(), bottom: z.number(), left: z.number(), right: z.number()}),
});
export type SizeSpec = z.infer<typeof SizeSchema>;

const VideoProfileSchema = z.object({
  label: z.string(),
  platform: z.string(),
  aspect: z.enum(['9:16', '1:1', '16:9']),
  minDuration: z.number(),
  maxDuration: z.number(),
  captionMax: z.number(),
  titleMax: z.number().nullable(),
  hashtags: z.tuple([z.number(), z.number()]),
  cta: z.string(),
  linkHint: z.string(),
  cover: z.enum(['frame', 'image', 'none']),
  captionScale: z.number(),
  hookMaxSeconds: z.number(),
  sources: z.array(z.string()),
});
export type VideoProfile = z.infer<typeof VideoProfileSchema>;

export const PlatformsFileSchema = z.object({
  checkedOn: z.string(),
  platforms: z.record(z.string(), PlatformSpecSchema),
  sizes: z.record(z.string(), SizeSchema),
  videoSizes: z.record(z.string(), SizeSchema).default({}),
  videoProfiles: z.record(z.string(), VideoProfileSchema).default({}),
});
export type PlatformsFile = z.infer<typeof PlatformsFileSchema>;

export const ComplianceSchema = z.object({
  brandName: z.string(),
  affiliateUrl: z.string().url(),
  affiliateNote: z.string().optional(),
  disclosure: z.object({badge: z.string(), captionPrefix: z.string(), everySlide: z.boolean(), law: z.string()}),
  competitorBrands: z.array(z.string()),
  requireHumanApprovalForFactsOlderThanDays: z.number().default(30),
});
export type Compliance = z.infer<typeof ComplianceSchema>;

export const NicheSchema = z.object({
  id: z.string(),
  label: z.string(),
  language: z.string(),
  audience: z.string(),
  keywords: z.array(z.string()),
  hashtags: z.object({core: z.array(z.string()), byTopic: z.record(z.string(), z.array(z.string()))}),
  topics: z.array(z.object({id: z.string(), label: z.string(), keywords: z.array(z.string())})),
  searchQueries: z.record(z.string(), z.array(z.string())),
  competitorSeeds: z.record(z.string(), z.array(z.string())),
});
export type Niche = z.infer<typeof NicheSchema>;

export const ModelSchema = z.object({
  id: z.string(),
  provider: z.string(),
  model: z.string(),
  inputPerMTok: z.number(),
  outputPerMTok: z.number(),
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional(),
  enabled: z.boolean(),
  roles: z.array(z.string()),
});
export type ModelConfig = z.infer<typeof ModelSchema>;

export const ProviderSchema = z.object({
  kind: z.enum(['openai', 'anthropic', 'offline']),
  baseUrl: z.string().optional(),
  baseUrlEnv: z.string().optional(),
  keyEnv: z.array(z.string()),
  free: z.boolean(),
  dailyBudgetUsd: z.number().optional(),
  dailyCallLimit: z.number().optional(),
  maxPromptChars: z.number().optional(),
  headers: z.record(z.string(), z.string()).optional(),
});
export type ProviderConfig = z.infer<typeof ProviderSchema>;

export const AiFileSchema = z.object({
  note: z.string().optional(),
  dailyBudgetUsd: z.number(),
  providers: z.record(z.string(), ProviderSchema),
  models: z.array(ModelSchema),
  roles: z.record(z.string(), z.object({label: z.string(), order: z.array(z.string())})),
});
export type AiFile = z.infer<typeof AiFileSchema>;

export const ROLES = ['research', 'trends', 'ideas', 'writing', 'visuals', 'qc', 'optimization'] as const;
export type Role = (typeof ROLES)[number];

function readJson<T>(file: string, schema: z.ZodType<T>): T {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Configuration invalide dans ${path.relative(PATHS.root, file)} : ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join(' ; ')}`);
  }
  return parsed.data;
}

export interface AppConfig {
  accounts: AccountsFile;
  platforms: PlatformsFile;
  compliance: Compliance;
  niche: Niche;
  ai: AiFile;
}

let cached: AppConfig | null = null;

export function loadConfig(dir = PATHS.config, fresh = false): AppConfig {
  if (cached && !fresh && dir === PATHS.config) return cached;
  const cfg: AppConfig = {
    accounts: readJson(path.join(dir, 'accounts.json'), AccountsFileSchema),
    platforms: readJson(path.join(dir, 'platforms.json'), PlatformsFileSchema),
    compliance: readJson(path.join(dir, 'compliance.json'), ComplianceSchema),
    niche: readJson(path.join(dir, 'niche.json'), NicheSchema),
    ai: readJson(path.join(dir, 'ai.json'), AiFileSchema),
  };
  if (dir === PATHS.config) cached = cfg;
  return cfg;
}

export function platformSpec(cfg: AppConfig, platform: string): PlatformSpec {
  const spec = cfg.platforms.platforms[platform];
  if (!spec) throw new Error(`Plateforme inconnue : ${platform}`);
  return spec;
}

export function sizeSpec(cfg: AppConfig, format: Format): SizeSpec {
  const s = cfg.platforms.sizes[format];
  if (!s) throw new Error(`Format inconnu : ${format}`);
  return s;
}

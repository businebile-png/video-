import type {GenStructure} from '../generate/types.js';

export const ASPECTS = ['9:16', '1:1', '16:9'] as const;
export type Aspect = (typeof ASPECTS)[number];

export const DURATIONS = [15, 30, 45, 60, 90] as const;
export type DurationTarget = (typeof DURATIONS)[number];

export const VIDEO_FORMAT_IDS = [
  'storytelling',
  'educatif',
  'motivation',
  'business',
  'faits',
  'top5',
  'top10',
  'anecdotes',
  'documentaire',
  'voix-ia',
  'sans-voix',
  'images-animees',
  'sequences-ia',
] as const;
export type VideoFormatId = (typeof VIDEO_FORMAT_IDS)[number];

/** How the narration is produced. 'aucune' = text on screen + music only. */
export type VoiceMode = 'voix' | 'aucune';
/** What fills the frame behind the text. */
export type VisualMode = 'motion' | 'stock' | 'images' | 'ai';
export type MusicMood = 'cinematic' | 'uplifting' | 'mysterious' | 'emotional' | 'driving' | 'corporate' | 'documentary' | 'suspense' | 'chill' | 'warm' | 'light' | 'playful' | 'calm';
export type Transition = 'cube' | 'flip' | 'depth' | 'swing' | 'zoom' | 'whip';
/** Caption styles: word by word, sentence by sentence, TikTok, documentary, minimal, cinematic (kinetic = no voice). */
export type CaptionStyle = 'mot' | 'phrase' | 'tiktok' | 'documentaire' | 'minimal' | 'cinematique' | 'kinetic';

export interface AudioSettings {
  musicVolume: number;
  voiceVolume: number;
  ducking: 'leger' | 'normal' | 'fort';
  fadeIn: number;
  fadeOut: number;
  sfx: boolean;
  sfxVolume: number;
  ambience: boolean;
  pitch: number;
}

export interface CaptionSettings {
  style: CaptionStyle;
  font?: string;
  color: string;
  highlight?: string;
  size: number;
  position: 'haut' | 'milieu' | 'bas';
  animation: 'pop' | 'fondu' | 'glisse' | 'rebond' | 'machine';
  emphasis: boolean;
}

export type SceneRole = 'hook' | 'intro' | 'point' | 'twist' | 'proof' | 'compare' | 'story' | 'product' | 'cta';
export type SceneLayout = 'title' | 'number' | 'statement' | 'compare' | 'product' | 'cta' | 'quote' | 'character';

export interface SceneText {
  label?: string;
  title?: string;
  body?: string;
  number?: number;
  leftLabel?: string;
  left?: string;
  rightLabel?: string;
  right?: string;
  product?: {title: string; body: string};
  note?: string;
}

export interface VideoScene {
  role: SceneRole;
  layout: SceneLayout;
  /** Spoken text ('' when the format has no voice). */
  narration: string;
  /** Short texts shown on screen (never the whole narration: the captions carry it). */
  text: SceneText;
  /** Words to emphasise when they are spoken. */
  emphasis: string[];
  /** Stock / AI visual request for this scene (keywords, never a brand or a person). */
  visual: {mode: VisualMode; query?: string; prompt?: string};
  factIds: string[];
}

export interface VideoScript {
  format: VideoFormatId;
  duration: DurationTarget;
  language: string;
  title: string;
  hook: string;
  hookType: string;
  topic: string;
  topicLabel: string;
  structure: GenStructure;
  scenes: VideoScene[];
  caption: string;
  hashtags: string[];
  cta: string;
  factIds: string[];
  engine: string;
  model?: string;
  /** Planned word budget and the words actually written. */
  words: {target: number; actual: number};
  notes: string[];
}

/** Choices of one video, stored in slideshows.video_json. */
export interface VideoSpec {
  format: VideoFormatId;
  duration: DurationTarget;
  aspect: Aspect;
  profile: string;
  voice: {mode: VoiceMode; id: string; gender: 'female' | 'male'; speed: number; intonation: 'neutre' | 'expressive' | 'calme'; language: string; pitch?: number};
  visuals: VisualMode;
  music: {mode: 'original' | 'licence' | 'aucune'; mood: MusicMood; trackId?: string; candidates?: MusicMood[]};
  audio?: AudioSettings;
  captions?: CaptionSettings;
  template: string;
  transitions: Transition[];
  script: VideoScript;
  /** Filled by the production steps. */
  production?: VideoProduction;
}

export interface WordTiming {
  text: string;
  start: number;
  end: number;
}

export interface VoiceTrack {
  provider: string;
  voice: string;
  file: string;
  seconds: number;
  words: WordTiming[];
  /** Start / end of each scene's narration in the audio. */
  parts: Array<{start: number; end: number}>;
  /** Share of script words the transcriber did not hear as written (0 = perfect). */
  mismatch: number;
  costEur: number;
  assetId: string;
  warnings: string[];
}

export interface SceneVisual {
  kind: 'motion' | 'stock' | 'image' | 'ai';
  assetId?: string;
  file?: string;
  /** Stock / AI clips: the part of the clip used. */
  offset?: number;
  vertical?: boolean;
  fallbackFrom?: string;
}

export interface VideoProduction {
  voice?: VoiceTrack;
  visuals?: SceneVisual[];
  musicAssetId?: string;
  musicFile?: string;
  beats?: number[];
  steps: Record<string, {at: string; ms?: number; note?: string}>;
  notes: string[];
}

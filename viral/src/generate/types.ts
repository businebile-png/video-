import type {Format} from '../core/config.js';

export type SlideKind = 'cover' | 'content' | 'item' | 'compare' | 'quote' | 'cta' | 'image';

export interface Slide {
  kind: SlideKind;
  /** Short label above the title (« Étape 2 », « Erreur », « Exemple »). */
  label?: string;
  title?: string;
  body?: string;
  number?: number;
  /** compare slides */
  leftLabel?: string;
  left?: string;
  rightLabel?: string;
  right?: string;
  image?: {path: string; credit?: string; license?: string; alt?: string};
  /** Verified facts this slide relies on. */
  factIds?: string[];
  /** Small print under the slide (source, « exemple fictif »…). */
  note?: string;
  /** Product mention on the last slide (always backed by verified facts). */
  product?: {title: string; body: string};
}

export const STRUCTURES = ['liste', 'erreurs', 'etapes', 'mythe-realite', 'avant-apres', 'histoire', 'definition', 'faits'] as const;
export type GenStructure = (typeof STRUCTURES)[number];

export const STRUCTURE_LABELS: Record<GenStructure, string> = {
  liste: 'Liste de conseils',
  erreurs: 'Erreurs et corrections',
  etapes: 'Étapes (pas-à-pas)',
  'mythe-realite': 'Mythe / réalité',
  'avant-apres': 'Avant / après',
  histoire: 'Histoire (exemple fictif)',
  definition: 'Définition + points clés',
  faits: 'Faits vérifiés (produit)',
};

export const TONES = ['direct', 'bienveillant', 'expert', 'enthousiaste'] as const;
export type Tone = (typeof TONES)[number];

export interface GenerateRequest {
  accountId: string;
  niche?: string;
  /** Library topic id, or free text matched to the closest topic (the AI engine uses it as is). */
  topic?: string;
  slides?: number;
  /** Visual template id (style). */
  template?: string;
  structure?: GenStructure;
  format?: Format;
  tone?: Tone;
  language?: string;
  quantity: number;
  /** Idea only (no slides) or full slideshows. */
  mode?: 'ideas' | 'slideshows';
  /** "auto" (AI first, composer fallback), "ai" (AI only), "composer" (offline only). */
  engine?: 'auto' | 'ai' | 'composer';
  seed?: string;
  batchId?: string;
}

export interface SlideshowDraft {
  accountId: string;
  platform: string;
  topic: string;
  topicLabel: string;
  structure: GenStructure;
  hookType: string;
  hook: string;
  title: string;
  template: string;
  format: Format;
  tone: Tone;
  style: string;
  language: string;
  slides: Slide[];
  caption: string;
  hashtags: string[];
  cta: string;
  factIds: string[];
  engine: string;
  model?: string;
  predicted?: number;
  rationale?: string;
}

export interface IdeaDraft {
  accountId: string;
  topic: string;
  angle: string;
  hook: string;
  hookType: string;
  structure: GenStructure;
  template: string;
  format: Format;
  slides: number;
  tone: Tone;
  language: string;
  predicted: number;
  rationale: string;
  engine: string;
}

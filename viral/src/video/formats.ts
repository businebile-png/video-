import type {GenStructure} from '../generate/types.js';
import type {CaptionStyle, DurationTarget, MusicMood, Transition, VideoFormatId, VisualMode, VoiceMode} from './types.js';

/**
 * The video formats. Each one is a full template: script shape (structures, number of points, retention beats),
 * look (carousel template for fonts and colours + video effects), motion (transitions, pacing), sound
 * (music mood, voice or not) and default visuals. The account identity (accent colour, handle) always applies.
 */
export interface VideoFormatDef {
  id: VideoFormatId;
  label: string;
  description: string;
  structures: GenStructure[];
  /** Exact number of points (top 5 / top 10); otherwise chosen from the duration. */
  items?: number;
  voice: VoiceMode;
  visuals: VisualMode;
  music: MusicMood;
  /** Carousel template giving fonts and palette. */
  template: string;
  transitions: Transition[];
  durations: DurationTarget[];
  /** Fictional narrator on screen ('narrator') or story character ('story'). */
  character: 'narrator' | 'story' | null;
  captions: CaptionStyle;
  effects: {grain?: boolean; vignette?: boolean; letterbox?: boolean; particles?: boolean; grid?: boolean; paper?: boolean; lightLeak?: boolean; punch?: boolean};
  /** Speech speed multiplier for this format. */
  pace: number;
  /** Default B-roll keywords (objects and places only: no person can seem to recommend the product). */
  broll: string[];
}

export const VIDEO_FORMATS: Record<VideoFormatId, VideoFormatDef> = {
  storytelling: {
    id: 'storytelling',
    label: 'Storytelling',
    description: 'Une histoire fictive (signalée comme telle) : situation, problème, déclic, leçon.',
    structures: ['histoire', 'avant-apres'],
    voice: 'voix',
    visuals: 'stock',
    music: 'emotional',
    template: 'storytelling',
    transitions: ['depth', 'flip'],
    durations: [30, 45, 60, 90],
    character: 'story',
    captions: 'cinematique',
    effects: {grain: true, vignette: true, lightLeak: true},
    pace: 0.97,
    broll: ['desk night lamp', 'notebook writing', 'coffee window rain', 'laptop dark room', 'city street evening'],
  },
  educatif: {
    id: 'educatif',
    label: 'Éducatif',
    description: 'Une notion expliquée simplement, puis les étapes pour l’appliquer.',
    structures: ['etapes', 'definition', 'liste'],
    voice: 'voix',
    visuals: 'motion',
    music: 'chill',
    template: 'educatif',
    transitions: ['cube', 'swing'],
    durations: [30, 45, 60, 90],
    character: null,
    captions: 'tiktok',
    effects: {grid: true, particles: true},
    pace: 1,
    broll: ['laptop typing', 'notebook planning', 'whiteboard', 'desk top view'],
  },
  motivation: {
    id: 'motivation',
    label: 'Motivation',
    description: 'Rythme soutenu, phrases courtes, un passage à l’action concret (jamais de promesse de revenus).',
    structures: ['liste', 'erreurs'],
    voice: 'voix',
    visuals: 'stock',
    music: 'uplifting',
    template: 'motivation',
    transitions: ['cube', 'zoom', 'flip'],
    durations: [15, 30, 45],
    character: null,
    captions: 'mot',
    effects: {punch: true, vignette: true, particles: true},
    pace: 1.05,
    broll: ['sunrise city', 'running stairs', 'mountain road', 'clock time lapse', 'workspace morning'],
  },
  business: {
    id: 'business',
    label: 'Business',
    description: 'Erreurs, comparaisons et faits produit, ton expert et sobre.',
    structures: ['erreurs', 'mythe-realite', 'faits'],
    voice: 'voix',
    visuals: 'motion',
    music: 'corporate',
    template: 'business',
    transitions: ['swing', 'cube'],
    durations: [30, 45, 60],
    character: null,
    captions: 'phrase',
    effects: {grid: true},
    pace: 1,
    broll: ['office desk', 'charts screen', 'laptop meeting room', 'city skyline day'],
  },
  faits: {
    id: 'faits',
    label: 'Faits intéressants',
    description: '« Le savais-tu ? » : uniquement des faits vérifiés sur la page officielle.',
    structures: ['faits', 'definition'],
    voice: 'voix',
    visuals: 'motion',
    music: 'mysterious',
    template: 'curiosite',
    transitions: ['depth', 'flip'],
    durations: [15, 30, 45],
    character: null,
    captions: 'tiktok',
    effects: {particles: true, vignette: true},
    pace: 1,
    broll: ['abstract light', 'technology network', 'screen code', 'neon lights'],
  },
  top5: {
    id: 'top5',
    label: 'Top 5',
    description: 'Cinq points en compte à rebours, le plus utile à la fin.',
    structures: ['liste', 'erreurs', 'etapes'],
    items: 5,
    voice: 'voix',
    visuals: 'motion',
    music: 'driving',
    template: 'liste',
    transitions: ['cube', 'depth', 'whip'],
    durations: [30, 45, 60],
    character: null,
    captions: 'mot',
    effects: {particles: true},
    pace: 1.04,
    broll: ['laptop typing', 'phone notifications', 'desk top view'],
  },
  top10: {
    id: 'top10',
    label: 'Top 10',
    description: 'Dix points rapides en compte à rebours.',
    structures: ['liste', 'etapes', 'erreurs'],
    items: 10,
    voice: 'voix',
    visuals: 'motion',
    music: 'driving',
    template: 'liste',
    transitions: ['cube', 'whip', 'depth'],
    durations: [60, 90],
    character: null,
    captions: 'mot',
    effects: {particles: true},
    pace: 1.06,
    broll: ['laptop typing', 'notebook checklist'],
  },
  anecdotes: {
    id: 'anecdotes',
    label: 'Anecdotes',
    description: 'Une petite scène fictive racontée comme une anecdote, avec un personnage dessiné.',
    structures: ['histoire'],
    voice: 'voix',
    visuals: 'motion',
    music: 'playful',
    template: 'anecdotes',
    transitions: ['flip', 'swing'],
    durations: [30, 45, 60],
    character: 'story',
    captions: 'phrase',
    effects: {paper: true},
    pace: 1,
    broll: [],
  },
  documentaire: {
    id: 'documentaire',
    label: 'Documentaire court',
    description: 'Narration posée, images d’ambiance lentes, bandes cinéma et titres de chapitre.',
    structures: ['definition', 'etapes', 'histoire'],
    voice: 'voix',
    visuals: 'stock',
    music: 'documentary',
    template: 'luxe',
    transitions: ['depth', 'zoom'],
    durations: [45, 60, 90],
    character: null,
    captions: 'documentaire',
    effects: {letterbox: true, grain: true, vignette: true},
    pace: 0.95,
    broll: ['city aerial', 'office building', 'laptop dark room', 'train station', 'ocean waves', 'forest light'],
  },
  'voix-ia': {
    id: 'voix-ia',
    label: 'Voix IA (narrateur dessiné)',
    description: 'Un narrateur fictif dessiné parle face caméra ; ses lèvres suivent la voix de synthèse.',
    structures: ['liste', 'definition', 'etapes', 'erreurs'],
    voice: 'voix',
    visuals: 'motion',
    music: 'calm',
    template: 'minimaliste',
    transitions: ['swing', 'depth'],
    durations: [15, 30, 45, 60],
    character: 'narrator',
    captions: 'tiktok',
    effects: {particles: true},
    pace: 1,
    broll: [],
  },
  'sans-voix': {
    id: 'sans-voix',
    label: 'Sans voix (texte animé)',
    description: 'Typographie cinétique calée sur le rythme de la musique, lisible sans le son.',
    structures: ['liste', 'erreurs', 'mythe-realite', 'avant-apres', 'faits'],
    voice: 'aucune',
    visuals: 'motion',
    music: 'driving',
    template: 'avant-apres',
    transitions: ['cube', 'depth', 'flip', 'swing'],
    durations: [15, 30, 45],
    character: null,
    captions: 'kinetic',
    effects: {particles: true, punch: true},
    pace: 1,
    broll: [],
  },
  'images-animees': {
    id: 'images-animees',
    label: 'Images animées',
    description: 'Images fixes sous licence animées en profondeur (zoom lent, parallaxe, cadres en 3D).',
    structures: ['liste', 'etapes', 'definition', 'histoire'],
    voice: 'voix',
    visuals: 'images',
    music: 'warm',
    template: 'minimaliste',
    transitions: ['depth', 'swing', 'zoom'],
    durations: [30, 45, 60],
    character: null,
    captions: 'minimal',
    effects: {vignette: true},
    pace: 1,
    broll: ['notebook desk', 'laptop coffee', 'plant office', 'city window'],
  },
  'sequences-ia': {
    id: 'sequences-ia',
    label: 'Séquences générées par IA',
    description: 'Plans générés par un moteur vidéo IA (Veo, Runway) quand une clé existe ; sinon plans sous licence, signalé.',
    structures: ['histoire', 'definition', 'liste'],
    voice: 'voix',
    visuals: 'ai',
    music: 'cinematic',
    template: 'luxe',
    transitions: ['depth', 'zoom'],
    durations: [15, 30, 45],
    character: null,
    captions: 'cinematique',
    effects: {grain: true, vignette: true},
    pace: 1,
    broll: ['abstract light', 'city night', 'desk lamp'],
  },
};

export function formatDef(id: string): VideoFormatDef {
  const f = VIDEO_FORMATS[id as VideoFormatId];
  if (!f) throw new Error(`Format vidéo inconnu : ${id} (formats : ${Object.keys(VIDEO_FORMATS).join(', ')})`);
  return f;
}

/** Words spoken per second by the free French voices at speed 1 (measured on Claire after pacing, Siwis). */
export const WORDS_PER_SECOND = 2.55;

/** Word budget of a script: speech fills about 88 % of the video, the rest is the hook beat, pauses and the end card. */
export function wordBudget(duration: number, pace = 1): number {
  return Math.round(duration * 0.88 * WORDS_PER_SECOND * pace);
}

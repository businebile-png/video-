import type {ArtDirection} from '../schemas/timeline.js';

/**
 * Four distinct visual identities. Each video uses one, and the planner never repeats
 * the previous one, so the account does not look like the same template every day.
 * All fonts are OFL-licensed (bundled from @fontsource, no network at render time).
 */
export const ART_DIRECTIONS: ArtDirection[] = [
  {
    id: 'studio-nuit',
    label: 'Studio nuit — cinéma chaud, contrasté',
    palette: {
      accent: '#FFB547',
      accentInk: '#1A1206',
      ink: '#FFFFFF',
      muted: 'rgba(255,255,255,0.72)',
      panel: 'rgba(16,18,24,0.62)',
      panelBorder: 'rgba(255,255,255,0.14)',
      panelInk: '#FFFFFF',
      tint: '#0B3A4A',
      shade: 'rgba(5,8,12,0.55)',
    },
    fonts: {
      display: {family: 'Inter Tight', weight: 800},
      text: {family: 'Inter Tight', weight: 600},
      accent: {family: 'Instrument Serif', weight: 400, style: 'italic'},
      caption: {family: 'Inter Tight', weight: 800},
    },
    caption: {style: 'pop-highlight', size: 74, uppercase: false, maxWords: 4, maxChars: 22, strokePx: 0},
    headline: {size: 72, uppercase: false, letterSpacing: -1.5, style: 'serif-mix'},
    grade: {contrast: 1.08, saturate: 0.9, brightness: 0.97, tintOpacity: 0.22, vignette: 0.5, grain: 0.07},
    motion: {
      pacing: 'balanced',
      signature: 'whip-left',
      moves: ['push-in', 'drift-left', 'pull-out', 'drift-right', 'rise'],
      handheld: 3,
      riserBeforeCta: false,
    },
    card: {radius: 30, style: 'glass'},
    musicMoods: ['cinematic', 'ambient', 'warm', 'minimal'],
  },
  {
    id: 'clarte',
    label: 'Clarté SaaS — lumineux, net, bleu électrique',
    palette: {
      accent: '#3D6BFF',
      accentInk: '#FFFFFF',
      ink: '#FFFFFF',
      muted: 'rgba(255,255,255,0.8)',
      panel: 'rgba(255,255,255,0.94)',
      panelBorder: 'rgba(14,22,48,0.08)',
      panelInk: '#0E1630',
      tint: '#DCE6FF',
      shade: 'rgba(8,14,32,0.45)',
    },
    fonts: {
      display: {family: 'Manrope', weight: 800},
      text: {family: 'Manrope', weight: 600},
      accent: {family: 'Manrope', weight: 800},
      caption: {family: 'Manrope', weight: 800},
    },
    caption: {style: 'box-active', size: 72, uppercase: false, maxWords: 3, maxChars: 20, strokePx: 0},
    headline: {size: 68, uppercase: false, letterSpacing: -1, style: 'block'},
    grade: {contrast: 1.03, saturate: 1.04, brightness: 1.03, tintOpacity: 0.08, vignette: 0.22, grain: 0.03},
    motion: {
      pacing: 'balanced',
      signature: 'zoom-punch',
      moves: ['push-in', 'drift-right', 'hold', 'drift-left', 'pull-out'],
      handheld: 2,
      riserBeforeCta: false,
    },
    card: {radius: 26, style: 'solid'},
    musicMoods: ['corporate-light', 'uplifting', 'minimal', 'pop'],
  },
  {
    id: 'editorial',
    label: 'Éditorial — magazine, serif, grain argentique',
    palette: {
      accent: '#FF5A47',
      accentInk: '#FFFFFF',
      ink: '#FFF8F0',
      muted: 'rgba(255,248,240,0.75)',
      panel: 'rgba(24,18,14,0.55)',
      panelBorder: 'rgba(255,248,240,0.35)',
      panelInk: '#FFF8F0',
      tint: '#FFB070',
      shade: 'rgba(20,12,6,0.5)',
    },
    fonts: {
      display: {family: 'Fraunces', weight: 800},
      text: {family: 'Inter', weight: 600},
      accent: {family: 'Fraunces', weight: 700, style: 'italic'},
      caption: {family: 'Inter', weight: 800},
    },
    caption: {style: 'underline', size: 70, uppercase: false, maxWords: 4, maxChars: 22, strokePx: 0},
    headline: {size: 76, uppercase: false, letterSpacing: -1, style: 'serif-mix'},
    grade: {contrast: 1.06, saturate: 0.94, brightness: 0.99, tintOpacity: 0.12, vignette: 0.38, grain: 0.09},
    motion: {
      pacing: 'calm',
      signature: 'blur-dissolve',
      moves: ['push-in', 'rise', 'drift-right', 'pull-out'],
      handheld: 2,
      riserBeforeCta: false,
    },
    card: {radius: 8, style: 'outline'},
    musicMoods: ['lofi', 'acoustic', 'warm', 'minimal'],
  },
  {
    id: 'energie',
    label: 'Énergie — rythmé, contrasté, citron vert',
    palette: {
      accent: '#C8FF3D',
      accentInk: '#0B0B0B',
      ink: '#FFFFFF',
      muted: 'rgba(255,255,255,0.78)',
      panel: 'rgba(10,10,10,0.78)',
      panelBorder: 'rgba(200,255,61,0.35)',
      panelInk: '#FFFFFF',
      tint: '#101820',
      shade: 'rgba(0,0,0,0.5)',
    },
    fonts: {
      display: {family: 'Space Grotesk', weight: 700},
      text: {family: 'Space Grotesk', weight: 500},
      accent: {family: 'Space Grotesk', weight: 700},
      caption: {family: 'Space Grotesk', weight: 700},
    },
    caption: {style: 'box-active', size: 76, uppercase: true, maxWords: 3, maxChars: 18, strokePx: 0},
    headline: {size: 70, uppercase: true, letterSpacing: 0, style: 'label'},
    grade: {contrast: 1.12, saturate: 1.06, brightness: 0.98, tintOpacity: 0.15, vignette: 0.32, grain: 0.04},
    motion: {
      pacing: 'punchy',
      signature: 'zoom-punch',
      moves: ['push-in', 'drift-up', 'drift-left', 'pull-out', 'drift-right'],
      handheld: 3,
      riserBeforeCta: true,
    },
    card: {radius: 20, style: 'solid'},
    musicMoods: ['electronic', 'upbeat', 'driving', 'pop'],
  },
];

export function artDirection(id: string): ArtDirection {
  const ad = ART_DIRECTIONS.find((a) => a.id === id);
  if (!ad) throw new Error(`Direction artistique inconnue : ${id} (disponibles : ${ART_DIRECTIONS.map((a) => a.id).join(', ')})`);
  return ad;
}

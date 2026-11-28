import type {GenStructure} from '../generate/types.js';

/**
 * The 10 visual templates. Each one sets typography, layout and decoration; colours come from the account's
 * brand palette unless the template forces its own (luxe, motivation) — the account identity always keeps its
 * accent colour and handle. No template uses wealth imagery: "luxe" is a typographic style only.
 */
export interface TemplateDef {
  id: string;
  name: string;
  category: string;
  description: string;
  bestFor: GenStructure[];
  fonts: {heading: string; body: string};
  /** Palette overrides (null = use the brand palette). */
  palette: Partial<{bg: string; fg: string; accent: string; accent2: string; muted: string}> | null;
  /** Use a dark or light surface when the brand palette is overridden. */
  surface: 'brand' | 'dark' | 'light';
}

export const TEMPLATES: TemplateDef[] = [
  {
    id: 'minimaliste',
    name: 'Minimaliste',
    category: 'Sobre',
    description: 'Beaucoup d’air, une couleur d’accent, une idée par slide.',
    bestFor: ['liste', 'definition', 'faits', 'etapes'],
    fonts: {heading: 'Inter', body: 'Inter'},
    palette: null,
    surface: 'brand',
  },
  {
    id: 'storytelling',
    name: 'Storytelling',
    category: 'Récit',
    description: 'Titres à empattements, chapitres numérotés, ton narratif.',
    bestFor: ['histoire', 'avant-apres', 'mythe-realite'],
    fonts: {heading: 'Playfair Display', body: 'Lora'},
    palette: {bg: '#1E1A17', fg: '#F6EFE6', muted: '#BFB3A5'},
    surface: 'dark',
  },
  {
    id: 'educatif',
    name: 'Éducatif',
    category: 'Pédagogie',
    description: 'Numérotation forte, encadré « à retenir », progression visible.',
    bestFor: ['etapes', 'definition', 'liste', 'erreurs'],
    fonts: {heading: 'Space Grotesk', body: 'Inter'},
    palette: null,
    surface: 'brand',
  },
  {
    id: 'luxe',
    name: 'Luxe (élégant)',
    category: 'Premium',
    description: 'Noir profond, filets dorés, capitales espacées. Style typographique, aucune image de richesse.',
    bestFor: ['faits', 'definition', 'liste', 'mythe-realite'],
    fonts: {heading: 'DM Serif Display', body: 'Montserrat'},
    palette: {bg: '#0B0B0C', fg: '#F3EFE7', accent: '#C9A45C', accent2: '#E6D3A3', muted: '#9C968C'},
    surface: 'dark',
  },
  {
    id: 'business',
    name: 'Business',
    category: 'Professionnel',
    description: 'Grille nette, bandeau de titre, encadrés chiffrés.',
    bestFor: ['faits', 'etapes', 'liste', 'erreurs'],
    fonts: {heading: 'Montserrat', body: 'Inter'},
    palette: {bg: '#0F1B2D', fg: '#F4F7FB', muted: '#A9B6C8'},
    surface: 'dark',
  },
  {
    id: 'motivation',
    name: 'Motivation',
    category: 'Énergie',
    description: 'Dégradé vif, grosses lettres condensées, phrases courtes. Jamais de promesse de gain.',
    bestFor: ['mythe-realite', 'liste', 'erreurs'],
    fonts: {heading: 'Anton', body: 'Inter'},
    palette: {bg: '#1A0E2E', fg: '#FFFFFF', muted: '#E5DAF7'},
    surface: 'dark',
  },
  {
    id: 'curiosite',
    name: 'Curiosité',
    category: 'Accroche',
    description: 'Fond sombre, accent néon, révélation slide après slide.',
    bestFor: ['mythe-realite', 'erreurs', 'definition', 'faits'],
    fonts: {heading: 'Archivo Black', body: 'Inter'},
    palette: {bg: '#0B0D12', fg: '#F2F4F8', muted: '#9AA3B2'},
    surface: 'dark',
  },
  {
    id: 'liste',
    name: 'Liste et classement',
    category: 'Classement',
    description: 'Gros numéros, un point par slide, rythme régulier.',
    bestFor: ['liste', 'erreurs', 'faits', 'etapes'],
    fonts: {heading: 'Poppins', body: 'Poppins'},
    palette: null,
    surface: 'brand',
  },
  {
    id: 'avant-apres',
    name: 'Avant / après',
    category: 'Comparaison',
    description: 'Deux colonnes contrastées : avant en retrait, après mis en valeur.',
    bestFor: ['avant-apres', 'mythe-realite', 'erreurs'],
    fonts: {heading: 'Montserrat', body: 'Inter'},
    palette: null,
    surface: 'brand',
  },
  {
    id: 'anecdotes',
    name: 'Anecdotes',
    category: 'Carnet',
    description: 'Papier crème, écriture manuscrite pour les titres, ton complice.',
    bestFor: ['histoire', 'liste', 'definition'],
    fonts: {heading: 'Caveat', body: 'Lora'},
    palette: {bg: '#FBF6EA', fg: '#2B2620', muted: '#7A6F60'},
    surface: 'light',
  },
];

export const TEMPLATE_IDS = TEMPLATES.map((t) => t.id);

export function templateById(id: string): TemplateDef {
  const t = TEMPLATES.find((x) => x.id === id);
  if (!t) throw new Error(`Modèle inconnu : ${id} (disponibles : ${TEMPLATE_IDS.join(', ')})`);
  return t;
}

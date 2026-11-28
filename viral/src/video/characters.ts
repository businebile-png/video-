import {rng} from '../core/util.js';

/**
 * Fictional characters drawn in SVG from a seed (skin, hair, clothes, glasses), never a real person.
 * The mouth (`#mouth`) and eyelids (`.lid`) are driven by the video timeline: lips follow the voice loudness.
 * A story that shows a character always says « Personnage fictif » on screen.
 */

const SKIN = ['#F3CDB0', '#E4B08C', '#C98E62', '#9C6644', '#6E4630', '#F8DCC8'];
const HAIR = ['#1E1A17', '#3F2A1D', '#7A4E2D', '#B58B5E', '#2E2E33', '#5B3423'];
const FEMALE_NAMES = ['Léa', 'Inès', 'Camille', 'Sarah', 'Julie', 'Nora', 'Emma', 'Lina', 'Chloé', 'Manon'];
const MALE_NAMES = ['Hugo', 'Lucas', 'Karim', 'Théo', 'Yanis', 'Paul', 'Malik', 'Antoine', 'Nathan', 'Sami'];

export interface Character {
  svg: string;
  name: string;
  gender: 'female' | 'male';
}

/** First name already used by a story (« Paul, 34 ans, … »), so the drawing matches the text. */
export function nameInText(text: string): {name: string; gender: 'female' | 'male'} | null {
  for (const n of FEMALE_NAMES) if (new RegExp(`\\b${n}\\b`).test(text)) return {name: n, gender: 'female'};
  for (const n of MALE_NAMES) if (new RegExp(`\\b${n}\\b`).test(text)) return {name: n, gender: 'male'};
  return null;
}

export function drawCharacter(seed: string, opts: {gender?: 'female' | 'male'; name?: string; shirt: string; accent: string; outline?: string}): Character {
  const r = rng(seed);
  const gender = opts.gender ?? (r() < 0.5 ? 'female' : 'male');
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const name = opts.name ?? pick(gender === 'female' ? FEMALE_NAMES : MALE_NAMES);
  const skin = pick(SKIN);
  const hair = pick(HAIR);
  const glasses = r() < 0.3;
  const style = gender === 'female' ? pick(['long', 'bob', 'bun', 'curly']) : pick(['short', 'buzz', 'curly', 'quiff']);
  const line = opts.outline ?? 'rgba(0,0,0,.18)';
  const shade = 'rgba(0,0,0,.10)';
  const back: Record<string, string> = {
    long: `<path d="M118 170 Q112 330 140 392 L260 392 Q288 330 282 170 Z" fill="${hair}"/>`,
    bob: `<path d="M120 168 Q114 262 142 292 L258 292 Q286 262 280 168 Z" fill="${hair}"/>`,
    bun: `<circle cx="200" cy="74" r="40" fill="${hair}"/>`,
    curly: `<g fill="${hair}">${Array.from({length: 11}, (_, i) => `<circle cx="${130 + (i % 6) * 28}" cy="${118 + Math.floor(i / 6) * 34 + (i % 2) * 8}" r="30"/>`).join('')}</g>`,
    short: '',
    buzz: '',
    quiff: '',
  };
  const front: Record<string, string> = {
    long: `<path d="M126 176 Q140 96 200 92 Q262 96 274 176 Q246 132 200 128 Q160 130 126 176 Z" fill="${hair}"/>`,
    bob: `<path d="M124 182 Q134 94 200 90 Q268 94 276 182 Q250 128 196 132 Q150 136 124 182 Z" fill="${hair}"/>`,
    bun: `<path d="M128 176 Q138 98 200 94 Q264 98 272 176 Q244 126 200 124 Q158 126 128 176 Z" fill="${hair}"/>`,
    curly: `<path d="M128 170 Q142 104 200 100 Q260 104 272 170 Q244 140 200 136 Q158 138 128 170 Z" fill="${hair}"/>`,
    short: `<path d="M130 168 Q136 100 200 96 Q266 100 270 168 Q250 132 214 128 Q170 124 130 168 Z" fill="${hair}"/>`,
    buzz: `<path d="M134 160 Q142 108 200 104 Q258 108 266 160 Q232 128 200 128 Q168 128 134 160 Z" fill="${hair}" opacity=".85"/>`,
    quiff: `<path d="M130 166 Q130 96 196 84 Q250 78 272 128 Q268 150 268 166 Q248 124 208 122 Q168 122 130 166 Z" fill="${hair}"/>`,
  };
  const svg = `<svg class="character" viewBox="0 0 400 480" xmlns="http://www.w3.org/2000/svg" aria-label="${name}, personnage fictif">
  <g class="char-body">
    ${back[style]}
    <path d="M70 480 Q76 392 150 370 L250 370 Q324 392 330 480 Z" fill="${opts.shirt}" stroke="${line}" stroke-width="3"/>
    <path d="M170 368 L200 410 L230 368 Z" fill="${skin}"/>
    <path d="M150 372 L200 414 L250 372" fill="none" stroke="${opts.accent}" stroke-width="7" stroke-linecap="round"/>
    <rect x="176" y="318" width="48" height="60" rx="18" fill="${skin}"/>
    <rect x="176" y="330" width="48" height="16" fill="${shade}"/>
    <g class="char-head">
      <ellipse cx="128" cy="228" rx="16" ry="24" fill="${skin}" stroke="${line}" stroke-width="2"/>
      <ellipse cx="272" cy="228" rx="16" ry="24" fill="${skin}" stroke="${line}" stroke-width="2"/>
      <rect x="128" y="116" width="144" height="214" rx="72" fill="${skin}" stroke="${line}" stroke-width="3"/>
      <ellipse cx="158" cy="262" rx="15" ry="9" fill="#FF7A7A" opacity=".22"/>
      <ellipse cx="242" cy="262" rx="15" ry="9" fill="#FF7A7A" opacity=".22"/>
      <g class="eyes">
        <ellipse cx="170" cy="222" rx="9" ry="11" fill="#1E1A17"/>
        <ellipse cx="230" cy="222" rx="9" ry="11" fill="#1E1A17"/>
        <circle cx="173" cy="218" r="3" fill="#fff"/>
        <circle cx="233" cy="218" r="3" fill="#fff"/>
        <rect class="lid" x="158" y="206" width="24" height="0" fill="${skin}"/>
        <rect class="lid" x="218" y="206" width="24" height="0" fill="${skin}"/>
      </g>
      <path d="M154 198 Q170 188 186 196" fill="none" stroke="${hair}" stroke-width="6" stroke-linecap="round"/>
      <path d="M214 196 Q230 188 246 198" fill="none" stroke="${hair}" stroke-width="6" stroke-linecap="round"/>
      <path d="M200 232 Q194 254 202 258" fill="none" stroke="${line}" stroke-width="3" stroke-linecap="round"/>
      <ellipse id="mouth" cx="200" cy="286" rx="20" ry="3" fill="#7A2E2E"/>
      <path d="M182 284 Q200 292 218 284" fill="none" stroke="#7A2E2E" stroke-width="3" stroke-linecap="round" class="smile"/>
      ${glasses ? `<g fill="none" stroke="#1E1A17" stroke-width="4"><circle cx="170" cy="222" r="22"/><circle cx="230" cy="222" r="22"/><path d="M192 220 Q200 214 208 220"/></g>` : ''}
      ${front[style]}
    </g>
  </g>
</svg>`;
  return {svg, name, gender};
}

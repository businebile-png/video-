import fs from 'node:fs';
import {nodeModule} from '../core/paths.js';

/** Open-licence fonts (SIL OFL) shipped with @fontsource packages, loaded from disk by the renderer. */
const FAMILIES: Record<string, {pkg: string; file: string}> = {
  Inter: {pkg: 'inter', file: 'inter'},
  'Space Grotesk': {pkg: 'space-grotesk', file: 'space-grotesk'},
  'Playfair Display': {pkg: 'playfair-display', file: 'playfair-display'},
  Lora: {pkg: 'lora', file: 'lora'},
  'DM Serif Display': {pkg: 'dm-serif-display', file: 'dm-serif-display'},
  Montserrat: {pkg: 'montserrat', file: 'montserrat'},
  Anton: {pkg: 'anton', file: 'anton'},
  'Archivo Black': {pkg: 'archivo-black', file: 'archivo-black'},
  Poppins: {pkg: 'poppins', file: 'poppins'},
  Caveat: {pkg: 'caveat', file: 'caveat'},
};

export const FONT_FAMILIES = Object.keys(FAMILIES);

export function fontFaceCss(families: string[]): string {
  const out: string[] = [];
  for (const fam of [...new Set(families)]) {
    const f = FAMILIES[fam];
    if (!f) continue;
    for (const w of [400, 500, 600, 700, 800, 900]) {
      for (const subset of ['latin', 'latin-ext']) {
        const file = nodeModule('@fontsource', f.pkg, 'files', `${f.file}-${subset}-${w}-normal.woff2`);
        if (!fs.existsSync(file)) continue;
        const range = subset === 'latin' ? 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD' : 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF';
        out.push(`@font-face{font-family:'${fam}';font-style:normal;font-weight:${w};font-display:block;src:url('file://${file}') format('woff2');unicode-range:${range};}`);
      }
    }
  }
  return out.join('\n');
}

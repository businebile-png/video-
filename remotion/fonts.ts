import {loadFont} from '@remotion/fonts';
// All fonts ship with the repo's npm dependencies (SIL Open Font License): no network at render time.
import interTight600 from '@fontsource/inter-tight/files/inter-tight-latin-600-normal.woff2';
import interTight800 from '@fontsource/inter-tight/files/inter-tight-latin-800-normal.woff2';
import instrumentItalic from '@fontsource/instrument-serif/files/instrument-serif-latin-400-italic.woff2';
import manrope600 from '@fontsource/manrope/files/manrope-latin-600-normal.woff2';
import manrope800 from '@fontsource/manrope/files/manrope-latin-800-normal.woff2';
import fraunces700i from '@fontsource/fraunces/files/fraunces-latin-700-italic.woff2';
import fraunces800 from '@fontsource/fraunces/files/fraunces-latin-800-normal.woff2';
import inter600 from '@fontsource/inter/files/inter-latin-600-normal.woff2';
import inter800 from '@fontsource/inter/files/inter-latin-800-normal.woff2';
import grotesk500 from '@fontsource/space-grotesk/files/space-grotesk-latin-500-normal.woff2';
import grotesk700 from '@fontsource/space-grotesk/files/space-grotesk-latin-700-normal.woff2';

const FONTS: Array<{family: string; weight: string; style: string; url: string}> = [
  {family: 'Inter Tight', weight: '600', style: 'normal', url: interTight600},
  {family: 'Inter Tight', weight: '800', style: 'normal', url: interTight800},
  {family: 'Instrument Serif', weight: '400', style: 'italic', url: instrumentItalic},
  {family: 'Manrope', weight: '600', style: 'normal', url: manrope600},
  {family: 'Manrope', weight: '800', style: 'normal', url: manrope800},
  {family: 'Fraunces', weight: '700', style: 'italic', url: fraunces700i},
  {family: 'Fraunces', weight: '800', style: 'normal', url: fraunces800},
  {family: 'Inter', weight: '600', style: 'normal', url: inter600},
  {family: 'Inter', weight: '800', style: 'normal', url: inter800},
  {family: 'Space Grotesk', weight: '500', style: 'normal', url: grotesk500},
  {family: 'Space Grotesk', weight: '700', style: 'normal', url: grotesk700},
];

for (const f of FONTS) {
  // loadFont blocks rendering (delayRender) until the face is ready.
  void loadFont({family: f.family, url: f.url, weight: f.weight, style: f.style, display: 'block'});
}

export const fontStack = (family: string) => `"${family}", "Inter", system-ui, sans-serif`;

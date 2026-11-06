import React from 'react';
import {AbsoluteFill, Img, staticFile, useCurrentFrame} from 'remotion';
import type {ArtDirection} from '../../src/schemas/timeline';

/** Film grain: 8 pre-rendered noise plates cycled per frame (cheap, organic, no per-frame SVG filter). */
const Grain: React.FC<{amount: number}> = ({amount}) => {
  const frame = useCurrentFrame();
  if (amount <= 0) return null;
  return (
    <AbsoluteFill style={{opacity: amount, mixBlendMode: 'overlay'}}>
      <Img src={staticFile(`grain-${frame % 8}.png`)} style={{width: 1080, height: 1920}} />
    </AbsoluteFill>
  );
};

/** Shared look applied above the footage: tint, vignette, UI-legibility gradients, grain. */
export const Grade: React.FC<{ad: ArtDirection}> = ({ad}) => {
  const {grade, palette} = ad;
  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      <AbsoluteFill style={{background: palette.tint, mixBlendMode: 'soft-light', opacity: grade.tintOpacity}} />
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 80% 62% at 50% 46%, rgba(0,0,0,0) 52%, rgba(0,0,0,${grade.vignette}) 100%)`,
        }}
      />
      <AbsoluteFill
        style={{
          background:
            // Eased ramps (no sudden change of slope): a linear start reads as a visible line on flat, bright footage.
            'linear-gradient(180deg, rgba(0,0,0,0.48) 0%, rgba(0,0,0,0.36) 9%, rgba(0,0,0,0.22) 17%, rgba(0,0,0,0.1) 25%, rgba(0,0,0,0.03) 31%, rgba(0,0,0,0) 36%, rgba(0,0,0,0) 48%, rgba(0,0,0,0.03) 55%, rgba(0,0,0,0.1) 62%, rgba(0,0,0,0.22) 70%, rgba(0,0,0,0.38) 80%, rgba(0,0,0,0.5) 90%, rgba(0,0,0,0.56) 100%)',
        }}
      />
      <Grain amount={grade.grain} />
    </AbsoluteFill>
  );
};

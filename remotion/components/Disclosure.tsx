import React from 'react';
import {interpolate, useCurrentFrame} from 'remotion';
import type {ArtDirection} from '../../src/schemas/timeline';
import {clamp} from '../lib/anim';

/**
 * Legal disclosure ("Publicité"), visible from the first to the last frame
 * (French law 2023-451 requires it for the whole duration of the promotion).
 */
export const Disclosure: React.FC<{text: string; ad: ArtDirection}> = ({text, ad}) => {
  const frame = useCurrentFrame();
  const appear = interpolate(frame, [0, 4], [0.85, 1], clamp);
  return (
    <div
      style={{
        position: 'absolute',
        left: 56,
        top: 226,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 22px 11px 18px',
        borderRadius: 999,
        background: 'rgba(0,0,0,0.5)',
        border: '1px solid rgba(255,255,255,0.24)',
        color: '#FFFFFF',
        fontFamily: '"Inter", system-ui, sans-serif',
        fontWeight: 600,
        fontSize: 32,
        letterSpacing: 0.2,
        opacity: appear,
      }}
    >
      <div style={{width: 10, height: 10, borderRadius: 5, background: ad.palette.accent}} />
      {text}
    </div>
  );
};

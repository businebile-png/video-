import React from 'react';
import {interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import type {ArtDirection, HeadlineItem} from '../../src/schemas/timeline';
import {clamp} from '../lib/anim';
import {fontStack} from '../fonts';

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

/** Short kinetic label at the top: each word rises out of a mask, emphasis words switch font/colour. */
export const Headline: React.FC<{item: HeadlineItem; ad: ArtDirection}> = ({item, ad}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const emph = new Set(item.emphasis.flatMap((e) => e.split(/\s+/)).map(norm).filter((t) => t.length >= 3));
  const words = item.text.split(/\s+/);
  const exit = interpolate(frame, [item.duration - 8, item.duration], [1, 0], clamp);
  const lift = interpolate(frame, [item.duration - 8, item.duration], [0, -14], clamp);
  const {headline, palette, fonts} = ad;
  const isLabel = headline.style === 'label';
  // The label band wipes in with its words: never an empty coloured band on screen.
  // The video's first headline is already complete on image 0: the hook reads before anything moves.
  const instant = item.from === 0;
  const wipe = isLabel && !instant ? Math.min(1, spring({frame, fps, config: {damping: 26, stiffness: 260, mass: 0.6}})) : 1;
  return (
    <div
      style={{
        position: 'absolute',
        left: 70,
        width: 860,
        top: 318,
        opacity: exit,
        transform: `translateY(${lift}px)`,
        textAlign: isLabel ? 'left' : 'center',
      }}
    >
      <div
        style={{
          display: 'inline-block',
          fontFamily: fontStack(fonts.display.family),
          fontWeight: fonts.display.weight,
          fontSize: headline.size,
          lineHeight: 1.06,
          letterSpacing: headline.letterSpacing,
          textTransform: headline.uppercase ? 'uppercase' : 'none',
          color: isLabel ? palette.accentInk : palette.ink,
          background: isLabel ? palette.accent : 'transparent',
          padding: isLabel ? '10px 22px 14px' : 0,
          borderRadius: isLabel ? 12 : 0,
          textShadow: isLabel ? 'none' : '0 4px 28px rgba(0,0,0,0.55), 0 1px 3px rgba(0,0,0,0.5)',
          textWrap: 'balance',
          clipPath: isLabel ? `inset(0 ${((1 - wipe) * 100).toFixed(2)}% 0 0 round 12px)` : undefined,
        }}
      >
        {words.map((w, i) => {
          const s = instant ? 1 : spring({frame: frame - i * 2, fps, config: {damping: 22, stiffness: 200, mass: 0.7}});
          const isEmph = emph.has(norm(w));
          const serif = headline.style === 'serif-mix' && isEmph;
          const boxed = headline.style === 'block' && isEmph;
          return (
            <span key={i} style={{display: 'inline-block', overflow: 'hidden', verticalAlign: 'bottom', margin: '0 0.12em', paddingBottom: '0.08em'}}>
              <span
                style={{
                  display: 'inline-block',
                  transform: `translateY(${(1 - s) * 105}%)`,
                  color: boxed ? palette.accentInk : isEmph && !isLabel ? palette.accent : undefined,
                  background: boxed ? palette.accent : undefined,
                  padding: boxed ? '0 0.16em' : undefined,
                  borderRadius: boxed ? 10 : undefined,
                  textShadow: boxed ? 'none' : undefined,
                  fontFamily: serif ? fontStack(fonts.accent.family) : undefined,
                  fontStyle: serif ? fonts.accent.style ?? 'normal' : undefined,
                  fontWeight: serif ? fonts.accent.weight : undefined,
                  fontSize: serif ? headline.size * 1.12 : undefined,
                }}
              >
                {w}
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
};

import React from 'react';
import {interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import type {ArtDirection, CaptionGroup, CaptionWord} from '../../src/schemas/timeline';
import {clamp} from '../lib/anim';
import {fontStack} from '../fonts';

const Word: React.FC<{w: CaptionWord; ad: ArtDirection; frame: number; fps: number}> = ({w, ad, frame, fps}) => {
  const active = frame >= w.from && frame < Math.max(w.to, w.from + 4);
  const spoken = frame >= w.from;
  const on = spring({frame: frame - w.from, fps, config: {damping: 16, stiffness: 260, mass: 0.5}});
  const {palette, caption} = ad;
  const base: React.CSSProperties = {
    display: 'inline-block',
    margin: '0 0.04em',
    position: 'relative',
    whiteSpace: 'nowrap',
  };
  const accentWord = w.emphasis && spoken;
  switch (caption.style) {
    case 'pop-highlight':
      return (
        <span
          style={{
            ...base,
            color: active || accentWord ? palette.accent : palette.ink,
            transform: `scale(${active ? 1 + 0.045 * on : 1})`,
          }}
        >
          {w.text}
        </span>
      );
    case 'box-active':
      return (
        <span
          style={{
            ...base,
            color: active ? palette.accentInk : accentWord ? palette.accent : palette.ink,
            background: active ? palette.accent : 'transparent',
            borderRadius: 14,
            padding: '0 0.13em',
            transform: `scale(${active ? 0.96 + 0.06 * on : 1}) rotate(${active ? -1.2 : 0}deg)`,
            textShadow: active ? 'none' : undefined,
          }}
        >
          {w.text}
        </span>
      );
    case 'underline':
      return (
        <span style={{...base, color: accentWord ? palette.accent : palette.ink}}>
          {w.text}
          <span
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: -4,
              height: 9,
              borderRadius: 5,
              background: palette.accent,
              transformOrigin: 'left center',
              transform: `scaleX(${active ? on : 0})`,
            }}
          />
        </span>
      );
    case 'karaoke-fill':
    default:
      return <span style={{...base, color: accentWord ? palette.accent : palette.ink, opacity: spoken ? 1 : 0.45}}>{w.text}</span>;
  }
};

/** Word-accurate captions (timings come from the voice alignment), always inside the safe area. */
export const Captions: React.FC<{groups: CaptionGroup[]; ad: ArtDirection}> = ({groups, ad}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const group = groups.find((g) => frame >= g.from && frame < g.to);
  if (!group) return null;
  const local = frame - group.from;
  const enter = spring({frame: local, fps, config: {damping: 20, stiffness: 320, mass: 0.6}});
  const exit = interpolate(frame, [group.to - 3, group.to], [1, 0.0], clamp);
  return (
    <div
      style={{
        position: 'absolute',
        left: 70,
        width: 860,
        top: group.y,
        transform: `translateY(-50%) translateY(${(1 - enter) * 16}px) scale(${0.97 + 0.03 * enter})`,
        opacity: Math.min(enter * 1.4, 1) * exit,
        textAlign: 'center',
        fontFamily: fontStack(ad.fonts.caption.family),
        fontWeight: ad.fonts.caption.weight,
        fontSize: ad.caption.size,
        lineHeight: 1.12,
        letterSpacing: ad.caption.uppercase ? 0.5 : -0.6,
        textTransform: ad.caption.uppercase ? 'uppercase' : 'none',
        textShadow: '0 3px 18px rgba(0,0,0,0.55), 0 1px 3px rgba(0,0,0,0.65)',
        textWrap: 'balance',
      }}
    >
      {group.words.map((w, i) => (
        <React.Fragment key={`${group.from}-${i}`}>
          {i > 0 ? ' ' : null}
          <Word w={w} ad={ad} frame={frame} fps={fps} />
        </React.Fragment>
      ))}
    </div>
  );
};

import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import type {ArtDirection, EndCard as EndCardData} from '../../src/schemas/timeline';
import {clamp, pop} from '../lib/anim';
import {fontStack} from '../fonts';

/** Closing call to action over dimmed footage: what to do, where (bio), and why. */
export const EndCard: React.FC<{card: EndCardData; ad: ArtDirection}> = ({card, ad}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const shade = interpolate(frame, [0, 10], [0, 1], clamp);
  const k = pop(frame, fps, 2);
  const h = pop(frame, fps, 6);
  const sub = pop(frame, fps, 12);
  const cta = pop(frame, fps, 10);
  const bounce = Math.sin(Math.max(0, frame - 24) / 7) * 6;
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{background: ad.palette.shade, opacity: shade}} />
      <div
        style={{
          position: 'absolute',
          left: 70,
          width: 860,
          top: 640,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          gap: 30,
          color: ad.palette.ink,
        }}
      >
        <div
          style={{
            fontFamily: fontStack(ad.fonts.text.family),
            fontWeight: 700,
            fontSize: 34,
            letterSpacing: 6,
            textTransform: 'uppercase',
            color: ad.palette.accent,
            opacity: k,
            transform: `translateY(${(1 - k) * 12}px)`,
          }}
        >
          {card.kicker}
        </div>
        <div
          style={{
            fontFamily: fontStack(ad.fonts.display.family),
            fontWeight: ad.fonts.display.weight,
            fontSize: 98,
            lineHeight: 1.03,
            letterSpacing: -1.5,
            textWrap: 'balance',
            textShadow: '0 6px 30px rgba(0,0,0,0.45)',
            opacity: h,
            transform: `translateY(${(1 - h) * 24}px)`,
          }}
        >
          {card.headline}
        </div>
        <div
          style={{
            fontFamily: fontStack(ad.fonts.text.family),
            fontWeight: ad.fonts.text.weight,
            fontSize: 44,
            lineHeight: 1.25,
            color: ad.palette.muted,
            opacity: sub,
            textWrap: 'balance',
          }}
        >
          {card.subline}
        </div>
        {card.verifiedOn ? (
          <div style={{fontFamily: fontStack(ad.fonts.text.family), fontWeight: 600, fontSize: 28, color: ad.palette.muted, opacity: sub * 0.85}}>
            {`Prix vérifiés sur systeme.io le ${card.verifiedOn.slice(8, 10)}/${card.verifiedOn.slice(5, 7)}/${card.verifiedOn.slice(0, 4)}`}
          </div>
        ) : null}
        <div
          style={{
            marginTop: 16,
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            padding: '26px 52px',
            borderRadius: 999,
            background: ad.palette.accent,
            color: ad.palette.accentInk,
            fontFamily: fontStack(ad.fonts.display.family),
            fontWeight: ad.fonts.display.weight,
            fontSize: 54,
            opacity: cta,
            transform: `scale(${0.85 + 0.15 * cta}) translateY(${bounce * 0.3}px)`,
          }}
        >
          {card.cta}
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          left: 70,
          width: 860,
          top: 1380,
          textAlign: 'center',
          fontFamily: fontStack(ad.fonts.text.family),
          fontWeight: 600,
          fontSize: 31,
          color: ad.palette.muted,
          opacity: sub,
        }}
      >
        {card.disclosure}
      </div>
    </AbsoluteFill>
  );
};

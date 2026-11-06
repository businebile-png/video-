import React from 'react';
import {AbsoluteFill, Img, OffthreadVideo, interpolate, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import type {ArtDirection, CaptureShot, Region} from '../../src/schemas/timeline';
import {clamp, easeInOut, pop} from '../lib/anim';
import {fontStack} from '../fonts';

const CARD_W = 940;
const CARD_MAX_H = 780;
const CARD_TOP = 420;
const BAR_H = 44;

/** Interpolated focus region at a frame (null = full view). */
function focusAt(shot: CaptureShot, frame: number): Region {
  const full: Region = {x: 0, y: 0, w: 1, h: 1};
  const kfs = shot.keyframes;
  let prev = kfs[0]!;
  for (let i = 1; i < kfs.length; i++) {
    const next = kfs[i]!;
    if (frame < next.at) {
      const start = next.at - 18;
      if (frame <= start) return prev.focus ?? full;
      const t = easeInOut(interpolate(frame, [start, next.at], [0, 1], clamp));
      const a = prev.focus ?? full;
      const b = next.focus ?? full;
      return {x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, w: a.w + (b.w - a.w) * t, h: a.h + (b.h - a.h) * t};
    }
    prev = next;
  }
  return prev.focus ?? full;
}

/**
 * A real Systeme.io capture (recording or screenshot) presented in a neutral window frame.
 * The camera glides to the regions named in the script; nothing inside the capture is redrawn.
 */
export const CaptureShotView: React.FC<{shot: CaptureShot; ad: ArtDirection}> = ({shot, ad}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const aspect = shot.height / shot.width;
  const contentH = Math.min(CARD_MAX_H - BAR_H, CARD_W * aspect);
  const contentW = contentH / aspect;
  const cardW = Math.min(CARD_W, contentW);
  const cardH = contentH + BAR_H;
  const left = (1080 - cardW) / 2;

  const f = focusAt(shot, frame);
  // Zoom so the focus region fills ~86% of the visible window, without exposing outside the capture.
  const zoom = Math.min(3.2, Math.max(1, 0.86 / Math.max(f.w, f.h)));
  const cx = (f.x + f.w / 2) * contentW;
  const cy = (f.y + f.h / 2) * contentH;
  let tx = contentW / 2 - cx * zoom;
  let ty = contentH / 2 - cy * zoom;
  tx = Math.min(0, Math.max(contentW - contentW * zoom, tx));
  ty = Math.min(0, Math.max(contentH - contentH * zoom, ty));

  const enter = pop(frame, fps);
  const cardScale = 0.94 + 0.06 * enter;
  const isVideo = shot.mediaType === 'video';
  const media = isVideo ? (
    <OffthreadVideo src={staticFile(shot.src)} muted style={{width: contentW, height: contentH}} />
  ) : (
    <Img src={staticFile(shot.src)} style={{width: contentW, height: contentH}} />
  );

  return (
    <AbsoluteFill>
      {shot.backgroundSrc ? (
        <AbsoluteFill style={{filter: 'brightness(0.5) saturate(0.9)'}}>
          <OffthreadVideo src={staticFile(shot.backgroundSrc)} muted style={{width: '100%', height: '100%', objectFit: 'cover'}} />
        </AbsoluteFill>
      ) : (
        <AbsoluteFill style={{background: `radial-gradient(120% 80% at 50% 30%, ${ad.palette.tint} 0%, #07090d 70%)`}} />
      )}
      <div
        style={{
          position: 'absolute',
          left,
          top: CARD_TOP,
          width: cardW,
          height: cardH,
          borderRadius: Math.min(28, ad.card.radius + 6),
          overflow: 'hidden',
          background: '#0d0f14',
          boxShadow: '0 40px 90px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.08)',
          transform: `translateY(${(1 - enter) * 40}px) scale(${cardScale})`,
          opacity: interpolate(frame, [0, 6], [0, 1], clamp),
        }}
      >
        <div style={{height: BAR_H, display: 'flex', alignItems: 'center', gap: 10, paddingLeft: 18, background: '#1a1d24'}}>
          {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
            <div key={c} style={{width: 13, height: 13, borderRadius: 7, background: c, opacity: 0.85}} />
          ))}
        </div>
        <div style={{position: 'relative', width: contentW, height: contentH, overflow: 'hidden'}}>
          <div style={{position: 'absolute', left: 0, top: 0, transformOrigin: '0 0', transform: `translate(${tx}px, ${ty}px) scale(${zoom})`}}>
            {media}
            {shot.highlights.map((h, i) => {
              const local = frame - h.from;
              if (local < 0 || local > h.duration) return null;
              const appear = pop(local, fps);
              const fade = interpolate(local, [h.duration - 8, h.duration], [1, 0], clamp);
              const pad = 10 / zoom;
              return (
                <div
                  key={i}
                  style={{
                    position: 'absolute',
                    left: h.region.x * contentW - pad,
                    top: h.region.y * contentH - pad,
                    width: h.region.w * contentW + pad * 2,
                    height: h.region.h * contentH + pad * 2,
                    border: `${5 / zoom}px solid ${ad.palette.accent}`,
                    borderRadius: 14 / zoom,
                    boxShadow: `0 0 ${30 / zoom}px ${ad.palette.accent}66`,
                    opacity: appear * fade,
                    transform: `scale(${1.04 - 0.04 * appear})`,
                  }}
                />
              );
            })}
          </div>
        </div>
      </div>
      {shot.highlights.map((h, i) => {
        const local = frame - h.from;
        if (local < 0 || local > h.duration) return null;
        const appear = pop(local, fps, 4);
        const fade = interpolate(local, [h.duration - 8, h.duration], [1, 0], clamp);
        return (
          <div
            key={`label-${i}`}
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: CARD_TOP + cardH + 26,
              display: 'flex',
              justifyContent: 'center',
              opacity: appear * fade,
              transform: `translateY(${(1 - appear) * 14}px)`,
            }}
          >
            <div
              style={{
                fontFamily: fontStack(ad.fonts.text.family),
                fontWeight: ad.fonts.text.weight,
                fontSize: 38,
                color: ad.palette.accentInk,
                background: ad.palette.accent,
                padding: '10px 26px',
                borderRadius: 999,
              }}
            >
              {h.label}
            </div>
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

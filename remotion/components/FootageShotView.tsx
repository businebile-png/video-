import React from 'react';
import {AbsoluteFill, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {noise2D} from '@remotion/noise';
import type {ArtDirection, FootageShot} from '../../src/schemas/timeline';
import {clamp, easeIn, easeInOut, easeOut, lerp} from '../lib/anim';
import {interpolate} from 'remotion';

const WHIP = 6;
const PUNCH = 8;
export const DISSOLVE = 8;

/**
 * One real footage segment (pre-cut "mezzanine" file) with a motivated camera move,
 * optional organic sway, the art direction's grade, and directional motion blur on whips.
 */
export const FootageShotView: React.FC<{shot: FootageShot; ad: ArtDirection}> = ({shot, ad}) => {
  const frame = useCurrentFrame();
  const {width, height} = useVideoConfig();
  const d = shot.duration;
  const p = interpolate(frame, [0, d], [0, 1], clamp);
  const e = shot.camera.ease === 'inOut' ? easeInOut(p) : shot.camera.ease === 'out' ? easeOut(p) : p;
  let scale = lerp(shot.camera.fromScale, shot.camera.toScale, e);
  let tx = (lerp(shot.camera.fromX, shot.camera.toX, e) / 100) * width;
  let ty = (lerp(shot.camera.fromY, shot.camera.toY, e) / 100) * height;
  if (shot.camera.handheld > 0) {
    tx += noise2D(`${shot.id}-x`, frame / 42, 0) * shot.camera.handheld;
    ty += noise2D(`${shot.id}-y`, frame / 42, 0.5) * shot.camera.handheld;
  }
  let blurX = 0;
  let blurY = 0;
  let opacity = 1;

  if (frame < WHIP && shot.transitionIn.startsWith('whip')) {
    const k = 1 - easeOut(frame / WHIP);
    if (shot.transitionIn === 'whip-left') tx += k * width * 0.9;
    if (shot.transitionIn === 'whip-right') tx -= k * width * 0.9;
    if (shot.transitionIn === 'whip-up') ty += k * height * 0.9;
    if (shot.transitionIn === 'whip-up') blurY = 40 * k;
    else blurX = 40 * k;
  }
  const left = d - frame;
  if (left <= WHIP && shot.transitionOut.startsWith('whip')) {
    const k = easeIn(1 - left / WHIP);
    if (shot.transitionOut === 'whip-left') tx -= k * width * 0.9;
    if (shot.transitionOut === 'whip-right') tx += k * width * 0.9;
    if (shot.transitionOut === 'whip-up') ty -= k * height * 0.9;
    if (shot.transitionOut === 'whip-up') blurY = Math.max(blurY, 40 * k);
    else blurX = Math.max(blurX, 40 * k);
  }
  if (frame < PUNCH && shot.transitionIn === 'zoom-punch') {
    const k = 1 - easeOut(frame / PUNCH);
    scale *= 1 + 0.16 * k;
    blurX = Math.max(blurX, 9 * k);
    blurY = Math.max(blurY, 9 * k);
  }
  if (frame < DISSOLVE && shot.transitionIn === 'blur-dissolve') {
    const k = frame / DISSOLVE;
    opacity = easeInOut(k);
    blurX = Math.max(blurX, 10 * (1 - k));
    blurY = Math.max(blurY, 10 * (1 - k));
  }

  const g = ad.grade;
  const dim = shot.layer === 'background' ? 0.62 : 1;
  const filterId = `mb-${shot.id}`;
  const hasBlur = blurX > 0.3 || blurY > 0.3;
  const filter = `${hasBlur ? `url(#${filterId}) ` : ''}contrast(${g.contrast}) saturate(${g.saturate}) brightness(${(g.brightness * dim).toFixed(3)})`;

  return (
    <AbsoluteFill style={{overflow: 'hidden', opacity}}>
      {hasBlur ? (
        <svg width="0" height="0" style={{position: 'absolute'}}>
          <filter id={filterId} x="-10%" y="-10%" width="120%" height="120%">
            <feGaussianBlur stdDeviation={`${blurX.toFixed(2)} ${blurY.toFixed(2)}`} />
          </filter>
        </svg>
      ) : null}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transform: `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${scale.toFixed(4)})`,
          filter,
        }}
      >
        <OffthreadVideo src={staticFile(shot.src)} muted style={{width: '100%', height: '100%', objectFit: 'cover'}} />
      </div>
    </AbsoluteFill>
  );
};

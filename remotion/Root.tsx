import React from 'react';
import {Composition} from 'remotion';
import {AdVideo, type AdVideoProps} from './AdVideo';
import {ART_DIRECTIONS} from '../src/edit/art-directions';
import type {Timeline} from '../src/schemas/timeline';

/** Placeholder used only by `remotion studio` when no timeline is passed. */
const EMPTY: Timeline = {
  version: 1,
  runId: 'apercu',
  fps: 30,
  width: 1080,
  height: 1920,
  durationInFrames: 90,
  seed: 1,
  artDirection: {...ART_DIRECTIONS[0]!, grade: {...ART_DIRECTIONS[0]!.grade, grain: 0}},
  shots: [],
  graphics: [],
  headlines: [],
  captions: [],
  endCard: {from: 0, duration: 90, kicker: 'Systeme.io', headline: 'Aperçu du gabarit', subline: 'Lancez « npm run studio -- render <id> »', cta: 'Lien en bio', disclosure: 'Publicité · lien affilié'},
  disclosure: {text: 'Publicité'},
  audio: {voice: {src: 'silence.wav', from: 0, gainDb: -60}, music: null, sfx: []},
  scenes: [],
  metrics: {
    durationSec: 3,
    shotCount: 0,
    footageShotCount: 0,
    avgShotSec: 0,
    avgCutSec: 0,
    minShotSec: 0,
    maxShotSec: 0,
    distinctClips: 0,
    distinctCaptures: 0,
    stylizedTransitions: 0,
    captionGroups: 0,
    maxCaptionChars: 0,
    maxUpscale: null,
    safeZoneViolations: [],
  },
};

export const Root: React.FC = () => (
  <Composition
    id="AdVideo"
    component={AdVideo}
    width={1080}
    height={1920}
    fps={30}
    durationInFrames={90}
    defaultProps={{timeline: EMPTY} satisfies AdVideoProps}
    calculateMetadata={({props}) => ({
      durationInFrames: props.timeline.durationInFrames,
      fps: props.timeline.fps,
      width: props.timeline.width,
      height: props.timeline.height,
    })}
  />
);

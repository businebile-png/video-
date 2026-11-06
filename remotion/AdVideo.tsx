import React from 'react';
import {AbsoluteFill, Audio, Sequence, staticFile} from 'remotion';
import './fonts';
import type {AudioClip, Timeline} from '../src/schemas/timeline';
import {FootageShotView} from './components/FootageShotView';
import {CaptureShotView} from './components/CaptureShotView';
import {Grade} from './components/Grade';
import {Captions} from './components/Captions';
import {Headline} from './components/Headline';
import {GraphicView} from './components/Graphics';
import {EndCard} from './components/EndCard';
import {Disclosure} from './components/Disclosure';
import {dbToGain, gainAt} from './lib/anim';

export type AdVideoProps = {timeline: Timeline};

const AudioTrack: React.FC<{clip: AudioClip; durationInFrames?: number}> = ({clip, durationInFrames}) => {
  const gain = clip.gainDb;
  return (
    <Sequence from={clip.from} durationInFrames={durationInFrames} layout="none">
      <Audio
        src={staticFile(clip.src)}
        volume={typeof gain === 'number' ? dbToGain(gain) : (f: number) => gainAt(gain, f + clip.from)}
      />
    </Sequence>
  );
};

/** The whole advert, rendered from a timeline JSON built by src/edit/timeline.ts. */
export const AdVideo: React.FC<AdVideoProps> = ({timeline}) => {
  const ad = timeline.artDirection;
  return (
    <AbsoluteFill style={{backgroundColor: '#000'}}>
      {timeline.shots.map((shot) => (
        <Sequence key={shot.id} from={shot.from} durationInFrames={shot.duration} layout="none">
          <AbsoluteFill>
            {shot.kind === 'footage' ? <FootageShotView shot={shot} ad={ad} /> : <CaptureShotView shot={shot} ad={ad} />}
          </AbsoluteFill>
        </Sequence>
      ))}
      <Grade ad={ad} />
      {timeline.graphics.map((g) => (
        <Sequence key={g.id} from={g.from} durationInFrames={g.duration} layout="none">
          <GraphicView item={g} ad={ad} />
        </Sequence>
      ))}
      {timeline.headlines.map((h) => (
        <Sequence key={h.id} from={h.from} durationInFrames={h.duration} layout="none">
          <Headline item={h} ad={ad} />
        </Sequence>
      ))}
      <Captions groups={timeline.captions} ad={ad} />
      <Sequence from={timeline.endCard.from} durationInFrames={timeline.endCard.duration} layout="none">
        <EndCard card={timeline.endCard} ad={ad} />
      </Sequence>
      <Disclosure text={timeline.disclosure.text} ad={ad} />
      <AudioTrack clip={timeline.audio.voice} />
      {timeline.audio.music ? <AudioTrack clip={timeline.audio.music} /> : null}
      {timeline.audio.sfx.map((s, i) => (
        <AudioTrack key={`sfx-${i}`} clip={s} durationInFrames={90} />
      ))}
    </AbsoluteFill>
  );
};

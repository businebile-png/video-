/**
 * Contract between the edit engine (src/edit) and the Remotion renderer (remotion/).
 * Plain TypeScript types (no zod) so the browser bundle stays light; frames everywhere.
 */
import type {Graphic} from './script.js';

export type TransitionKind = 'cut' | 'whip-left' | 'whip-right' | 'whip-up' | 'zoom-punch' | 'blur-dissolve';
export type CameraMoveKind = 'push-in' | 'pull-out' | 'drift-left' | 'drift-right' | 'drift-up' | 'rise' | 'hold';

export interface CameraMove {
  kind: CameraMoveKind;
  fromScale: number;
  toScale: number;
  /** Translation in % of the frame size. */
  fromX: number;
  toX: number;
  fromY: number;
  toY: number;
  ease: 'linear' | 'inOut' | 'out';
  /** Amplitude (px) of the organic "camera operator" sway; 0 = locked off. */
  handheld: number;
}

export interface FontRef {
  family: string;
  weight: number;
  style?: 'normal' | 'italic';
}

export interface ArtDirection {
  id: string;
  label: string;
  palette: {
    accent: string;
    accentInk: string;
    ink: string;
    muted: string;
    panel: string;
    panelBorder: string;
    panelInk: string;
    tint: string;
    shade: string;
  };
  fonts: {display: FontRef; text: FontRef; accent: FontRef; caption: FontRef};
  caption: {
    style: 'pop-highlight' | 'box-active' | 'underline' | 'karaoke-fill';
    size: number;
    uppercase: boolean;
    maxWords: number;
    maxChars: number;
    strokePx: number;
  };
  headline: {size: number; uppercase: boolean; letterSpacing: number; style: 'block' | 'serif-mix' | 'label'};
  grade: {
    contrast: number;
    saturate: number;
    brightness: number;
    tintOpacity: number;
    vignette: number;
    grain: number;
    /** Brightest mean luma (0–1 of the video range) a sharp shot may have: brighter clips are exposed down to it. */
    maxLuma?: number;
  };
  motion: {
    pacing: 'calm' | 'balanced' | 'punchy';
    signature: TransitionKind;
    moves: CameraMoveKind[];
    handheld: number;
    riserBeforeCta: boolean;
  };
  card: {radius: number; style: 'glass' | 'solid' | 'outline'};
  musicMoods: string[];
}

interface ShotBase {
  id: string;
  sceneId: string;
  from: number;
  duration: number;
  transitionIn: TransitionKind;
  transitionOut: TransitionKind;
}

export interface FootageShot extends ShotBase {
  kind: 'footage';
  /** File name inside the run's public dir (set by the conform step). */
  src: string;
  /** Where the segment comes from (for licences, reuse tracking, rebuilds). */
  source: {clipId: string; file: string; inSec: number; outSec: number; width: number; height: number; fps: number};
  playbackRate: number;
  camera: CameraMove;
  /** "background" = blurred and dimmed under a graphic or end card. */
  layer: 'full' | 'background';
  /** Mezzanine pixel size after conform (for the upscale check). */
  mezzanine: {width: number; height: number} | null;
  /** Exposure gain applied at conform to match the art direction's brightness (1 = untouched). */
  exposure?: number;
}

export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CaptureShot extends ShotBase {
  kind: 'capture';
  src: string;
  mediaType: 'image' | 'video';
  width: number;
  height: number;
  /**
   * Camera framing over time (frame offsets inside the shot); null = whole capture. The first keyframe may sit
   * before 0 when the shot continues the previous one (the camera keeps the push it had).
   */
  keyframes: Array<{at: number; focus: Region | null}>;
  /**
   * `carried`: the zone the previous shot ended on, already on screen (no entrance). `labelDuration`: the
   * label leaves before the frame does (frames that add up on a table row, one label at a time).
   */
  highlights: Array<{from: number; duration: number; region: Region; label: string; carried?: boolean; labelDuration?: number}>;
  /** Blurred footage behind the capture card, if any. */
  backgroundSrc: string | null;
  captureId: string;
  /** Source and date shown in the window bar for a public page ("systeme.io/fr/pricing · capture du 06/11/2026"). */
  stamp?: string;
  /** The scene shows a headline above the window: the window starts lower so a two-line headline never covers it. */
  belowHeadline?: boolean;
  /** Same capture as the shot just before, from the zone it ended on: no entrance, no return to the whole page. */
  continues?: boolean;
}

export type Shot = FootageShot | CaptureShot;

export interface GraphicItem {
  id: string;
  sceneId: string;
  from: number;
  duration: number;
  graphic: Graphic;
  /** Frame offsets (inside the item) at which each element appears, synced to the voice. */
  revealAt: number[];
  /** Verified-on date shown under prices/stats ("Tarif vérifié le …"). */
  verifiedOn?: string;
}

export interface HeadlineItem {
  id: string;
  sceneId: string;
  from: number;
  duration: number;
  text: string;
  emphasis: string[];
}

export interface CaptionWord {
  text: string;
  from: number;
  to: number;
  emphasis: boolean;
}

export interface CaptionGroup {
  from: number;
  to: number;
  words: CaptionWord[];
  /** Vertical anchor (px from top, centre of the line block). */
  y: number;
}

export interface EndCard {
  from: number;
  duration: number;
  kicker: string;
  headline: string;
  subline: string;
  cta: string;
  disclosure: string;
  /** Verification date (YYYY-MM-DD) of the price shown in the subline, if any. */
  verifiedOn?: string;
}

export interface VolumePoint {
  frame: number;
  db: number;
}

export interface AudioClip {
  src: string;
  from: number;
  /** Gain in dB, either constant or as an automation curve (absolute frames). */
  gainDb: number | VolumePoint[];
}

export interface TimelineMetrics {
  durationSec: number;
  shotCount: number;
  footageShotCount: number;
  avgShotSec: number;
  minShotSec: number;
  maxShotSec: number;
  /** Mean length of the edited shots (cuts only); avgShotSec counts every new image, camera moves included. */
  avgCutSec: number;
  distinctClips: number;
  /** Real Systeme.io captures shown (pages, table rows). */
  distinctCaptures: number;
  stylizedTransitions: number;
  captionGroups: number;
  maxCaptionChars: number;
  maxUpscale: number | null;
  safeZoneViolations: string[];
}

export interface Timeline {
  version: 1;
  runId: string;
  fps: number;
  width: number;
  height: number;
  durationInFrames: number;
  seed: number;
  artDirection: ArtDirection;
  shots: Shot[];
  graphics: GraphicItem[];
  headlines: HeadlineItem[];
  captions: CaptionGroup[];
  endCard: EndCard;
  disclosure: {text: string};
  audio: {voice: AudioClip; music: AudioClip | null; sfx: AudioClip[]};
  scenes: Array<{id: string; phase: string; from: number; to: number}>;
  metrics: TimelineMetrics;
}

/** Areas TikTok / Instagram cover with their own UI (1080x1920 canvas). */
export const SAFE_AREA = {top: 210, bottom: 1480, left: 60, right: 930} as const;

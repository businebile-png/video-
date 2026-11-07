import React from 'react';
import {interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import type {ArtDirection, GraphicItem} from '../../src/schemas/timeline';
import {clamp, pop} from '../lib/anim';
import {fontStack} from '../fonts';

const LEFT = 70;
const WIDTH = 860;

function cardStyle(ad: ArtDirection): React.CSSProperties {
  const base: React.CSSProperties = {
    borderRadius: ad.card.radius,
    color: ad.palette.panelInk,
    padding: '44px 48px',
  };
  if (ad.card.style === 'solid') return {...base, background: ad.palette.panel, boxShadow: '0 30px 80px rgba(0,0,0,0.35)'};
  if (ad.card.style === 'outline') return {...base, background: 'rgba(0,0,0,0.28)', border: `2px solid ${ad.palette.panelBorder}`};
  return {...base, background: ad.palette.panel, border: `1px solid ${ad.palette.panelBorder}`, boxShadow: '0 30px 80px rgba(0,0,0,0.4)'};
}

const Title: React.FC<{text?: string; ad: ArtDirection; frame: number; fps: number}> = ({text, ad, frame, fps}) => {
  if (!text) return null;
  const s = pop(frame, fps);
  return (
    <div
      style={{
        fontFamily: fontStack(ad.fonts.display.family),
        fontWeight: ad.fonts.display.weight,
        fontSize: 58,
        lineHeight: 1.08,
        letterSpacing: -0.8,
        marginBottom: 30,
        opacity: s,
        transform: `translateY(${(1 - s) * 18}px)`,
        textWrap: 'balance',
      }}
    >
      {text}
    </div>
  );
};

const Check: React.FC<{progress: number; color: string; ink: string}> = ({progress, color, ink}) => (
  <svg width="54" height="54" viewBox="0 0 54 54" style={{flex: '0 0 54px'}}>
    <circle cx="27" cy="27" r="25" fill={color} opacity={Math.min(1, progress * 1.5)} />
    <path
      d="M16 28 L24 36 L39 19"
      fill="none"
      stroke={ink}
      strokeWidth="5.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeDasharray="40"
      strokeDashoffset={40 * (1 - progress)}
    />
  </svg>
);

const Dot: React.FC<{color: string}> = ({color}) => (
  <svg width="40" height="40" viewBox="0 0 40 40" style={{flex: '0 0 40px'}}>
    <circle cx="20" cy="20" r="7" fill={color} />
  </svg>
);

const Cross: React.FC<{color: string}> = ({color}) => (
  <svg width="40" height="40" viewBox="0 0 40 40" style={{flex: '0 0 40px'}}>
    <path d="M12 12 L28 28 M28 12 L12 28" stroke={color} strokeWidth="4.5" strokeLinecap="round" />
  </svg>
);

function Checklist({item, ad, frame, fps}: {item: GraphicItem; ad: ArtDirection; frame: number; fps: number}) {
  const g = item.graphic;
  if (g.type !== 'checklist') return null;
  return (
    <>
      <Title text={g.title} ad={ad} frame={frame} fps={fps} />
      <div style={{display: 'flex', flexDirection: 'column', gap: 26}}>
        {g.items.map((text, i) => {
          const at = item.revealAt[i] ?? 0;
          const s = pop(frame, fps, at);
          const check = spring({frame: frame - at - 3, fps, config: {damping: 200, stiffness: 140}});
          return (
            <div key={i} style={{display: 'flex', alignItems: 'center', gap: 24, opacity: s, transform: `translateX(${(1 - s) * -30}px)`}}>
              <Check progress={check} color={ad.palette.accent} ink={ad.palette.accentInk} />
              <div style={{fontFamily: fontStack(ad.fonts.text.family), fontWeight: ad.fonts.text.weight, fontSize: 48, lineHeight: 1.15}}>{text}</div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function Steps({item, ad, frame, fps}: {item: GraphicItem; ad: ArtDirection; frame: number; fps: number}) {
  const g = item.graphic;
  if (g.type !== 'steps') return null;
  const current = item.revealAt.filter((t) => frame >= t).length - 1;
  return (
    <>
      <Title text={g.title} ad={ad} frame={frame} fps={fps} />
      <div style={{display: 'flex', flexDirection: 'column', gap: 26}}>
        {g.steps.map((step, i) => {
          const at = item.revealAt[i] ?? 0;
          const s = pop(frame, fps, at);
          const revealed = frame >= at;
          const active = i === current;
          const dim = active || current < 0 ? 1 : 0.5;
          return (
            <div key={i} style={{display: 'flex', alignItems: 'center', gap: 26}}>
              {/* The numbers wait, faint, from the start: the card announces a path instead of looking empty. */}
              <div
                style={{
                  flex: '0 0 72px',
                  height: 72,
                  borderRadius: 20,
                  background: active ? ad.palette.accent : 'transparent',
                  border: `3px solid ${ad.palette.accent}`,
                  color: active ? ad.palette.accentInk : ad.palette.accent,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontFamily: fontStack(ad.fonts.display.family),
                  fontWeight: ad.fonts.display.weight,
                  fontSize: 40,
                  opacity: revealed ? dim : 0.3,
                  transform: `scale(${revealed ? 0.9 + 0.1 * s : 0.9})`,
                }}
              >
                {i + 1}
              </div>
              <div style={{opacity: s * dim, transform: `translateX(${(1 - s) * -24}px)`}}>
                <div style={{fontFamily: fontStack(ad.fonts.text.family), fontWeight: ad.fonts.display.weight, fontSize: 52, lineHeight: 1.1}}>{step.title}</div>
                {step.detail ? (
                  <div style={{fontFamily: fontStack(ad.fonts.text.family), fontWeight: ad.fonts.text.weight, fontSize: 34, opacity: 0.75, marginTop: 6}}>
                    {step.detail}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

const SLOTS = [
  {x: 40, y: 0},
  {x: 470, y: 60},
  {x: 90, y: 200},
  {x: 430, y: 270},
  {x: 30, y: 400},
  {x: 480, y: 450},
];

function StackMerge({item, ad, frame, fps}: {item: GraphicItem; ad: ArtDirection; frame: number; fps: number}) {
  const g = item.graphic;
  if (g.type !== 'stack-merge') return null;
  const mergeAt = item.revealAt[item.revealAt.length - 1] ?? 60;
  const m = spring({frame: frame - mergeAt, fps, config: {damping: 20, stiffness: 120, mass: 0.9}});
  const result = pop(frame, fps, mergeAt + 6);
  return (
    <div style={{position: 'relative', height: 560}}>
      {g.items.map((text, i) => {
        const slot = SLOTS[i % SLOTS.length]!;
        const s = pop(frame, fps, item.revealAt[i] ?? 0);
        const x = slot.x + (330 - slot.x) * m;
        const y = slot.y + (240 - slot.y) * m;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: x,
              top: y,
              transform: `scale(${(0.6 + 0.4 * s) * (1 - 0.6 * m)})`,
              opacity: s * (1 - m),
              padding: '20px 34px',
              borderRadius: 999,
              background: 'rgba(12,12,16,0.8)',
              border: '1.5px solid rgba(255,255,255,0.32)',
              boxShadow: '0 12px 32px rgba(0,0,0,0.35)',
              color: '#FFFFFF',
              fontFamily: fontStack(ad.fonts.text.family),
              fontWeight: 700,
              fontSize: 52,
              whiteSpace: 'nowrap',
            }}
          >
            {text}
          </div>
        );
      })}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 210,
          display: 'flex',
          justifyContent: 'center',
          opacity: result,
          transform: `scale(${0.7 + 0.3 * result})`,
        }}
      >
        <div
          style={{
            padding: '30px 56px',
            borderRadius: 999,
            background: ad.palette.accent,
            color: ad.palette.accentInk,
            fontFamily: fontStack(ad.fonts.display.family),
            fontWeight: ad.fonts.display.weight,
            fontSize: 70,
            boxShadow: `0 0 0 ${14 * result}px ${ad.palette.accent}33, 0 30px 80px rgba(0,0,0,0.35)`,
          }}
        >
          {g.result}
        </div>
      </div>
    </div>
  );
}

function Compare({item, ad, frame, fps}: {item: GraphicItem; ad: ArtDirection; frame: number; fps: number}) {
  const g = item.graphic;
  if (g.type !== 'compare') return null;
  const col = (side: 'left' | 'right', at: number) => {
    const data = g[side];
    const s = pop(frame, fps, at);
    const good = side === 'right';
    return (
      <div
        style={{
          flex: 1,
          borderRadius: 22,
          padding: '30px 26px',
          background: good ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.25)',
          border: `2px solid ${good ? ad.palette.accent : 'rgba(255,255,255,0.18)'}`,
          opacity: s,
          transform: `translateY(${(1 - s) * 30}px)`,
          color: '#FFFFFF',
        }}
      >
        <div style={{fontFamily: fontStack(ad.fonts.display.family), fontWeight: ad.fonts.display.weight, fontSize: 48, marginBottom: 20, color: good ? ad.palette.accent : 'rgba(255,255,255,0.85)'}}>
          {data.title}
        </div>
        <div style={{display: 'flex', flexDirection: 'column', gap: 16}}>
          {data.items.map((t, i) => {
            // revealAt = [left column, right column, left lines…, right lines…]: a line lights up when it is said.
            const lineAt = item.revealAt[2 + (side === 'left' ? 0 : g.left.items.length) + i];
            const si = lineAt === undefined ? pop(frame, fps, at + 5 + i * 4) : pop(frame, fps, lineAt);
            const shown = lineAt === undefined ? si : s * (0.4 + 0.6 * si);
            return (
              <div key={i} style={{display: 'flex', alignItems: 'center', gap: 12, opacity: shown}}>
                {good ? (
                  <Check progress={si} color={ad.palette.accent} ink={ad.palette.accentInk} />
                ) : g.leftStyle === 'dot' ? (
                  <Dot color="rgba(255,255,255,0.7)" />
                ) : (
                  <Cross color="rgba(255,255,255,0.55)" />
                )}
                <div style={{fontFamily: fontStack(ad.fonts.text.family), fontWeight: ad.fonts.text.weight, fontSize: 37, lineHeight: 1.15}}>{t}</div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };
  return (
    <div>
      <div style={{display: 'flex', gap: 20}}>
        {col('left', item.revealAt[0] ?? 0)}
        {col('right', item.revealAt[1] ?? 20)}
      </div>
      <div style={{textAlign: 'center', color: '#FFFFFF', opacity: pop(frame, fps, item.revealAt[0] ?? 0)}}>
        <VerifiedLine on={item.verifiedOn} ad={ad} />
      </div>
    </div>
  );
}

function VerifiedLine({on, ad}: {on?: string; ad: ArtDirection}) {
  if (!on) return null;
  const [y, m, d] = on.split('-');
  return (
    <div style={{marginTop: 26, fontFamily: fontStack(ad.fonts.text.family), fontWeight: 600, fontSize: 26, opacity: 0.7}}>
      Source : systeme.io · vérifié le {d}/{m}/{y}
    </div>
  );
}

function Stat({item, ad, frame, fps}: {item: GraphicItem; ad: ArtDirection; frame: number; fps: number}) {
  const g = item.graphic;
  if (g.type !== 'stat') return null;
  const s = pop(frame, fps, item.revealAt[0] ?? 0);
  const digits = g.value.match(/^([^\d]*)([\d\s]+)(.*)$/);
  let shown = g.value;
  if (digits) {
    const target = Number(digits[2]!.replace(/\s/g, ''));
    const count = Math.round(interpolate(frame, [(item.revealAt[0] ?? 0) + 2, (item.revealAt[0] ?? 0) + 22], [0, target], clamp));
    shown = `${digits[1]}${count.toLocaleString('fr-FR')}${digits[3]}`;
  }
  return (
    <div style={{textAlign: 'center', opacity: s, transform: `scale(${0.9 + 0.1 * s})`}}>
      <div style={{fontFamily: fontStack(ad.fonts.display.family), fontWeight: ad.fonts.display.weight, fontSize: 180, lineHeight: 1, color: ad.palette.accent}}>{shown}</div>
      <div style={{fontFamily: fontStack(ad.fonts.text.family), fontWeight: ad.fonts.text.weight, fontSize: 46, marginTop: 18}}>{g.label}</div>
      <VerifiedLine on={item.verifiedOn} ad={ad} />
    </div>
  );
}

function Price({item, ad, frame, fps}: {item: GraphicItem; ad: ArtDirection; frame: number; fps: number}) {
  const g = item.graphic;
  if (g.type !== 'price') return null;
  const s = pop(frame, fps, item.revealAt[0] ?? 0);
  return (
    <div style={{textAlign: 'center', opacity: s, transform: `translateY(${(1 - s) * 30}px)`}}>
      <div style={{fontFamily: fontStack(ad.fonts.text.family), fontWeight: 700, fontSize: 36, letterSpacing: 3, textTransform: 'uppercase', opacity: 0.75}}>
        Formule {g.plan}
      </div>
      <div style={{display: 'flex', justifyContent: 'center', alignItems: 'baseline', gap: 14, marginTop: 10}}>
        <div style={{fontFamily: fontStack(ad.fonts.display.family), fontWeight: ad.fonts.display.weight, fontSize: 150, lineHeight: 1, color: ad.palette.accent}}>{g.price}</div>
        <div style={{fontFamily: fontStack(ad.fonts.text.family), fontWeight: ad.fonts.text.weight, fontSize: 40, opacity: 0.85}}>{g.period}</div>
      </div>
      {g.note ? <div style={{fontFamily: fontStack(ad.fonts.text.family), fontWeight: ad.fonts.text.weight, fontSize: 32, marginTop: 18, opacity: 0.85}}>{g.note}</div> : null}
      <VerifiedLine on={item.verifiedOn} ad={ad} />
    </div>
  );
}

/** Motion-design card that explains one idea; it always sits over (blurred) real footage. */
export const GraphicView: React.FC<{item: GraphicItem; ad: ArtDirection}> = ({item, ad}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const g = item.graphic;
  const bare = g.type === 'stack-merge' || g.type === 'compare';
  // A card never shows empty: it enters with its first content (its title, or the first reveal on the voice).
  const titled = (g.type === 'checklist' || g.type === 'steps') && Boolean(g.title);
  const enter = pop(frame, fps, bare || titled ? 0 : (item.revealAt[0] ?? 0));
  const shown = bare ? 1 : Math.min(1, enter * 1.6);
  const exit = interpolate(frame, [item.duration - 7, item.duration], [1, 0], clamp);
  const inner = (() => {
    switch (g.type) {
      case 'checklist':
        return <Checklist item={item} ad={ad} frame={frame} fps={fps} />;
      case 'steps':
        return <Steps item={item} ad={ad} frame={frame} fps={fps} />;
      case 'stack-merge':
        return <StackMerge item={item} ad={ad} frame={frame} fps={fps} />;
      case 'compare':
        return <Compare item={item} ad={ad} frame={frame} fps={fps} />;
      case 'stat':
        return <Stat item={item} ad={ad} frame={frame} fps={fps} />;
      case 'price':
        return <Price item={item} ad={ad} frame={frame} fps={fps} />;
    }
  })();
  return (
    <div
      style={{
        position: 'absolute',
        left: LEFT,
        width: WIDTH,
        top: 520,
        maxHeight: 660,
        opacity: exit * shown,
        transform: `translateY(${(1 - enter) * 30}px)`,
        ...(bare ? {} : cardStyle(ad)),
      }}
    >
      {inner}
    </div>
  );
};

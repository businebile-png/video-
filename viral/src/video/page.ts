import {fontFaceCss} from '../render/fonts.js';
import type {VideoFormatDef} from './formats.js';
import type {Timeline} from './timeline.js';

/**
 * The page the renderer films, frame by frame. Everything moves through the Web Animations API, paused and
 * seeked to the exact time of each frame (deterministic, never recorded in real time): a 3D stage with a
 * drifting camera, scenes entering in cube / flip / depth / swing / zoom / whip, words flying in from depth,
 * licensed footage (frame sequences extracted by FFmpeg), Ken Burns stills, a drawn character whose mouth
 * follows the voice, word-by-word captions, and the « Publicité » mention on screen the whole time.
 */

export interface PageInput {
  timeline: Timeline;
  def: VideoFormatDef;
  palette: {bg: string; fg: string; accent: string; accent2: string; muted: string; onAccent: string; accentText: string; g1: string; g2: string};
  fonts: {heading: string; body: string};
  safe: {top: number; bottom: number; left: number; right: number};
  disclosure: string;
  handle: string;
  character?: {svg: string; name: string; mode: 'narrator' | 'story'};
  mouth?: number[];
  seed: number;
}

const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:var(--W);height:var(--H);overflow:hidden;background:#000}
#stage{position:absolute;left:0;top:0;width:var(--W);height:var(--H);overflow:hidden;background:var(--bg);color:var(--fg);font-family:var(--bfont),'DejaVu Sans',sans-serif;-webkit-font-smoothing:antialiased;perspective:calc(var(--u)*1500);perspective-origin:50% 45%}
#world{position:absolute;inset:0;transform-style:preserve-3d}
.bgfill{position:absolute;inset:-8%;background:radial-gradient(120% 80% at 20% 10%,var(--g1) 0%,transparent 55%),radial-gradient(120% 90% at 90% 95%,var(--g2) 0%,transparent 60%),var(--bg)}
.grid{position:absolute;left:-60%;right:-60%;bottom:-30%;height:80%;transform:rotateX(76deg);transform-origin:50% 100%;background-image:linear-gradient(color-mix(in srgb,var(--accent) 38%,transparent) 2px,transparent 2px),linear-gradient(90deg,color-mix(in srgb,var(--accent) 38%,transparent) 2px,transparent 2px);background-size:calc(var(--u)*110) calc(var(--u)*110);opacity:.35;mask-image:linear-gradient(to top,#000 10%,transparent 85%)}
.paper{position:absolute;inset:0;background-image:repeating-linear-gradient(0deg,transparent 0,transparent calc(var(--u)*58),color-mix(in srgb,var(--muted) 26%,transparent) calc(var(--u)*59),transparent calc(var(--u)*60));opacity:.55}
.dot{position:absolute;border-radius:50%;background:var(--fg);pointer-events:none}
.glass{position:absolute;border-radius:calc(var(--u)*44);background:linear-gradient(135deg,color-mix(in srgb,var(--fg) 10%,transparent),color-mix(in srgb,var(--accent) 8%,transparent));border:calc(var(--u)*2) solid color-mix(in srgb,var(--fg) 14%,transparent);box-shadow:0 calc(var(--u)*30) calc(var(--u)*80) rgba(0,0,0,.25);pointer-events:none}
.scene{position:absolute;inset:0;transform-style:preserve-3d;backface-visibility:hidden}
.media{position:absolute;inset:0;overflow:hidden;background:#000}
.media img{position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover}
.media .blurbg{filter:blur(calc(var(--u)*18)) brightness(.55) saturate(1.2);transform:scale(1.15)}
.media .window{position:absolute;left:4%;right:4%;top:22%;aspect-ratio:16/9;border-radius:calc(var(--u)*34);overflow:hidden;box-shadow:0 calc(var(--u)*40) calc(var(--u)*90) rgba(0,0,0,.55);transform-style:preserve-3d}
.media .window img{object-fit:cover}
.shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.55) 0%,rgba(0,0,0,.15) 35%,rgba(0,0,0,.25) 60%,rgba(0,0,0,.72) 100%)}
.content{position:absolute;left:var(--sl);right:var(--sr);top:var(--st);bottom:var(--sb);display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;gap:calc(var(--u)*30);transform-style:preserve-3d}
.aspect-169 .content{align-items:flex-start;text-align:left}
.w{display:inline-block;transform-style:preserve-3d;will-change:transform,opacity;white-space:pre}
.label{font-family:var(--bfont);font-weight:700;font-size:calc(var(--u)*34);letter-spacing:.06em;text-transform:uppercase;padding:calc(var(--u)*12) calc(var(--u)*26);border-radius:999px;background:var(--accent);color:var(--onAccent)}
.title{font-family:var(--hfont);font-weight:800;font-size:calc(var(--u)*92*var(--k,1));line-height:1.08;letter-spacing:-.01em;text-wrap:balance;text-shadow:0 calc(var(--u)*6) calc(var(--u)*30) rgba(0,0,0,.35)}
.title .em{color:var(--accentText)}
.on-media .title{color:#fff}
.body{font-size:calc(var(--u)*44);line-height:1.3;color:var(--muted);max-width:92%;text-wrap:pretty}
.on-media .body{color:rgba(255,255,255,.88)}
.num{font-family:var(--hfont);font-weight:900;font-size:calc(var(--u)*260);line-height:.9;color:var(--accentText);text-shadow:0 calc(var(--u)*14) calc(var(--u)*40) rgba(0,0,0,.35)}
.num::after{content:'';display:block;height:calc(var(--u)*12);width:60%;margin:calc(var(--u)*10) auto 0;border-radius:99px;background:var(--accent2)}
.cards{display:flex;flex-direction:column;gap:calc(var(--u)*28);width:100%;transform-style:preserve-3d}
.aspect-169 .cards{flex-direction:row}
.card{flex:1;border-radius:calc(var(--u)*36);padding:calc(var(--u)*36) calc(var(--u)*40);text-align:left;background:color-mix(in srgb,var(--fg) 8%,var(--bg));border:calc(var(--u)*4) solid color-mix(in srgb,var(--fg) 14%,transparent);box-shadow:0 calc(var(--u)*24) calc(var(--u)*60) rgba(0,0,0,.28)}
.card b{display:block;font-size:calc(var(--u)*32);letter-spacing:.06em;text-transform:uppercase;margin-bottom:calc(var(--u)*12);color:var(--muted)}
.card p{font-family:var(--hfont);font-weight:700;font-size:calc(var(--u)*50);line-height:1.15}
.card.good{background:var(--accent);color:var(--onAccent);border-color:transparent}
.card.good b{color:var(--onAccent);opacity:.8}
.product{border-radius:calc(var(--u)*40);padding:calc(var(--u)*46);background:color-mix(in srgb,var(--fg) 7%,var(--bg));border:calc(var(--u)*5) solid var(--accent);text-align:left;width:100%;box-shadow:0 calc(var(--u)*30) calc(var(--u)*80) rgba(0,0,0,.3)}
.product h3{font-family:var(--hfont);font-size:calc(var(--u)*70);line-height:1.05;margin-bottom:calc(var(--u)*16)}
.product p{font-size:calc(var(--u)*42);line-height:1.3;color:var(--muted)}
.cta-big{font-family:var(--hfont);font-weight:900;font-size:calc(var(--u)*110);line-height:1.02;color:var(--accentText)}
.arrow{font-size:calc(var(--u)*120);line-height:1;color:var(--accent2)}
.quote{font-family:var(--hfont);font-size:calc(var(--u)*240);line-height:.6;color:var(--accent);height:calc(var(--u)*110)}
.note{position:absolute;left:0;right:0;bottom:calc(var(--u)*-6);font-size:calc(var(--u)*28);color:var(--muted);opacity:.9;text-align:center}
.on-media .note{color:rgba(255,255,255,.75)}
.bubble{position:relative;background:var(--fg);color:var(--bg);border-radius:calc(var(--u)*40);padding:calc(var(--u)*34) calc(var(--u)*40);font-family:var(--hfont);font-weight:700;font-size:calc(var(--u)*54);line-height:1.15;max-width:96%}
.bubble::after{content:'';position:absolute;left:50%;bottom:calc(var(--u)*-34);border:calc(var(--u)*20) solid transparent;border-top:calc(var(--u)*24) solid var(--fg);transform:translateX(-50%)}
#world{z-index:0}#char{position:absolute;z-index:2;left:50%;width:calc(var(--u)*480);transform:translateX(-50%);bottom:0;transform-style:preserve-3d}
#char.narrator{width:calc(var(--u)*470)}
#char svg{width:100%;height:auto;display:block;filter:drop-shadow(0 calc(var(--u)*30) calc(var(--u)*40) rgba(0,0,0,.35))}
#charname{position:absolute;left:50%;bottom:calc(var(--u)*24);transform:translateX(-50%);font-size:calc(var(--u)*28);font-weight:700;padding:calc(var(--u)*8) calc(var(--u)*20);border-radius:99px;background:rgba(0,0,0,.55);color:#fff;white-space:nowrap}
#captions{position:absolute;z-index:3;left:var(--sl);right:var(--sr);top:var(--cy);display:flex;justify-content:center;pointer-events:none}
.cap{position:absolute;max-width:100%;text-align:center;font-family:var(--cfont);font-weight:800;font-size:calc(var(--u)*var(--cs));line-height:1.12;color:#fff;-webkit-text-stroke:calc(var(--u)*var(--stroke)) rgba(0,0,0,.85);paint-order:stroke fill;text-shadow:0 calc(var(--u)*6) calc(var(--u)*18) rgba(0,0,0,.45)}
.cap .cw{display:inline-block;margin:0 calc(var(--u)*3);transform-origin:50% 70%}
.cap-bold .cap{text-transform:uppercase;letter-spacing:.01em}
.cap-serif .cap{font-weight:700;-webkit-text-stroke:0;text-shadow:0 calc(var(--u)*4) calc(var(--u)*16) rgba(0,0,0,.8)}
.cap-minimal .cap{font-weight:600;-webkit-text-stroke:0;background:rgba(0,0,0,.58);padding:calc(var(--u)*10) calc(var(--u)*24);border-radius:calc(var(--u)*16);text-shadow:none}
#hud{position:absolute;inset:0;pointer-events:none;z-index:5}
.badge{position:absolute;left:var(--sl);top:var(--st);font-family:var(--bfont);font-weight:800;font-size:calc(var(--u)*30);letter-spacing:.04em;padding:calc(var(--u)*10) calc(var(--u)*22);border-radius:calc(var(--u)*12);background:rgba(255,255,255,.92);color:#111;box-shadow:0 calc(var(--u)*6) calc(var(--u)*20) rgba(0,0,0,.25)}
.handle{position:absolute;right:var(--sr);top:var(--st);font-weight:700;font-size:calc(var(--u)*30);color:#fff;text-shadow:0 2px 10px rgba(0,0,0,.6);opacity:.9}
.progress{position:absolute;left:var(--sl);right:var(--sr);top:calc(var(--st) - var(--u)*26);height:calc(var(--u)*8);border-radius:99px;background:rgba(255,255,255,.22);overflow:hidden}
.progress i{display:block;height:100%;width:0;background:var(--accent);border-radius:99px}
.fx{position:absolute;inset:0;pointer-events:none;z-index:4}
.vignette{background:radial-gradient(ellipse at 50% 45%,transparent 50%,rgba(0,0,0,.55) 100%)}
.grain{inset:-50%;opacity:.13;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.9'/%3E%3C/svg%3E");mix-blend-mode:overlay}
.leak{inset:-30%;background:radial-gradient(40% 30% at 30% 30%,rgba(255,170,90,.35),transparent 70%),radial-gradient(35% 25% at 75% 70%,rgba(255,90,140,.22),transparent 70%);mix-blend-mode:screen;filter:blur(calc(var(--u)*20))}
.bar{position:absolute;left:0;right:0;height:calc(var(--u)*150);background:#000}
.sheen{position:absolute;inset:-40%;background:linear-gradient(115deg,transparent 42%,rgba(255,255,255,.10) 50%,transparent 58%);mix-blend-mode:screen;pointer-events:none}
`;

const JS = String.raw`
window.__video = (tl, opt) => {
  const HW = -tl.width / 2, HH = -tl.height / 2;
  const $ = (tag, cls, parent, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; if (parent) parent.appendChild(e); return e; };
  let seed = opt.seed >>> 0;
  const rnd = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const E_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)', E_INOUT = 'cubic-bezier(0.65, 0, 0.35, 1)', E_BACK = 'cubic-bezier(0.34, 1.56, 0.64, 1)';
  const anim = (el, kf, start, dur, easing = E_OUT, extra = {}) => el.animate(kf, {delay: Math.max(0, start) * 1000, duration: Math.max(1, dur * 1000), easing, fill: 'both', ...extra});
  // Visibility is set at each seek from explicit time ranges (deterministic, several ranges per element).
  const vis = new Map();
  const show = (el, from, to) => { if (!vis.has(el)) vis.set(el, []); vis.get(el).push([from, to === undefined ? Infinity : to]); el.style.visibility = 'hidden'; };
  const stage = document.getElementById('stage');
  const world = $('div', '', stage); world.id = 'world';
  const fx = opt.effects || {};
  const T = 0.5;
  const D = tl.duration;
  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
  // Background (motion scenes): gradient, 3D grid floor, paper, particles at several depths.
  const back = $('div', 'bgfill', world);
  anim(back, [{transform: 'translate3d(-2%,-1%,-200px) scale(1.05)'}, {transform: 'translate3d(2%,1%,-200px) scale(1.12)'}], 0, D, 'linear');
  if (fx.grid) { const g = $('div', 'grid', world); anim(g, [{backgroundPosition: '0 0'}, {backgroundPosition: '0 ' + (D * 60) + 'px'}], 0, D, 'linear'); }
  if (fx.paper) $('div', 'paper', world);
  if (!fx.paper) for (let k = 0; k < 4; k++) {
    const g = $('div', 'glass', world); const w = 260 + rnd() * 320, h = w * (0.55 + rnd() * 0.5), z = -900 + rnd() * 500;
    g.style.width = w + 'px'; g.style.height = h + 'px'; g.style.left = (rnd() * 80 - 10) + '%'; g.style.top = (k * 25 + rnd() * 10) + '%';
    anim(g, [{transform: 'translate3d(0,0,' + z + 'px) rotateY(' + (-30 + rnd() * 60) + 'deg) rotateX(' + (-20 + rnd() * 40) + 'deg)'}, {transform: 'translate3d(' + ((rnd() - .5) * 240) + 'px,' + ((rnd() - .5) * 300) + 'px,' + (z + 150) + 'px) rotateY(' + (-30 + rnd() * 60) + 'deg) rotateX(' + (-20 + rnd() * 40) + 'deg)'}], 0, D, 'linear');
  }
  if (fx.particles) for (let k = 0; k < 34; k++) {
    const d = $('div', 'dot', world); const s = 4 + rnd() * 10; const z = -600 + rnd() * 700;
    d.style.width = d.style.height = s + 'px'; d.style.left = (rnd() * 100) + '%'; d.style.top = (rnd() * 100) + '%'; d.style.opacity = (0.08 + rnd() * 0.22).toFixed(2);
    anim(d, [{transform: 'translate3d(0,0,' + z + 'px)'}, {transform: 'translate3d(' + ((rnd() - .5) * 160) + 'px,' + (-80 - rnd() * 260) + 'px,' + z + 'px)'}], 0, D, 'linear');
  }
  // Slow camera drift and push-in over the whole video.
  anim(world, [{transform: 'rotateY(1.6deg) rotateX(-0.8deg) scale(1)'}, {transform: 'rotateY(-1.6deg) rotateX(0.8deg) scale(1.035)'}], 0, D, 'linear');
  const frameSets = [];
  const media = [];
  tl.scenes.forEach((sc, i) => {
    const el = $('div', 'scene', world);
    const inStart = i === 0 ? 0 : sc.start - T / 2;
    const outEnd = i < tl.scenes.length - 1 ? tl.scenes[i + 1].start + T / 2 : D;
    show(el, inStart, outEnd);
    const onMedia = sc.media.kind !== 'motion';
    if (onMedia) {
      const m = $('div', 'media', el);
      if (sc.media.dir) {
        const imgs = [];
        if (sc.media.framed) { const b = $('img', 'blurbg', m); const w = $('div', 'window', m); const f = $('img', '', w); imgs.push(b, f); anim(w, [{transform: 'rotateY(-9deg) rotateX(4deg) translateZ(40px)'}, {transform: 'rotateY(7deg) rotateX(-3deg) translateZ(90px)'}], sc.start, sc.end - sc.start + T, 'linear'); }
        else { const f = $('img', '', m); imgs.push(f); anim(f, [{transform: 'scale(1.04)'}, {transform: 'scale(1.14)'}], inStart, outEnd - inStart, 'linear'); }
        frameSets.push({imgs, start: inStart, end: outEnd, dir: sc.media.dir, count: sc.media.count, fps: sc.media.fps});
      } else if (sc.media.image) {
        const f = $('img', '', m); f.src = sc.media.image;
        const x = (rnd() - .5) * 6, y = (rnd() - .5) * 6;
        anim(f, [{transform: 'scale(1.06) translate(0,0)'}, {transform: 'scale(1.2) translate(' + x + '%,' + y + '%)'}], inStart, outEnd - inStart, 'linear');
      }
      $('div', 'shade', el);
    }
    const c = $('div', 'content' + (onMedia ? ' on-media' : ''), el);
    const tx = sc.text || {};
    const t0 = Math.max(sc.speechStart - 0.12, i === 0 ? 0.05 : sc.start + 0.05);
    const words = (parent, text, cls, startAt, stagger, emph) => {
      const box = $('div', cls, parent);
      const list = [];
      String(text || '').split(/(\s+)/).forEach((p) => { if (!p) return; if (/^\s+$/.test(p)) box.appendChild(document.createTextNode(' ')); else { const w = $('span', 'w', box, p); if (emph && emph.some((e) => norm(e) === norm(p))) w.classList.add('em'); list.push(w); } });
      list.forEach((w, k) => anim(w, [{transform: 'translate3d(0,40px,-380px) rotateX(70deg)', opacity: 0}, {transform: 'translate3d(0,0,0) rotateX(0)', opacity: 1}], (sc.reveal && sc.reveal[k] !== undefined) ? sc.reveal[k] : startAt + k * stagger, 0.6));
      return box;
    };
    const emph = (sc.emphasis || []).map((e) => e.word);
    if (sc.layout === 'number') {
      if (tx.label) { const l = $('div', 'label', c, tx.label); anim(l, [{transform: 'translateY(30px)', opacity: 0}, {transform: 'none', opacity: 1}], t0, 0.45); }
      if (tx.number !== undefined && tx.number !== null) { const nEl = $('div', 'num', c, String(tx.number)); anim(nEl, [{transform: 'translateZ(-300px) rotateX(80deg) scale(.4)', opacity: 0}, {transform: 'translateZ(0) rotateX(0) scale(1)', opacity: 1}], t0, 0.7, E_BACK); }
      words(c, tx.title, 'title', t0 + 0.25, 0.05, emph);
      if (tx.body && opt.voice !== 'voix') words(c, tx.body, 'body', t0 + 0.7, 0.025);
    } else if (sc.layout === 'compare') {
      if (tx.number) { const nEl = $('div', 'label', c, String(tx.number)); anim(nEl, [{opacity: 0}, {opacity: 1}], t0, 0.3); }
      const cards = $('div', 'cards', c);
      const a = $('div', 'card', cards); $('b', '', a, tx.leftLabel || 'Avant'); $('p', '', a, tx.left || '');
      const b = $('div', 'card good', cards); $('b', '', b, tx.rightLabel || 'Après'); $('p', '', b, tx.right || '');
      const second = Math.max(t0 + 0.6, (sc.speechStart + (sc.end - sc.speechStart) * 0.45));
      anim(a, [{transformOrigin: '0% 50%', transform: 'rotateY(-75deg)', opacity: 0}, {transformOrigin: '0% 50%', transform: 'rotateY(0)', opacity: 1}], t0 + 0.1, 0.7);
      anim(b, [{transformOrigin: '100% 50%', transform: 'rotateY(75deg) translateZ(-120px)', opacity: 0}, {transformOrigin: '100% 50%', transform: 'rotateY(0) translateZ(0)', opacity: 1}], second, 0.75, E_BACK);
    } else if (sc.layout === 'product') {
      if (tx.label) { const l = $('div', 'label', c, tx.label); anim(l, [{transform: 'translateY(30px)', opacity: 0}, {transform: 'none', opacity: 1}], t0, 0.45); }
      const p = $('div', 'product', c); $('h3', '', p, (tx.product && tx.product.title) || 'Systeme.io'); $('p', '', p, (tx.product && tx.product.body) || '');
      anim(p, [{transform: 'translateZ(-320px) rotateX(35deg) scale(.85)', opacity: 0}, {transform: 'translateZ(0) rotateX(0) scale(1)', opacity: 1}], t0, 0.8, E_BACK);
      anim(p, [{boxShadow: '0 0 0 0 rgba(255,255,255,0)'}, {boxShadow: '0 0 70px 8px color-mix(in srgb, var(--accent) 55%, transparent)'}, {boxShadow: '0 0 0 0 rgba(255,255,255,0)'}], t0 + 0.9, 1.6, 'ease-in-out', {iterations: 2});
    } else if (sc.layout === 'cta') {
      words(c, tx.title, 'cta-big', t0, 0.07);
      const ar = $('div', 'arrow', c, '↓'); anim(ar, [{transform: 'translateY(-20px)'}, {transform: 'translateY(20px)'}], t0 + 0.4, 0.5, 'ease-in-out', {iterations: Math.max(1, Math.floor((sc.end - t0) / 0.5)), direction: 'alternate'});
      if (tx.body) words(c, tx.body, 'body', t0 + 0.6, 0.03);
    } else if (sc.layout === 'quote') {
      const q = $('div', 'quote', c, '“'); anim(q, [{transform: 'scale(2.2) translateZ(200px)', opacity: 0}, {transform: 'none', opacity: 1}], t0, 0.6, E_BACK);
      if (tx.label) $('div', 'label', c, tx.label);
      words(c, tx.title, 'title', t0 + 0.2, 0.05, emph);
    } else if (sc.layout === 'character') {
      if (tx.label) { const l = $('div', 'label', c, tx.label); anim(l, [{opacity: 0}, {opacity: 1}], t0, 0.4); }
      const bub = $('div', 'bubble', c); words(bub, tx.title, '', t0 + 0.15, 0.04, emph);
      c.style.justifyContent = 'flex-start';
      anim(bub, [{transform: 'scale(.6) translateY(60px)', opacity: 0}, {transform: 'none', opacity: 1}], t0, 0.55, E_BACK);
    } else {
      if (tx.label) { const l = $('div', 'label', c, tx.label); anim(l, [{transform: 'translateY(30px)', opacity: 0}, {transform: 'none', opacity: 1}], t0, 0.45); }
      const len = String(tx.title || '').length;
      const ti = words(c, tx.title, 'title', t0 + 0.1, i === 0 ? 0.045 : 0.05, emph);
      ti.style.setProperty('--k', len > 70 ? '0.7' : len > 45 ? '0.82' : '1');
      if (tx.body && opt.voice !== 'voix') words(c, tx.body, 'body', t0 + 0.6, 0.025);
    }
    if (tx.note) { const nt = $('div', 'note', c, tx.note); anim(nt, [{opacity: 0}, {opacity: 1}], t0 + 0.5, 0.5); }
    // Emphasis: a short camera punch when the key word is spoken.
    if (fx.punch) (sc.emphasis || []).forEach((e) => anim(c, [{transform: 'scale(1)'}, {transform: 'scale(1.06)'}, {transform: 'scale(1)'}], e.t - 0.05, 0.35, 'ease-out', {composite: 'add'}));
    const sh = $('div', 'sheen', el); anim(sh, [{transform: 'translateX(-60%)'}, {transform: 'translateX(60%)'}], sc.start + 0.15, 1.4, E_INOUT);
    // 3D transitions: in, and the mirrored exit of the previous scene.
    const enter = {
      cube: [{transformOrigin: '50% 50% ' + HW + 'px', transform: 'rotateY(90deg)'}, {transformOrigin: '50% 50% ' + HW + 'px', transform: 'rotateY(0deg)'}],
      flip: [{transformOrigin: '50% 50% ' + HH + 'px', transform: 'rotateX(-90deg)'}, {transformOrigin: '50% 50% ' + HH + 'px', transform: 'rotateX(0deg)'}],
      depth: [{transform: 'translateZ(700px)', opacity: 0, filter: 'blur(14px)'}, {transform: 'translateZ(0)', opacity: 1, filter: 'blur(0px)'}],
      swing: [{transformOrigin: '100% 50%', transform: 'translateX(70%) rotateY(-55deg)', opacity: 0}, {transformOrigin: '100% 50%', transform: 'translateX(0) rotateY(0)', opacity: 1}],
      zoom: [{transform: 'scale(1.8)', opacity: 0, filter: 'blur(18px)'}, {transform: 'scale(1)', opacity: 1, filter: 'blur(0px)'}],
      whip: [{transform: 'translateX(110%) skewX(-8deg)', filter: 'blur(22px)'}, {transform: 'translateX(0) skewX(0)', filter: 'blur(0px)'}],
    };
    const exit = {
      cube: [{transformOrigin: '50% 50% ' + HW + 'px', transform: 'rotateY(0deg)'}, {transformOrigin: '50% 50% ' + HW + 'px', transform: 'rotateY(-90deg)'}],
      flip: [{transformOrigin: '50% 50% ' + HH + 'px', transform: 'rotateX(0deg)'}, {transformOrigin: '50% 50% ' + HH + 'px', transform: 'rotateX(90deg)'}],
      depth: [{transform: 'translateZ(0)', opacity: 1, filter: 'blur(0px)'}, {transform: 'translateZ(-900px)', opacity: 0, filter: 'blur(10px)'}],
      swing: [{transformOrigin: '0% 50%', transform: 'translateX(0) rotateY(0)', opacity: 1}, {transformOrigin: '0% 50%', transform: 'translateX(-70%) rotateY(55deg)', opacity: 0}],
      zoom: [{transform: 'scale(1)', opacity: 1}, {transform: 'scale(.6)', opacity: 0}],
      whip: [{transform: 'translateX(0)', filter: 'blur(0px)'}, {transform: 'translateX(-110%)', filter: 'blur(22px)'}],
    };
    anim(el, enter[i === 0 ? 'depth' : sc.transition], inStart, i === 0 ? 0.8 : T, i === 0 ? E_OUT : E_INOUT);
    if (i < tl.scenes.length - 1) anim(el, exit[tl.scenes[i + 1].transition], tl.scenes[i + 1].start - T / 2, T, E_INOUT, {fill: 'forwards'});
    media.push(el);
  });
  // Character: the narrator stays on screen; a story character appears with the story scenes.
  const ch = document.getElementById('char');
  if (ch && opt.character) {
    const storyScenes = tl.scenes.filter((s) => s.layout === 'character' || (opt.character.mode === 'narrator' && s.layout !== 'product' && s.layout !== 'compare'));
    if (opt.character.mode === 'narrator') { show(ch, 0.1); anim(ch, [{transform: 'translateX(-50%) translateY(40%)'}, {transform: 'translateX(-50%) translateY(0)'}], 0.05, 0.7, E_BACK); }
    else storyScenes.forEach((s) => { show(ch, s.start, s.end); anim(ch, [{transform: 'translateX(-50%) translateY(35%) rotate(-4deg)', opacity: 0}, {transform: 'translateX(-50%) translateY(0) rotate(0)', opacity: 1}], s.start, 0.6, E_BACK); });
    const head = ch.querySelector('.char-head');
    if (head) anim(head, [{transform: 'rotate(-2deg) translateY(0)'}, {transform: 'rotate(2deg) translateY(-4px)'}], 0, 1.6, 'ease-in-out', {iterations: Math.ceil(D / 1.6), direction: 'alternate'});
    ch.querySelectorAll('.lid').forEach((lid) => { for (let t = 1.2 + rnd() * 2; t < D; t += 2.6 + rnd() * 2.2) anim(lid, [{height: '0px'}, {height: '24px'}, {height: '0px'}], t, 0.16, 'linear', {fill: 'none'}); });
  }
  // Captions: one line at a time, the spoken word lit up.
  const capBox = document.getElementById('captions');
  (tl.captions || []).forEach((cap) => {
    const line = $('div', 'cap', capBox);
    show(line, cap.start, cap.end);
    anim(line, [{transform: 'translateY(18px) scale(.94)', opacity: 0}, {transform: 'none', opacity: 1}], cap.start, 0.14);
    cap.words.forEach((w, k) => {
      if (k) line.appendChild(document.createTextNode(' '));
      const s = $('span', 'cw', line, w.text);
      anim(s, [{color: '#ffffff', transform: 'scale(1)'}, {color: opt.capColor, transform: 'scale(1.07)', offset: 0.25}, {color: opt.capColor, transform: 'scale(1.03)'}], w.start, Math.max(0.12, w.end - w.start), 'ease-out', {fill: 'none'});
    });
  });
  // HUD: the advertising mention, the handle and a progress bar for the whole video.
  const pr = document.querySelector('.progress i'); if (pr) anim(pr, [{width: '0%'}, {width: '100%'}], 0, D, 'linear');
  const grain = document.querySelector('.grain'); if (grain) anim(grain, Array.from({length: 8}, (_, k) => ({transform: 'translate(' + ((k * 37) % 100 - 50) + 'px,' + ((k * 61) % 100 - 50) + 'px)'})), 0, 0.33, 'steps(8)', {iterations: Math.ceil(D / 0.33)});
  const leak = document.querySelector('.leak'); if (leak) anim(leak, [{transform: 'translate(-10%,-5%) rotate(0deg)', opacity: .5}, {transform: 'translate(10%,6%) rotate(25deg)', opacity: 1}], 0, D, 'ease-in-out');
  const all = document.getAnimations();
  all.forEach((a) => a.pause());
  const mouth = document.getElementById('mouth');
  const pad = (n) => String(n).padStart(5, '0');
  window.__seek = (t) => {
    const ms = t * 1000;
    for (const a of all) a.currentTime = ms;
    for (const [el, ranges] of vis) el.style.visibility = ranges.some((r) => t >= r[0] && t < r[1]) ? 'visible' : 'hidden';
    if (mouth && opt.mouth) { const m = opt.mouth[Math.min(opt.mouth.length - 1, Math.round(t * tl.fps))] || 0; mouth.setAttribute('ry', String(3 + m * 17)); mouth.setAttribute('rx', String(20 - m * 5)); }
    const waits = [];
    for (const fs of frameSets) {
      if (t < fs.start - 0.05 || t > fs.end + 0.05) continue;
      const idx = Math.max(0, Math.min(fs.count - 1, Math.floor((t - fs.start) * fs.fps)));
      const src = fs.dir + '/f' + pad(idx + 1) + '.jpg';
      for (const img of fs.imgs) if (img.getAttribute('src') !== src) { img.setAttribute('src', src); waits.push(img.decode().catch(() => {})); }
    }
    return Promise.all(waits);
  };
  return window.__seek(0).then(() => D);
};
`;

export function buildVideoPage(p: PageInput): string {
  const {timeline: tl, def, palette: c, safe} = p;
  const u = Math.min(tl.width, tl.height) / 1080;
  const aspectCls = tl.aspect === '16:9' ? 'aspect-169' : tl.aspect === '1:1' ? 'aspect-11' : 'aspect-916';
  const capFont = def.captions === 'bold' ? p.fonts.heading : def.captions === 'serif' ? p.fonts.heading : p.fonts.body;
  const capSize = def.captions === 'bold' ? 74 : def.captions === 'minimal' ? 46 : def.captions === 'serif' ? 58 : 64;
  const capY = tl.aspect === '9:16' ? Math.round(tl.height * 0.64) : tl.aspect === '1:1' ? Math.round(tl.height * 0.76) : Math.round(tl.height * 0.8);
  const vars = [
    `--W:${tl.width}px`,
    `--H:${tl.height}px`,
    `--u:${u}px`,
    `--st:${safe.top}px`,
    `--sb:${safe.bottom + (tl.captions.length ? Math.round(tl.height * 0.2) : 0)}px`,
    `--sl:${safe.left}px`,
    `--sr:${safe.right}px`,
    `--cy:${capY}px`,
    `--cs:${capSize}`,
    `--stroke:${def.captions === 'bold' ? 7 : 5}`,
    `--bg:${c.bg}`,
    `--fg:${c.fg}`,
    `--accent:${c.accent}`,
    `--accent2:${c.accent2}`,
    `--muted:${c.muted}`,
    `--onAccent:${c.onAccent}`,
    `--accentText:${c.accentText}`,
    `--g1:${c.g1}`,
    `--g2:${c.g2}`,
    `--hfont:'${p.fonts.heading}'`,
    `--bfont:'${p.fonts.body}'`,
    `--cfont:'${capFont}'`,
  ].join(';');
  const fx = def.effects;
  const letterbox = fx.letterbox ? `<div class="fx"><div class="bar" style="top:0"></div><div class="bar" style="bottom:0"></div></div>` : '';
  const opt = {
    seed: p.seed,
    effects: fx,
    voice: def.voice,
    capColor: c.accent2,
    character: p.character ? {mode: p.character.mode} : null,
    mouth: p.mouth ?? null,
  };
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>${fontFaceCss([p.fonts.heading, p.fonts.body, capFont])}</style><style>:root{${vars}}${CSS}</style><script>${JS}</script></head>
<body><div id="stage" class="${aspectCls} cap-${def.captions}">
${p.character ? `<div id="char" class="${p.character.mode}">${p.character.svg}<div id="charname">${escapeHtml(p.character.name)} · personnage fictif</div></div>` : ''}
<div id="captions"></div>
${fx.vignette ? '<div class="fx vignette"></div>' : ''}${fx.lightLeak ? '<div class="fx leak"></div>' : ''}${fx.grain ? '<div class="fx grain"></div>' : ''}${letterbox}
<div id="hud"><div class="progress"><i></i></div><div class="badge">${escapeHtml(p.disclosure)}</div><div class="handle">${escapeHtml(p.handle)}</div></div>
</div><script>window.__TL = ${JSON.stringify(tl)}; window.__OPT = ${JSON.stringify(opt)};</script></body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (ch) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[ch]!);
}

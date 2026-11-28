import type {Brand, Format, SizeSpec} from '../core/config.js';
import {escapeHtml, frenchTypography, inlineMarkup} from '../core/text.js';
import type {Slide} from '../generate/types.js';
import {fontFaceCss} from './fonts.js';
import {templateById, type TemplateDef} from './templates.js';

/* ---------- colour helpers (WCAG 2.1 contrast) ---------- */

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

export function rgbToHex([r, g, b]: [number, number, number]): string {
  return '#' + [r, g, b].map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('');
}

function lum([r, g, b]: [number, number, number]): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrast(a: string, b: string): number {
  const [x, y] = [lum(hexToRgb(a)), lum(hexToRgb(b))].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

export function mix(a: string, b: string, t: number): string {
  const [x, y] = [hexToRgb(a), hexToRgb(b)];
  return rgbToHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

/** Darkens (or lightens) `color` until `text` reaches `ratio` on it. */
export function ensureContrast(color: string, text: string, ratio: number): string {
  let c = color;
  const toward = lum(hexToRgb(text)) > 0.5 ? '#000000' : '#ffffff';
  for (let i = 0; i < 20 && contrast(c, text) < ratio; i++) c = mix(c, toward, 0.08);
  return c;
}

export function onColor(bg: string): string {
  return contrast(bg, '#111111') >= contrast(bg, '#ffffff') ? '#111111' : '#ffffff';
}

export interface Palette {
  bg: string;
  fg: string;
  accent: string;
  accent2: string;
  muted: string;
}

export function resolvePalette(tpl: TemplateDef, brand: Brand): Palette & {onAccent: string; accentText: string; g1: string; g2: string} {
  const base: Palette = {...brand.palette, ...(tpl.palette ?? {})};
  // Keep the account's identity: its accent colour survives every template except luxe (gold by design).
  if (tpl.id !== 'luxe') base.accent = brand.palette.accent;
  if (contrast(base.fg, base.bg) < 7) base.fg = onColor(base.bg) === '#111111' ? '#141414' : '#FAFAFA';
  if (contrast(base.muted, base.bg) < 4.5) base.muted = mix(base.fg, base.bg, 0.3);
  const accentText = contrast(base.accent, base.bg) >= 3 ? base.accent : base.fg;
  const g1 = ensureContrast(mix(base.accent, '#000000', 0.35), base.fg, 4.6);
  const g2 = ensureContrast(mix(base.accent2, '#000000', 0.45), base.fg, 4.6);
  return {...base, onAccent: onColor(base.accent), accentText, g1, g2};
}

/* ---------- CSS ---------- */

const BASE_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:#7a7a7a}
body{display:flex;flex-direction:column;gap:40px;padding:40px;align-items:flex-start}
.slide{position:relative;width:var(--w);height:var(--h);overflow:hidden;background:var(--bg);color:var(--fg);font-family:var(--bfont),'DejaVu Sans',sans-serif;-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision;flex:none}
.deco{position:absolute;inset:0;pointer-events:none}
.photo{position:absolute;inset:0;background-size:cover;background-position:center}
.photo::after{content:'';position:absolute;inset:0;background:linear-gradient(180deg,color-mix(in srgb,var(--bg) 55%,transparent) 0%,color-mix(in srgb,var(--bg) 88%,transparent) 55%,var(--bg) 100%)}
.inner{position:absolute;top:var(--st);bottom:var(--sb);left:var(--sl);right:var(--sr);display:flex;flex-direction:column}
.top{display:flex;align-items:center;gap:18px;height:62px;flex:none}
.ad{font:800 26px/1 var(--bfont),sans-serif;letter-spacing:.03em;padding:13px 20px;border-radius:999px;background:var(--fg);color:var(--bg);white-space:nowrap}
.handle{font:600 26px/1 var(--bfont),sans-serif;color:var(--muted);white-space:nowrap}
.count{margin-left:auto;font:700 26px/1 var(--bfont),sans-serif;color:var(--muted);font-variant-numeric:tabular-nums}
.main{flex:1;display:flex;flex-direction:column;justify-content:center;min-height:0;overflow:hidden;padding:26px 0;--k:1;--kk:calc(var(--k) * var(--fs))}
.main>*{flex:none}
.bottom{flex:none;min-height:66px;display:flex;align-items:center;gap:22px}
.progress{flex:1;height:8px;border-radius:8px;background:color-mix(in srgb,var(--fg) 15%,transparent);overflow:hidden;min-width:120px}
.progress i{display:block;height:100%;background:var(--accent);border-radius:8px}
.note{font:500 24px/1.25 var(--bfont),sans-serif;color:var(--muted);max-width:72%}
h1,h2,h3,.hfont{font-family:var(--hfont),'DejaVu Sans',sans-serif}
.kicker{font:700 calc(30px*var(--kk))/1.1 var(--bfont),sans-serif;text-transform:uppercase;letter-spacing:.14em;color:var(--accent-text);margin-bottom:calc(30px*var(--kk))}
.h-cover{font-size:calc(108px*var(--kk));line-height:1.04;font-weight:800;letter-spacing:-.02em;overflow-wrap:break-word;hyphens:manual}
.sub{margin-top:calc(38px*var(--kk));font-size:calc(46px*var(--kk));line-height:1.25;color:var(--muted);font-weight:500}
.swipe{margin-top:calc(60px*var(--kk));font:700 calc(36px*var(--kk))/1 var(--bfont),sans-serif;color:var(--accent-text);display:flex;align-items:center;gap:16px}
.arrow{font-family:'DejaVu Sans',sans-serif;font-weight:700}
.num{font:800 calc(150px*var(--kk))/.9 var(--hfont),sans-serif;color:var(--accent-text);margin-bottom:calc(22px*var(--kk));font-variant-numeric:tabular-nums}
.label{font:700 calc(30px*var(--kk))/1.15 var(--bfont),sans-serif;text-transform:uppercase;letter-spacing:.12em;color:var(--accent-text);margin-bottom:calc(24px*var(--kk))}
.h-item{font-size:calc(72px*var(--kk));line-height:1.1;font-weight:800;letter-spacing:-.012em;overflow-wrap:break-word}
.p-item{margin-top:calc(32px*var(--kk));font-size:calc(46px*var(--kk));line-height:1.36;color:color-mix(in srgb,var(--fg) 88%,var(--bg))}
.compare{display:flex;flex-direction:column}
.box{border-radius:30px;padding:calc(34px*var(--kk)) calc(40px*var(--kk))}
.box p{font-size:calc(46px*var(--kk));line-height:1.3;font-weight:650}
.box-left{background:color-mix(in srgb,var(--fg) 8%,transparent)}
.box-left p{color:color-mix(in srgb,var(--fg) 78%,var(--bg))}
.box-right{background:color-mix(in srgb,var(--accent) 15%,var(--bg));border:4px solid var(--accent)}
.tag{display:inline-block;font:800 calc(26px*var(--kk))/1 var(--bfont),sans-serif;text-transform:uppercase;letter-spacing:.1em;padding:11px 18px;border-radius:999px;margin-bottom:calc(20px*var(--kk))}
.tag-left{background:color-mix(in srgb,var(--fg) 16%,transparent);color:var(--fg)}
.tag-right{background:var(--accent);color:var(--on-accent)}
.num-small{font-size:calc(72px*var(--kk));margin-bottom:calc(26px*var(--kk))}
.vs{font:800 calc(52px*var(--kk))/1 'DejaVu Sans',sans-serif;color:var(--accent-text);text-align:center;margin:calc(16px*var(--kk)) 0}
.quote-mark{font:900 calc(230px*var(--kk))/.8 var(--hfont),serif;color:var(--accent-text);height:calc(130px*var(--kk));overflow:hidden}
.h-quote{font-size:calc(66px*var(--kk));line-height:1.2;font-weight:700}
.h-cta{font-size:calc(88px*var(--kk));line-height:1.05;font-weight:800;letter-spacing:-.015em}
.p-cta{margin-top:calc(26px*var(--kk));font-size:calc(48px*var(--kk));line-height:1.3}
.product{margin-top:calc(56px*var(--kk));padding:calc(38px*var(--kk)) calc(42px*var(--kk));border-radius:32px;background:var(--accent);color:var(--on-accent)}
.product b{display:block;font:800 calc(42px*var(--kk))/1.1 var(--hfont),sans-serif;margin-bottom:calc(14px*var(--kk))}
.product span{font-size:calc(38px*var(--kk));line-height:1.3;font-weight:550}
.figure{margin-top:calc(30px*var(--kk))}
.figure img{display:block;max-width:100%;max-height:calc(var(--h) * .45);margin:0 auto;border-radius:22px;box-shadow:0 24px 60px rgba(0,0,0,.35);background:#fff}
.figcap{margin-top:18px;font-size:calc(28px*var(--kk));color:var(--muted);text-align:center}
mark{background:none;color:var(--accent-text)}
`;

const TEMPLATE_CSS: Record<string, string> = {
  minimaliste: `
.t-minimaliste .cover::before{content:'';display:block;width:128px;height:16px;border-radius:9px;background:var(--accent);margin-bottom:52px}
.t-minimaliste .num{font-size:calc(64px*var(--kk));color:var(--muted);font-weight:700}
.t-minimaliste .h-item::after,.t-minimaliste .h-content::after{content:'';display:block;width:100px;height:10px;background:var(--accent);border-radius:6px;margin-top:calc(36px*var(--kk))}`,
  storytelling: `
.t-storytelling .deco{inset:34px;border:3px solid color-mix(in srgb,var(--accent) 55%,transparent);border-radius:8px}
.t-storytelling .h-cover,.t-storytelling .h-item,.t-storytelling .h-quote,.t-storytelling .h-cta,.t-storytelling .h-content{font-weight:700;letter-spacing:0}
.t-storytelling .label{font-family:var(--hfont),serif;font-style:italic;text-transform:none;letter-spacing:0;font-size:calc(44px*var(--kk));color:var(--accent2)}
.t-storytelling .num{font-weight:400;font-style:italic}`,
  educatif: `
.t-educatif .deco{background-image:linear-gradient(color-mix(in srgb,var(--fg) 6%,transparent) 2px,transparent 2px),linear-gradient(90deg,color-mix(in srgb,var(--fg) 6%,transparent) 2px,transparent 2px);background-size:54px 54px}
.t-educatif .num{width:calc(150px*var(--kk));height:calc(150px*var(--kk));border-radius:50%;background:var(--accent);color:var(--on-accent);display:flex;align-items:center;justify-content:center;font-size:calc(76px*var(--kk))}
.t-educatif .p-item,.t-educatif .p-content{background:color-mix(in srgb,var(--accent) 12%,var(--bg));border-left:10px solid var(--accent);padding:calc(28px*var(--kk)) calc(32px*var(--kk));border-radius:0 22px 22px 0}`,
  luxe: `
.t-luxe .deco{inset:40px;border:2px solid color-mix(in srgb,var(--accent) 72%,transparent)}
.t-luxe .deco::after{content:'';position:absolute;inset:14px;border:1px solid color-mix(in srgb,var(--accent) 38%,transparent)}
.t-luxe .main{align-items:center;text-align:center}
.t-luxe .h-cover,.t-luxe .h-item,.t-luxe .h-cta,.t-luxe .h-quote,.t-luxe .h-content{font-weight:400;letter-spacing:.005em}
.t-luxe .label,.t-luxe .kicker{letter-spacing:.32em;font-weight:600;font-size:calc(26px*var(--kk))}
.t-luxe .num{font-weight:400;font-size:calc(116px*var(--kk))}
.t-luxe .h-item::before,.t-luxe .h-content::before{content:'';display:block;width:110px;height:2px;background:var(--accent);margin:0 auto calc(38px*var(--kk))}
.t-luxe .ad{background:transparent;color:var(--accent);border:2px solid var(--accent)}
.t-luxe .product{background:transparent;border:2px solid var(--accent);color:var(--fg)}
.t-luxe .swipe{justify-content:center}`,
  business: `
.t-business .deco::before{content:'';position:absolute;left:0;right:0;top:0;height:16px;background:var(--accent)}
.t-business .item,.t-business .content{background:color-mix(in srgb,var(--fg) 6%,transparent);border-radius:34px;padding:calc(50px*var(--kk)) calc(48px*var(--kk))}
.t-business .num{font-size:calc(84px*var(--kk))}`,
  motivation: `
.t-motivation .deco{background:linear-gradient(155deg,var(--g1) 0%,var(--g2) 100%)}
.t-motivation .deco::after{content:'';position:absolute;inset:0;background:radial-gradient(circle at 82% 8%,rgba(255,255,255,.16),transparent 42%)}
.t-motivation .main{align-items:center;text-align:center}
.t-motivation .h-cover,.t-motivation .h-item,.t-motivation .h-cta,.t-motivation .h-content,.t-motivation .h-quote{text-transform:uppercase;font-weight:400;letter-spacing:.01em;line-height:1.02}
.t-motivation .h-cover{font-size:calc(132px*var(--kk))}
.t-motivation .h-item{font-size:calc(94px*var(--kk))}
.t-motivation .p-item,.t-motivation .sub,.t-motivation .p-cta{color:var(--fg)}
.t-motivation .label,.t-motivation .num,.t-motivation .swipe,.t-motivation .kicker,.t-motivation mark{color:var(--fg)}
.t-motivation .handle,.t-motivation .count,.t-motivation .note{color:color-mix(in srgb,var(--fg) 85%,transparent)}
.t-motivation .box-right{background:color-mix(in srgb,#000 22%,transparent);border-color:var(--fg)}
.t-motivation .tag-right{background:var(--fg);color:#111}
.t-motivation .product{background:#ffffff;color:#111111}
.t-motivation .progress i{background:var(--fg)}`,
  curiosite: `
.t-curiosite .deco::before{content:'?';position:absolute;right:-60px;bottom:-150px;font:400 980px/1 var(--hfont),sans-serif;color:color-mix(in srgb,var(--accent) 11%,transparent)}
.t-curiosite .h-cover,.t-curiosite .h-item,.t-curiosite .h-cta,.t-curiosite .h-content,.t-curiosite .h-quote,.t-curiosite .num{font-weight:400}
.t-curiosite .num,.t-curiosite .swipe,.t-curiosite mark{text-shadow:0 0 34px color-mix(in srgb,var(--accent) 65%,transparent)}`,
  liste: `
.t-liste .num{font-size:calc(240px*var(--kk));color:transparent;-webkit-text-stroke:6px var(--accent);font-weight:900;line-height:.84}
.t-liste .h-item{font-weight:800}
.t-liste .num.num-small{font-size:calc(120px*var(--kk));-webkit-text-stroke-width:4px}`,
  'avant-apres': `
.t-avant-apres .box-left{border:4px dashed color-mix(in srgb,var(--fg) 28%,transparent);background:transparent}
.t-avant-apres .box-right{box-shadow:0 18px 50px color-mix(in srgb,var(--accent) 30%,transparent)}
.t-avant-apres .vs{font-size:calc(64px*var(--kk))}`,
  anecdotes: `
.t-anecdotes .deco{background-image:repeating-linear-gradient(transparent 0 62px,color-mix(in srgb,var(--fg) 9%,transparent) 62px 64px)}
.t-anecdotes .deco::before{content:'';position:absolute;left:52px;top:0;bottom:0;width:3px;background:color-mix(in srgb,var(--accent) 50%,transparent)}
.t-anecdotes .h-cover,.t-anecdotes .h-item,.t-anecdotes .h-cta,.t-anecdotes .h-quote,.t-anecdotes .h-content{font-weight:700;letter-spacing:0;line-height:1.02}
.t-anecdotes .h-cover{font-size:calc(128px*var(--kk))}
.t-anecdotes .h-item,.t-anecdotes .h-content{font-size:calc(88px*var(--kk))}
.t-anecdotes .h-quote{font-size:calc(80px*var(--kk))}
.t-anecdotes .label{transform:rotate(-2deg);display:inline-block;align-self:flex-start;background:var(--accent);color:var(--on-accent);padding:12px 20px;border-radius:8px}`,
};

const FIT_SCRIPT = `
window.__fit = () => {
  const out = [];
  document.querySelectorAll('.slide').forEach((s, i) => {
    const m = s.querySelector('.main');
    let k = 1;
    const over = () => m.scrollHeight > m.clientHeight + 1 || m.scrollWidth > m.clientWidth + 1;
    m.style.setProperty('--k', k);
    while (over() && k > 0.56) { k = Math.round((k - 0.03) * 100) / 100; m.style.setProperty('--k', k); }
    let minFont = 999;
    m.querySelectorAll('*').forEach((el) => {
      if (!el.childNodes.length || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) return;
      const f = parseFloat(getComputedStyle(el).fontSize);
      if (f < minFont) minFont = f;
    });
    out.push({index: i, k, overflow: over(), minFont: Math.round(minFont)});
  });
  return out;
};`;

export interface HtmlInput {
  slides: Slide[];
  template: string;
  format: Format;
  size: SizeSpec;
  brand: Brand;
  disclosure: {badge: string; everySlide: boolean};
  topicLabel?: string;
  /** Absolute paths to images (cover photo, captures). */
  coverPhoto?: string | null;
}

export interface ContrastReport {
  text: number;
  muted: number;
  onAccent: number;
  badge: number;
}

const fr = (s: string | undefined) => (s ? inlineMarkup(frenchTypography(s)) : '');

function slideInner(s: Slide, i: number, total: number, tpl: TemplateDef, input: HtmlInput): string {
  const swipeText = tpl.id === 'curiosite' ? 'La réponse' : 'Fais défiler';
  switch (s.kind) {
    case 'cover':
      return `<div class="cover">${input.topicLabel ? `<div class="kicker">${escapeHtml(input.topicLabel)}</div>` : ''}<h1 class="h-cover">${fr(s.title)}</h1>${s.body ? `<p class="sub">${fr(s.body)}</p>` : ''}<div class="swipe">${swipeText} <span class="arrow">→</span></div></div>`;
    case 'item':
      return `<div class="item">${s.number ? `<div class="num">${String(s.number).padStart(2, '0')}</div>` : ''}${s.label ? `<div class="label">${fr(s.label)}</div>` : ''}<h2 class="h-item">${fr(s.title)}</h2>${s.body ? `<p class="p-item">${fr(s.body)}</p>` : ''}</div>`;
    case 'compare':
      return `<div class="compare">${s.number ? `<div class="num num-small">${String(s.number).padStart(2, '0')}</div>` : ''}${s.label ? `<div class="label">${fr(s.label)}</div>` : ''}<div class="box box-left"><span class="tag tag-left">${fr(s.leftLabel ?? 'Avant')}</span><p>${fr(s.left)}</p></div><div class="vs">↓</div><div class="box box-right"><span class="tag tag-right">${fr(s.rightLabel ?? 'Après')}</span><p>${fr(s.right)}</p></div></div>`;
    case 'quote':
      return `<div class="quote">${s.label ? `<div class="label">${fr(s.label)}</div>` : ''}<div class="quote-mark">“</div><h2 class="h-quote">${fr(s.title)}</h2>${s.body ? `<p class="p-item">${fr(s.body)}</p>` : ''}</div>`;
    case 'cta':
      return `<div class="cta"><h2 class="h-cta">${fr(s.title)}</h2>${s.body ? `<p class="p-cta">${fr(s.body)}</p>` : ''}${s.product ? `<div class="product"><b>${fr(s.product.title)}</b><span>${fr(s.product.body)}</span></div>` : ''}</div>`;
    case 'image':
      return `<div class="content">${s.label ? `<div class="label">${fr(s.label)}</div>` : ''}<h2 class="h-item h-content">${fr(s.title)}</h2>${s.image ? `<div class="figure"><img src="file://${escapeHtml(s.image.path)}" alt="${escapeHtml(s.image.alt ?? '')}"><div class="figcap">${fr(s.image.credit ?? '')}</div></div>` : ''}</div>`;
    case 'content':
    default:
      return `<div class="content">${s.label ? `<div class="label">${fr(s.label)}</div>` : ''}<h2 class="h-item h-content">${fr(s.title)}</h2>${s.body ? `<p class="p-item p-content">${fr(s.body)}</p>` : ''}</div>`;
  }
}

export function buildHtml(input: HtmlInput): {html: string; contrast: ContrastReport} {
  const tpl = templateById(input.template);
  const pal = resolvePalette(tpl, input.brand);
  const hfont = tpl.fonts.heading;
  const bfont = tpl.id === 'minimaliste' || tpl.id === 'educatif' || tpl.id === 'liste' || tpl.id === 'avant-apres' ? input.brand.fonts.body || tpl.fonts.body : tpl.fonts.body;
  const headingFont = tpl.palette === null && input.brand.fonts.heading && ['minimaliste', 'educatif', 'avant-apres'].includes(tpl.id) ? input.brand.fonts.heading : hfont;
  const {width, height, safe} = input.size;
  const total = input.slides.length;
  const fs = input.format === '9:16' ? 1.16 : input.format === '1:1' ? 0.86 : 1;
  const vars = `--fs:${fs};--w:${width}px;--h:${height}px;--st:${safe.top}px;--sb:${safe.bottom}px;--sl:${safe.left}px;--sr:${safe.right}px;--bg:${pal.bg};--fg:${pal.fg};--accent:${pal.accent};--accent2:${pal.accent2};--muted:${pal.muted};--on-accent:${pal.onAccent};--accent-text:${pal.accentText};--g1:${pal.g1};--g2:${pal.g2};--hfont:'${headingFont}';--bfont:'${bfont}'`;
  const sections = input.slides
    .map((s, i) => {
      const showBadge = input.disclosure.everySlide || i === 0;
      const photo = i === 0 && input.coverPhoto ? `<div class="photo" style="background-image:url('file://${escapeHtml(input.coverPhoto)}')"></div>` : '';
      return `<section class="slide t-${tpl.id} kind-${s.kind}" data-index="${i}" style="${vars}">${photo}<div class="deco"></div><div class="inner"><header class="top">${
        showBadge ? `<span class="ad">${escapeHtml(input.disclosure.badge)}</span>` : ''
      }<span class="handle">${escapeHtml(input.brand.handle)}</span><span class="count">${i + 1}/${total}</span></header><main class="main">${slideInner(s, i, total, tpl, input)}</main><footer class="bottom"><div class="progress"><i style="width:${Math.round(((i + 1) / total) * 100)}%"></i></div>${s.note ? `<span class="note">${fr(s.note)}</span>` : ''}</footer></div></section>`;
    })
    .join('\n');
  const css = fontFaceCss([headingFont, bfont, 'Inter']) + BASE_CSS + (TEMPLATE_CSS[tpl.id] ?? '');
  const bgForText = tpl.id === 'motivation' ? pal.g1 : pal.bg;
  const report: ContrastReport = {
    text: Math.round(Math.min(contrast(pal.fg, bgForText), tpl.id === 'motivation' ? contrast(pal.fg, pal.g2) : 99) * 100) / 100,
    muted: Math.round(contrast(pal.muted, pal.bg) * 100) / 100,
    onAccent: Math.round(contrast(pal.onAccent, pal.accent) * 100) / 100,
    badge: Math.round(contrast(pal.bg, pal.fg) * 100) / 100,
  };
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>slides</title><style>${css}</style><script>${FIT_SCRIPT}</script></head><body>${sections}</body></html>`;
  return {html, contrast: report};
}

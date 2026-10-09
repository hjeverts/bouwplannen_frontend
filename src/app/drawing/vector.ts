/**
 * Small vector-drawing format for plans, elevations and 3D views, and an SVG renderer for it.
 *
 * Geometry is in metres (model space, y up). Text sizes, dimension offsets and line widths are in
 * millimetres on paper, so the same drawing can be shown on screen (fitted to the available space)
 * or printed at a true scale such as 1:100.
 */
import { Point } from '../geometry/geometry';

export type Prim =
  | { t: 'poly'; rings: Point[][]; cls: string; fill?: string }
  | { t: 'line'; pts: Point[]; cls: string; closed?: boolean }
  | {
      t: 'text';
      at: Point;
      text: string;
      cls: string;
      /** Height of the text on paper, mm. */
      size?: number;
      anchor?: 'start' | 'middle' | 'end';
      /** Rotation in degrees, counter-clockwise as seen on the page. */
      angle?: number;
      /** Shift on paper in mm (x right, y up). */
      dx?: number;
      dy?: number;
    }
  | {
      t: 'dim';
      a: Point;
      b: Point;
      /** Distance of the dimension line from a–b on paper (mm), to the left of a→b; negative = right. */
      off: number;
      text: string;
      /** Draw extension lines from the measured points (default true). */
      ext?: boolean;
    };

export interface View {
  prims: Prim[];
  /** Shown above the drawing on paper. */
  title?: string;
  /** False for the 3D view: it is not at a measurable scale. */
  scalable?: boolean;
}

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const TEXT = 2.6;
const TICK = 1.6;
const EXT_GAP = 1;
const EXT_OVER = 1.5;

/** Placement of a view on paper: paper units per metre (scale) and per mm (k), origin offset. */
export interface Placement {
  /** Paper units per metre of the model. */
  scale: number;
  /** Paper units per millimetre of paper (1 when the paper is in mm, ~4 for screen pixels). */
  k: number;
  /** Paper position of model point (0, 0). y on paper points down. */
  ox: number;
  oy: number;
}

const toPaper = (p: Point, pl: Placement): Point => ({ x: pl.ox + p.x * pl.scale, y: pl.oy - p.y * pl.scale });

function textWidth(text: string, size: number): number {
  return text.length * size * 0.56;
}

/** Bounding box on paper of everything in the view, for a given placement. */
export function measure(view: View, pl: Placement): Box {
  const box: Box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const addPt = (p: Point) => {
    box.minX = Math.min(box.minX, p.x);
    box.maxX = Math.max(box.maxX, p.x);
    box.minY = Math.min(box.minY, p.y);
    box.maxY = Math.max(box.maxY, p.y);
  };
  for (const p of view.prims) {
    if (p.t === 'poly') p.rings.forEach((r) => r.forEach((q) => addPt(toPaper(q, pl))));
    else if (p.t === 'line') p.pts.forEach((q) => addPt(toPaper(q, pl)));
    else if (p.t === 'text') {
      const s = (p.size ?? TEXT) * pl.k;
      const c = toPaper(p.at, pl);
      const x = c.x + (p.dx ?? 0) * pl.k;
      const y = c.y - (p.dy ?? 0) * pl.k;
      const w = textWidth(p.text, s);
      const r = Math.hypot(w, s);
      if (p.angle) {
        addPt({ x: x - r, y: y - r });
        addPt({ x: x + r, y: y + r });
      } else {
        const left = p.anchor === 'start' ? x : p.anchor === 'end' ? x - w : x - w / 2;
        addPt({ x: left, y: y - s * 0.6 });
        addPt({ x: left + w, y: y + s * 0.6 });
      }
    } else {
      const g = dimGeometry(p, pl);
      [g.a1, g.b1, g.a0, g.b0].forEach(addPt);
      const s = TEXT * pl.k;
      const w = textWidth(p.text, s);
      addPt({ x: g.tx - w / 2, y: g.ty - s });
      addPt({ x: g.tx + w / 2, y: g.ty + s });
    }
  }
  return box;
}

function dimGeometry(p: Extract<Prim, { t: 'dim' }>, pl: Placement) {
  const A = toPaper(p.a, pl);
  const B = toPaper(p.b, pl);
  const len = Math.hypot(B.x - A.x, B.y - A.y) || 1;
  const u = { x: (B.x - A.x) / len, y: (B.y - A.y) / len };
  // Left of a→b in model space (y up) is (u.y, -u.x) on paper (y down).
  const n = { x: u.y, y: -u.x };
  const off = p.off * pl.k;
  const a1 = { x: A.x + n.x * off, y: A.y + n.y * off };
  const b1 = { x: B.x + n.x * off, y: B.y + n.y * off };
  const sign = Math.sign(off) || 1;
  const gap = EXT_GAP * pl.k * sign;
  const over = EXT_OVER * pl.k * sign;
  const a0 = { x: A.x + n.x * gap, y: A.y + n.y * gap };
  const b0 = { x: B.x + n.x * gap, y: B.y + n.y * gap };
  const a2 = { x: a1.x + n.x * over, y: a1.y + n.y * over };
  const b2 = { x: b1.x + n.x * over, y: b1.y + n.y * over };
  let angle = (Math.atan2(u.y, u.x) * 180) / Math.PI;
  // Keep text readable: never upside down.
  if (angle > 90.5) angle -= 180;
  if (angle <= -89.5) angle += 180;
  // Text centred beside the dimension line, on the side away from the object.
  const fits = len > textWidth(p.text, TEXT * pl.k) + 1.5 * pl.k;
  // Text centred beside the dimension line, away from the object; when it does not fit between
  // the ticks it goes on the other side, so it does not run into the neighbouring dimension.
  const away = (0.8 + TEXT * 0.55) * pl.k * sign * (fits ? 1 : -1);
  const mid = { x: (a1.x + b1.x) / 2, y: (a1.y + b1.y) / 2 };
  const tx = mid.x + n.x * away;
  const ty = mid.y + n.y * away;
  return { A, B, a0, b0, a1, b1, a2, b2, u, len, angle, tx, ty, fits };
}

/** Largest placement that fits the view into a w × h box (paper units), centred. */
export function fit(view: View, w: number, h: number, k: number): Placement {
  const probe = (scale: number) => measure(view, { scale, k, ox: 0, oy: 0 });
  const model = measure({ prims: view.prims.filter((p) => p.t === 'poly' || p.t === 'line') }, { scale: 1, k, ox: 0, oy: 0 });
  const mw = Math.max(model.maxX - model.minX, 1e-6);
  const mh = Math.max(model.maxY - model.minY, 1e-6);
  // Paper extras (text, dimensions) do not grow with the scale: solve in two steps.
  let scale = Math.min(w / mw, h / mh);
  for (let i = 0; i < 3; i++) {
    const b = probe(scale);
    const extraW = b.maxX - b.minX - mw * scale;
    const extraH = b.maxY - b.minY - mh * scale;
    scale = Math.max(1e-6, Math.min((w - extraW) / mw, (h - extraH) / mh));
  }
  const b = probe(scale);
  return { scale, k, ox: (w - (b.maxX - b.minX)) / 2 - b.minX, oy: (h - (b.maxY - b.minY)) / 2 - b.minY };
}

/** Scale denominators used on building drawings, most detailed first. */
export const SCALES = [20, 25, 50, 100, 200, 250, 500, 1000];

/** Largest standard scale (1:n) at which the view fits into w × h mm. */
export function fitStandard(view: View, w: number, h: number): { placement: Placement; denominator: number } {
  for (const n of SCALES) {
    const scale = 1000 / n;
    const b = measure(view, { scale, k: 1, ox: 0, oy: 0 });
    if (b.maxX - b.minX <= w && b.maxY - b.minY <= h) {
      return { denominator: n, placement: { scale, k: 1, ox: (w - (b.maxX - b.minX)) / 2 - b.minX, oy: (h - (b.maxY - b.minY)) / 2 - b.minY } };
    }
  }
  const placement = fit(view, w, h, 1);
  return { placement, denominator: Math.round(1000 / placement.scale) };
}

/** Classes get a prefix so the app's own stylesheet never applies to the drawings. */
export const cx = (cls: string) => cls.split(' ').filter(Boolean).map((c) => `bp-${c}`).join(' ');

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n2 = (v: number) => (Math.round(v * 100) / 100).toString();

function pathOf(rings: Point[][], pl: Placement): string {
  return rings
    .filter((r) => r.length >= 2)
    .map((r) => r.map((p, i) => `${i ? 'L' : 'M'}${n2(toPaper(p, pl).x)} ${n2(toPaper(p, pl).y)}`).join('') + 'Z')
    .join('');
}

/** SVG markup (no outer <svg>) for a view at a placement. */
export function renderPrims(view: View, pl: Placement): string {
  const out: string[] = [];
  for (const p of view.prims) {
    if (p.t === 'poly') {
      const fill = p.fill ? ` style="fill:${p.fill}"` : '';
      out.push(`<path class="${cx(p.cls)}" d="${pathOf(p.rings, pl)}" fill-rule="evenodd"${fill}/>`);
    } else if (p.t === 'line') {
      const d = p.pts.map((q, i) => `${i ? 'L' : 'M'}${n2(toPaper(q, pl).x)} ${n2(toPaper(q, pl).y)}`).join('') + (p.closed ? 'Z' : '');
      out.push(`<path class="${cx(p.cls)}" d="${d}"/>`);
    } else if (p.t === 'text') {
      const c = toPaper(p.at, pl);
      const x = c.x + (p.dx ?? 0) * pl.k;
      const y = c.y - (p.dy ?? 0) * pl.k;
      const size = (p.size ?? TEXT) * pl.k;
      const rot = p.angle ? ` transform="rotate(${n2(-p.angle)} ${n2(x)} ${n2(y)})"` : '';
      out.push(
        `<text class="${cx(p.cls)}" x="${n2(x)}" y="${n2(y)}" font-size="${n2(size)}" text-anchor="${p.anchor ?? 'middle'}" dominant-baseline="central"${rot}>${esc(p.text)}</text>`,
      );
    } else {
      const g = dimGeometry(p, pl);
      const parts: string[] = [];
      if (p.ext !== false) parts.push(`M${n2(g.a0.x)} ${n2(g.a0.y)}L${n2(g.a2.x)} ${n2(g.a2.y)}M${n2(g.b0.x)} ${n2(g.b0.y)}L${n2(g.b2.x)} ${n2(g.b2.y)}`);
      parts.push(`M${n2(g.a1.x)} ${n2(g.a1.y)}L${n2(g.b1.x)} ${n2(g.b1.y)}`);
      // Architectural ticks: short 45° strokes.
      const t = (TICK / 2) * pl.k;
      const d = { x: (g.u.x - g.u.y) * t * Math.SQRT1_2, y: (g.u.y + g.u.x) * t * Math.SQRT1_2 };
      for (const q of [g.a1, g.b1]) parts.push(`M${n2(q.x - d.x)} ${n2(q.y - d.y)}L${n2(q.x + d.x)} ${n2(q.y + d.y)}`);
      out.push(`<path class="bp-dim-line" d="${parts.join('')}"/>`);
      const size = TEXT * pl.k;
      out.push(
        `<text class="bp-dim-text" x="${n2(g.tx)}" y="${n2(g.ty)}" font-size="${n2(size)}" text-anchor="middle" dominant-baseline="central" transform="rotate(${n2(g.angle)} ${n2(g.tx)} ${n2(g.ty)})">${esc(p.text)}</text>`,
      );
    }
  }
  return out.join('');
}

/** Styles for the drawings; line widths in paper mm times k. Colours fall back to print colours outside the app. */
export function drawingStyle(k: number): string {
  const w = (mm: number) => n2(mm * k);
  return `
.bp{color:var(--ink,#1d2321);font-family:var(--font-num,'IBM Plex Mono',monospace)}
.bp text{fill:currentColor;stroke:none}
.bp .bp-wall{fill:currentColor;fill-opacity:.82;stroke:currentColor;stroke-width:${w(0.35)}}
.bp .bp-room{fill:var(--surface,#fff);stroke:currentColor;stroke-width:${w(0.18)}}
.bp .bp-void{fill:var(--paper,#f1f2ed);stroke:currentColor;stroke-width:${w(0.25)}}
.bp .bp-gap{fill:var(--surface,#fff);stroke:none}
.bp .bp-sym{fill:none;stroke:currentColor;stroke-width:${w(0.18)}}
.bp .bp-sym-thin{fill:none;stroke:currentColor;stroke-width:${w(0.13)};stroke-dasharray:${w(1)} ${w(0.7)}}
.bp .bp-roof-line{fill:none;stroke:currentColor;stroke-width:${w(0.18)};stroke-dasharray:${w(3)} ${w(1.2)}}
.bp .bp-ridge-line{fill:none;stroke:currentColor;stroke-width:${w(0.25)};stroke-dasharray:${w(6)} ${w(1.2)} ${w(1)} ${w(1.2)}}
.bp .bp-ground{fill:none;stroke:currentColor;stroke-width:${w(0.5)}}
.bp .bp-f{stroke:var(--ink,#1d2321);stroke-width:${w(0.18)};stroke-linejoin:round}
.bp .bp-f-glass{fill:#8fb3c9;stroke:var(--ink,#1d2321);stroke-width:${w(0.15)}}
.bp .bp-f-door{fill:#7a5a40;stroke:var(--ink,#1d2321);stroke-width:${w(0.15)}}
.bp .bp-dim-line{fill:none;stroke:var(--dim,#1f5f8b);stroke-width:${w(0.15)}}
.bp .bp-dim-text{fill:var(--dim,#1f5f8b)}
.bp .bp-label{font-family:var(--font-body,'IBM Plex Sans',sans-serif);font-weight:600}
.bp .bp-label-sub{font-family:var(--font-num,monospace);fill-opacity:.75}
.bp .bp-muted{fill-opacity:.7}
.bp .bp-on-dark{fill:#fff}
.bp .bp-title{font-family:var(--font-display,'Barlow Condensed',sans-serif);font-weight:700;letter-spacing:.02em}
.bp .bp-frame{fill:none;stroke:currentColor;stroke-width:${w(0.35)}}
.bp .bp-frame-thin{fill:none;stroke:currentColor;stroke-width:${w(0.18)}}
`;
}

/** A complete SVG for the screen: width × height px, view fitted inside with a margin. */
export function renderFitted(view: View, width: number, height: number, k = 4, margin = 3): string {
  const pl = fit(view, width - 2 * margin * k, height - 2 * margin * k, k);
  pl.ox += margin * k;
  pl.oy += margin * k;
  return `<svg xmlns="http://www.w3.org/2000/svg" class="bp" viewBox="0 0 ${n2(width)} ${n2(height)}" width="100%" role="img"><style>${drawingStyle(k)}</style>${renderPrims(view, pl)}</svg>`;
}

/** Natural height for a given width: the view's aspect ratio including its labels. */
export function heightFor(view: View, width: number, k = 4, margin = 3, max = Infinity): number {
  const model = measure({ prims: view.prims.filter((p) => p.t === 'poly' || p.t === 'line') }, { scale: 1, k, ox: 0, oy: 0 });
  const mw = Math.max(model.maxX - model.minX, 1e-6);
  const mh = Math.max(model.maxY - model.minY, 1e-6);
  // Same two-step solve as fit(), for the width only.
  let scale = (width - 2 * margin * k) / mw;
  for (let i = 0; i < 3; i++) {
    const b = measure(view, { scale, k, ox: 0, oy: 0 });
    scale = Math.max(1e-6, (width - 2 * margin * k - (b.maxX - b.minX - mw * scale)) / mw);
  }
  const b = measure(view, { scale, k, ox: 0, oy: 0 });
  return Math.min(max, b.maxY - b.minY + 2 * margin * k + mh * 0);
}

/**
 * Materials of the outside of a building: wall cladding (gevelbekleding), window frames
 * (kozijnen) and roof covering (dakbedekking), with a colour each, and the line patterns that
 * show them in the 3D view and the elevations (brick courses, boards, tile rows, corrugations).
 */
import type { Face, P3 } from './building';

/** A material with a colour (hex, "#rrggbb"). */
export interface Finish {
  type: string;
  colour: string;
}

/** The outside of one floor. */
export interface Look {
  /** Cladding of the walls; null = the plain default colour. */
  cladding: Finish | null;
  /** Per room (Vorm id), a cladding of its own (an extension in wood against a brick house). */
  rooms: Record<string, Finish>;
  /** Colour of window frames and doors; null = default. */
  frame: string | null;
  /** Per roof (key of the roof in the plan). */
  roofs: Record<string, { covering: Finish | null; dormer: Finish | null }>;
}

export interface Pattern {
  /** Horizontal lines (along the plane) every … m: brick courses, boards, tile rows. */
  rows?: number;
  /** Short joints across each row every … m, staggered by half on every other row (bricks, slates). */
  joints?: { every: number; stagger: boolean };
  /** Lines up the plane every … m: vertical boards, corrugations, standing seams, panel joints. */
  cols?: number;
}

export interface MaterialType {
  id: string;
  label: string;
  colour: string;
  pattern: Pattern;
}

export const CLADDING_TYPES: MaterialType[] = [
  { id: 'metselwerk', label: 'Metselwerk (baksteen)', colour: '#9b4a34', pattern: { rows: 0.0625, joints: { every: 0.21, stagger: true } } },
  { id: 'rabat', label: 'Rabatdelen horizontaal', colour: '#262626', pattern: { rows: 0.15 } },
  { id: 'potdeksel', label: 'Potdekselwerk', colour: '#b5895a', pattern: { rows: 0.19 } },
  { id: 'verticaal', label: 'Delen verticaal', colour: '#8f8c84', pattern: { cols: 0.14 } },
  { id: 'stuc', label: 'Stucwerk / pleister', colour: '#efeee8', pattern: {} },
  { id: 'gevelplaat', label: 'Gevelplaten', colour: '#3f4447', pattern: { rows: 2.5, cols: 1.25 } },
  { id: 'sandwich', label: 'Sandwichpanelen', colour: '#c9c9c3', pattern: { rows: 1 } },
  { id: 'golfplaat', label: 'Golfplaat', colour: '#8e918d', pattern: { cols: 0.177 } },
];

export const ROOF_TYPES: MaterialType[] = [
  { id: 'pannen', label: 'Dakpannen', colour: '#8d3f2a', pattern: { rows: 0.33, cols: 0.21 } },
  { id: 'leien', label: 'Leien', colour: '#3d4043', pattern: { rows: 0.2, joints: { every: 0.25, stagger: true } } },
  { id: 'golfplaat', label: 'Golfplaten', colour: '#8b8f8e', pattern: { cols: 0.177 } },
  { id: 'damwand', label: 'Damwand / dakplaten (staal)', colour: '#3d4043', pattern: { cols: 0.25 } },
  { id: 'felsdak', label: 'Zink / felsdak', colour: '#8d9395', pattern: { cols: 0.5 } },
  { id: 'bitumen', label: 'Bitumen / EPDM', colour: '#242424', pattern: { rows: 1 } },
  { id: 'riet', label: 'Riet', colour: '#8a7448', pattern: { rows: 0.3 } },
  { id: 'sedum', label: 'Sedum (groendak)', colour: '#586b44', pattern: {} },
];

export interface NamedColour {
  name: string;
  hex: string;
}

export const WALL_COLOURS: NamedColour[] = [
  { name: 'Rood', hex: '#9b4a34' },
  { name: 'Roodbruin', hex: '#7a3b2a' },
  { name: 'Bruin', hex: '#6b4a35' },
  { name: 'Geel / zand', hex: '#d1b27a' },
  { name: 'Wit', hex: '#efeee8' },
  { name: 'Lichtgrijs', hex: '#c9c9c3' },
  { name: 'Grijs', hex: '#8e918d' },
  { name: 'Antraciet', hex: '#3f4447' },
  { name: 'Zwart', hex: '#262626' },
  { name: 'Hout naturel', hex: '#b5895a' },
  { name: 'Hout vergrijsd', hex: '#8f8c84' },
  { name: 'Groen', hex: '#3e5b46' },
  { name: 'Blauw', hex: '#3e5a73' },
];

export const FRAME_COLOURS: NamedColour[] = [
  { name: 'Wit', hex: '#f4f4ef' },
  { name: 'Crème', hex: '#e8dfc4' },
  { name: 'Lichtgrijs', hex: '#b9bcb7' },
  { name: 'Antraciet', hex: '#383e42' },
  { name: 'Zwart', hex: '#1e1e1e' },
  { name: 'Groen', hex: '#2f4a3a' },
  { name: 'Blauw', hex: '#2d4560' },
  { name: 'Rood', hex: '#7a2b23' },
  { name: 'Hout naturel', hex: '#9a6b43' },
];

export const ROOF_COLOURS: NamedColour[] = [
  { name: 'Rood', hex: '#8d3f2a' },
  { name: 'Oranje', hex: '#b5582f' },
  { name: 'Bruin', hex: '#5e3d2c' },
  { name: 'Antraciet', hex: '#3d4043' },
  { name: 'Zwart', hex: '#242424' },
  { name: 'Grijs', hex: '#8b8f8e' },
  { name: 'Blauwgrijs', hex: '#55606a' },
  { name: 'Groen', hex: '#586b44' },
  { name: 'Riet naturel', hex: '#8a7448' },
  { name: 'Zink', hex: '#8d9395' },
];

const ALL_TYPES = [...CLADDING_TYPES, ...ROOF_TYPES];

export function isHex(s: string | undefined | null): s is string {
  return !!s && /^#[0-9a-f]{6}$/i.test(s);
}

/**
 * A stored choice ({type, colour} with '' for "not chosen") as a finish: no type = no finish; no
 * (or an unreadable) colour = the type's own colour.
 */
export function resolveFinish(entry: { type?: string; colour?: string } | undefined | null, types: MaterialType[]): Finish | null {
  const t = types.find((x) => x.id === entry?.type);
  if (!t) return null;
  return { type: t.id, colour: isHex(entry?.colour) ? entry!.colour!.toLowerCase() : t.colour };
}

export function materialLabel(type: string): string {
  return ALL_TYPES.find((t) => t.id === type)?.label ?? type;
}

/** "Rood" for a preset colour, otherwise the hex code. */
export function colourName(hex: string): string {
  const h = hex.toLowerCase();
  return [...WALL_COLOURS, ...FRAME_COLOURS, ...ROOF_COLOURS].find((c) => c.hex === h)?.name ?? h;
}

export function finishLabel(f: Finish): string {
  return `${materialLabel(f.type).replace(/ \(.*\)$/, '')}, ${colourName(f.colour).toLowerCase()}`;
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Colour of the pattern lines on a surface of colour rgb: lighter on dark surfaces, darker on light ones. */
export function lineColour([r, g, b]: [number, number, number]): string {
  const luma = 0.299 * r + 0.587 * g + 0.114 * b;
  const mix = (c: number) => Math.round(luma < 140 ? c + (255 - c) * 0.42 : c * 0.62);
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
}

function patternOf(type: string): Pattern {
  return ALL_TYPES.find((t) => t.id === type)?.pattern ?? {};
}

const dot = (a: P3, b: P3) => a.x * b.x + a.y * b.y + a.z * b.z;

/** Above this many pattern segments on one face the fine joints are left out (keeps the drawing light). */
const MAX_SEGMENTS = 6000;

/**
 * Pattern lines of a material on a sloped or vertical face, in 3D. Rows run horizontally (along
 * the eaves on a roof), columns up the plane. Wall rows start at ground level so brick courses
 * line up from one wall to the next; roof rows start at the eaves.
 * `light`: only the main lines (for a 3D view that is redrawn while turning).
 */
export function finishSegments(face: Pick<Face, 'pts' | 'holes' | 'normal'>, type: string, light = false): [P3, P3][] {
  const pat = patternOf(type);
  const n = face.normal;
  if (Math.abs(n.z) > 0.999 || face.pts.length < 3) return [];
  // Orthonormal frame: u horizontal in the plane, s up the plane, n out of it.
  const hl = Math.hypot(n.x, n.y);
  const u: P3 = { x: -n.y / hl, y: n.x / hl, z: 0 };
  let s: P3 = { x: n.y * u.z - n.z * u.y, y: n.z * u.x - n.x * u.z, z: n.x * u.y - n.y * u.x };
  if (s.z < 0) s = { x: -s.x, y: -s.y, z: -s.z };
  const w = dot(face.pts[0], n);
  const rings = [face.pts, ...face.holes].map((r) => r.map((p) => [dot(p, u), dot(p, s)] as [number, number]));
  const all = rings.flat();
  const umin = Math.min(...all.map((p) => p[0]));
  const umax = Math.max(...all.map((p) => p[0]));
  const vmin = Math.min(...all.map((p) => p[1]));
  const vmax = Math.max(...all.map((p) => p[1]));
  const vertical = Math.abs(n.z) < 1e-6;
  const v0 = vertical ? 0 : vmin;
  const back = (a: number, b: number): P3 => ({ x: u.x * a + s.x * b + n.x * w, y: u.y * a + s.y * b + n.y * w, z: u.z * a + s.z * b + n.z * w });

  /** Pieces inside the face of the line where coordinate `axis` equals c (even-odd over all rings). */
  const inside = (axis: 0 | 1, c: number): [number, number][] => {
    const other = 1 - axis;
    const xs: number[] = [];
    for (const r of rings) {
      for (let i = 0; i < r.length; i++) {
        const a = r[i];
        const b = r[(i + 1) % r.length];
        if (a[axis] <= c === b[axis] <= c) continue;
        const t = (c - a[axis]) / (b[axis] - a[axis]);
        xs.push(a[other] + (b[other] - a[other]) * t);
      }
    }
    xs.sort((x, y) => x - y);
    const out: [number, number][] = [];
    for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > 1e-6) out.push([xs[i], xs[i + 1]]);
    return out;
  };

  const segs: [P3, P3][] = [];
  const first = (start: number, step: number, from: number) => start + Math.floor((from - start) / step + 1) * step;
  if (pat.rows) {
    for (let v = first(v0, pat.rows, vmin + 1e-6); v < vmax - 1e-6; v += pat.rows) {
      for (const [a, b] of inside(1, v)) segs.push([back(a, v), back(b, v)]);
    }
  }
  if (pat.cols) {
    for (let c = first(0, pat.cols, umin + 1e-6); c < umax - 1e-6; c += pat.cols) {
      for (const [a, b] of inside(0, c)) segs.push([back(c, a), back(c, b)]);
    }
  }
  if (pat.rows && pat.joints && !light) {
    const { every, stagger } = pat.joints;
    const bands = (vmax - vmin) / pat.rows;
    const cols = (umax - umin) / every;
    if (segs.length + bands * cols <= MAX_SEGMENTS) {
      let j = Math.floor((vmin - v0) / pat.rows);
      for (let lo = v0 + j * pat.rows; lo < vmax - 1e-6; lo += pat.rows, j++) {
        const hi = lo + pat.rows;
        const shift = stagger && j % 2 !== 0 ? every / 2 : 0;
        for (let c = first(shift, every, umin + 1e-6); c < umax - 1e-6; c += every) {
          for (const [a, b] of inside(0, c)) {
            const p = Math.max(a, lo);
            const q = Math.min(b, hi);
            if (q - p > 1e-6) segs.push([back(c, p), back(c, q)]);
          }
        }
      }
    }
  }
  return segs;
}

/**
 * Corners of a quadrilateral moved inwards: edge i (corner i to i+1) by `by[i]`.
 * Used for the frame around a window or door.
 */
export function insetQuad(q: P3[], by: number[]): P3[] {
  const unit = (a: P3, b: P3): P3 => {
    const l = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) || 1;
    return { x: (b.x - a.x) / l, y: (b.y - a.y) / l, z: (b.z - a.z) / l };
  };
  return q.map((p, i) => {
    const prev = q[(i + q.length - 1) % q.length];
    const next = q[(i + 1) % q.length];
    const toPrev = unit(p, prev);
    const toNext = unit(p, next);
    const di = by[i];
    const dp = by[(i + q.length - 1) % q.length];
    return { x: p.x + toPrev.x * di + toNext.x * dp, y: p.y + toPrev.y * di + toNext.y * dp, z: p.z + toPrev.z * di + toNext.z * dp };
  });
}

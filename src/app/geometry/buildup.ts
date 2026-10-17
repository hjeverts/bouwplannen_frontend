/**
 * Roof build-up (dakopbouw): the layers on the roof line, each a thickness square to the slope,
 * and the heights they come to at the walls, at the end of the overhang and at the ridge.
 *
 * The roof as entered is a line in the section (wall plates, ridge, knees). It is either the
 * underside of the construction (underside of the rafters, or top of the purlins and ridge beam
 * for a purlin roof) or the outside (top of the tiles). Every layer is that line moved square to
 * each slope; where two slopes meet (ridge, knee) the moved lines meet again, and at the ends the
 * rafters are cut plumb at the end of the overhang.
 */
import { Point, RoofResult } from './geometry';

export interface BuildupSpec {
  /** What the entered roof describes: 'onder' = underside of the construction, 'boven' = top of the tiles. */
  reference: 'onder' | 'boven';
  /** Thicknesses square to the slope, from the inside out (0 = layer not there). */
  rafter: number;
  deck: number;
  counter: number;
  batten: number;
  tile: number;
}

export const LAYERS: { key: keyof Omit<BuildupSpec, 'reference'>; top: string }[] = [
  { key: 'rafter', top: 'Bovenkant spar / gording' },
  { key: 'deck', top: 'Bovenkant dakbeschot' },
  { key: 'counter', top: 'Bovenkant tengel' },
  { key: 'batten', top: 'Bovenkant panlat' },
  { key: 'tile', top: 'Bovenkant pannen' },
];

export interface BuildupLine {
  /** 'Onderkant constructie', then the top of every layer that is there. */
  name: string;
  /** Offset square to the slope from the underside. */
  offset: number;
  /** From the end of the left overhang to the end of the right one. */
  pts: Point[];
}

export interface BuildupPoint {
  label: string;
  x: number;
  /** Height of every line at x, in the order of `lines`. */
  z: number[];
}

export interface BuildupResult {
  /** Total thickness square to the slope. */
  total: number;
  /** Per slope (left to right): the total thickness measured plumb. */
  plumb: { label: string; pitch: number; thickness: number }[];
  lines: BuildupLine[];
  /** Where heights are asked for: overhang ends, walls, knees, ridge. */
  points: BuildupPoint[];
  /** Along the slope on top of the battens, per tiled plane (for the batten layout). */
  battenSlopes: number[];
}

/** The roof line, left overhang end to right overhang end, in the section's coordinates. */
export function roofLine(roof: RoofResult): Point[] {
  let top: Point[];
  if (roof.type === 'mansardekap') top = roof.outline;
  else if (roof.type === 'lessenaarsdak') top = [{ x: 0, y: roof.plateLeft }, { x: roof.span, y: roof.plateRight }];
  else top = [{ x: 0, y: roof.plateLeft }, roof.ridge, { x: roof.span, y: roof.plateRight }];
  // Out past the walls along the end slopes, by the overhangs (level).
  const n = top.length;
  const slopeA = (top[1].y - top[0].y) / (top[1].x - top[0].x);
  const slopeB = (top[n - 1].y - top[n - 2].y) / (top[n - 1].x - top[n - 2].x);
  const a = { x: -roof.overhangLeft, y: top[0].y - slopeA * roof.overhangLeft };
  const b = { x: roof.span + roof.overhangRight, y: top[n - 1].y + slopeB * roof.overhangRight };
  return [a, ...top, b];
}

/**
 * The polyline moved `d` square to each segment, upwards; joints mitred, ends cut plumb at the
 * same x. Segments shorter than a millimetre are dropped (an overhang of 0).
 */
export function offsetLine(pts: Point[], d: number): Point[] {
  const line = pts.filter((p, i) => i === 0 || Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) > 1e-6);
  // Per segment: slope and the plumb shift of the moved line.
  const segs = line.slice(0, -1).map((p, i) => {
    const q = line[i + 1];
    const m = (q.y - p.y) / (q.x - p.x);
    return { p, m, dz: d * Math.hypot(1, m) };
  });
  const at = (s: (typeof segs)[number], x: number) => s.p.y + s.dz + s.m * (x - s.p.x);
  const out: Point[] = [{ x: line[0].x, y: at(segs[0], line[0].x) }];
  for (let i = 0; i + 1 < segs.length; i++) {
    const s = segs[i];
    const t = segs[i + 1];
    if (Math.abs(s.m - t.m) < 1e-12) continue; // straight on: no joint
    // s.p.y + s.dz + s.m (x − s.p.x) = t.p.y + t.dz + t.m (x − t.p.x)
    const x = (t.p.y + t.dz - t.m * t.p.x - s.p.y - s.dz + s.m * s.p.x) / (s.m - t.m);
    out.push({ x, y: at(s, x) });
  }
  const last = line[line.length - 1];
  out.push({ x: last.x, y: at(segs[segs.length - 1], last.x) });
  return out;
}

/** Height of a polyline at x (x within its range; ends held level outside it). */
export function heightOn(pts: Point[], x: number): number {
  if (x <= pts[0].x) return pts[0].y;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1];
    const q = pts[i];
    if (x <= q.x + 1e-12) return p.y + ((q.y - p.y) * (x - p.x)) / (q.x - p.x || 1);
  }
  return pts[pts.length - 1].y;
}

export function computeBuildup(roof: RoofResult, spec: BuildupSpec): BuildupResult {
  const total = LAYERS.reduce((s, l) => s + Math.max(0, spec[l.key]), 0);
  const base = roofLine(roof);
  const under = spec.reference === 'onder' ? 0 : -total;
  const lines: BuildupLine[] = [{ name: 'Onderkant constructie', offset: under, pts: offsetLine(base, under) }];
  let off = under;
  for (const l of LAYERS) {
    const t = Math.max(0, spec[l.key]);
    if (t <= 0) continue;
    off += t;
    lines.push({ name: l.top, offset: off, pts: offsetLine(base, off) });
  }

  // Slopes between the walls, for the plumb thickness.
  const inner = base.slice(1, -1);
  const names =
    roof.type === 'lessenaarsdak'
      ? ['Dakvlak']
      : roof.type === 'mansardekap'
        ? ['Onderdak links', 'Bovendak links', 'Bovendak rechts', 'Onderdak rechts']
        : ['Links', 'Rechts'];
  const plumb = inner.slice(0, -1).map((p, i) => {
    const q = inner[i + 1];
    const m = (q.y - p.y) / (q.x - p.x);
    return { label: names[i] ?? `Dakvlak ${i + 1}`, pitch: (Math.atan(Math.abs(m)) * 180) / Math.PI, thickness: total * Math.hypot(1, m) };
  });

  const zAll = (x: number) => lines.map((l) => heightOn(l.pts, x));
  const points: BuildupPoint[] = [];
  const add = (label: string, x: number) => points.push({ label, x, z: zAll(x) });
  const low = roof.plateLeft <= roof.plateRight;
  const sideL = roof.type === 'lessenaarsdak' ? (low ? 'lage kant' : 'hoge kant') : 'links';
  const sideR = roof.type === 'lessenaarsdak' ? (low ? 'hoge kant' : 'lage kant') : 'rechts';
  if (roof.overhangLeft > 1e-6) add(`Einde overstek ${sideL}`, -roof.overhangLeft);
  add(`Muur ${sideL}`, 0);
  if (roof.type === 'mansardekap' && roof.knee) {
    add('Knik links', roof.knee.x);
    add('Nok', roof.ridge.x);
    add('Knik rechts', roof.span - roof.knee.x);
  } else if (roof.type === 'zadeldak') {
    // Per line its own ridge: the moved lines meet a little off the ridge when the pitches differ.
    points.push({ label: 'Nok', x: roof.ridge.x, z: lines.map((l) => Math.max(...l.pts.map((p) => p.y))) });
  }
  add(`Muur ${sideR}`, roof.span);
  if (roof.overhangRight > 1e-6) add(`Einde overstek ${sideR}`, roof.span + roof.overhangRight);

  // On top of the battens: the line the battens are laid out along (tiled planes only).
  const battenTop = (lines.find((l) => l.name === 'Bovenkant panlat') ?? lines.filter((l) => l.name !== 'Bovenkant pannen').pop()!).pts;
  const segLen = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
  let battenSlopes: number[] = [];
  if (roof.type === 'lessenaarsdak') battenSlopes = [segLen(battenTop[0], battenTop[battenTop.length - 1])];
  else if (roof.type === 'zadeldak') {
    const top = battenTop.reduce((best, p) => (p.y > best.y ? p : best), battenTop[0]);
    battenSlopes = [segLen(battenTop[0], top), segLen(top, battenTop[battenTop.length - 1])];
  }
  return { total, plumb, lines, points, battenSlopes };
}

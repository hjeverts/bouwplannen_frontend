/**
 * The roof construction in 3D: every post, beam, rafter, counter batten and batten as a solid of
 * its own, so the timber can be looked at from all sides. Tiles, decking and walls are kept apart
 * ("ghosts"): they can be shown see-through or left out, so they never hide the construction.
 *
 * Every member is a prism: a polygon in the section plane (u across the roof, v up), extruded
 * along the roof (w). World coordinates: x = w, y = u, z = v. For an afdak u runs from the front
 * edge (u = 0) to the wall; for a roof u is the section's x (left wall = 0).
 */
import { AfdakOutcome } from '../model/compute-afdak';
import { DakResult } from '../model/compute';
import { rafterOutline } from './afdak';
import { P3 } from './building';
import { BuildupLine, heightOn, offsetLine } from './buildup';
import { Point } from './geometry';

export type MemberKind = 'footing' | 'post' | 'beam' | 'hanger' | 'rafter' | 'deck' | 'counter' | 'batten' | 'tiles' | 'wall' | 'building';

/** Cladding and covering: shown solid only when asked ("dicht"); otherwise as see-through sheets. */
export const COVER_KINDS: MemberKind[] = ['deck', 'tiles'];
export const WALL_KINDS: MemberKind[] = ['wall', 'building'];
export type GhostKind = 'tiles' | 'deck' | 'wall';

export interface Prism {
  kind: MemberKind;
  /** Section polygon: x = u, y = v. */
  poly: Point[];
  w0: number;
  w1: number;
}

export interface Ghost {
  kind: GhostKind;
  pts: P3[];
}

/** A roof plane in the section: from u0 to u1, with its outward (upward) normal. */
export interface RoofPlane {
  u0: number;
  u1: number;
  nu: number;
  nv: number;
}

export interface Frame {
  members: Prism[];
  ghosts: Ghost[];
  /** The planes of the top of the rafters: the members on them are stacked in a known order. */
  planes: RoofPlane[];
  /** What is assumed or missing (shown under the view). */
  notes: string[];
}

/** Sizes not entered anywhere: the width of a batten and of a counter batten (along the roof / across). */
export const BATTEN_WIDTH = 0.035;
export const COUNTER_WIDTH = 0.05;
/** Battens without a thickness in the build-up. */
const BATTEN_FALLBACK = 0.022;
/** Thickness of a solid wall drawn for a building whose walls are not entered. */
const WALL = 0.1;
/** Sheet steel of a joist hanger (drawn a little thick so it shows). */
const STEEL = 0.003;
/** The part of a footing shown, just under the ground. */
const FOOTING_TOP = 0.1;

const rect = (u0: number, v0: number, u1: number, v1: number): Point[] => [
  { x: u0, y: v0 },
  { x: u1, y: v0 },
  { x: u1, y: v1 },
  { x: u0, y: v1 },
];

const mm = (m: number) => `${Math.round(m * 1000)} mm`;

/** A see-through panel from a line in the section, extruded from w0 to w1 (one quad per segment). */
function sheetAlong(kind: GhostKind, pts: Point[], w0: number, w1: number): Ghost[] {
  const out: Ghost[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-6) continue;
    out.push({
      kind,
      pts: [
        { x: w0, y: a.x, z: a.y },
        { x: w1, y: a.x, z: a.y },
        { x: w1, y: b.x, z: b.y },
        { x: w0, y: b.x, z: b.y },
      ],
    });
  }
  return out;
}

/** A see-through panel in a plane of constant w (a gable or a side wall), from a section polygon. */
function panelAt(kind: GhostKind, poly: Point[], w: number): Ghost {
  return { kind, pts: poly.map((p) => ({ x: w, y: p.x, z: p.y })) };
}

/**
 * Battens and counter battens on the layers of the build-up (in section coordinates already
 * moved to u), and the tiles and decking as see-through sheets.
 */
function layersOnTop(
  dak: DakResult,
  lines: BuildupLine[],
  w0: number,
  w1: number,
  counterAt: number[],
  frame: Frame,
): void {
  const idx = (name: string) => lines.findIndex((l) => l.name === name);
  // Counter battens: on every rafter, between the layer under them and their top.
  const ci = idx('Bovenkant tengel');
  if (ci > 0) {
    const poly = [...lines[ci - 1].pts, ...[...lines[ci].pts].reverse()];
    for (const w of counterAt) frame.members.push({ kind: 'counter', poly, w0: w - COUNTER_WIDTH / 2, w1: w + COUNTER_WIDTH / 2 });
  }
  // Battens: where the tile layout puts them, measured on their top from the highest point.
  const tiles = dak.tiles;
  let tiled = false;
  if (tiles && tiles.planes.length) {
    const bi = idx('Bovenkant panlat');
    let top: Point[];
    let t: number;
    if (bi > 0) {
      top = lines[bi].pts;
      t = lines[bi].offset - lines[bi - 1].offset;
    } else {
      // No batten thickness entered: battens of a usual thickness on the top construction layer.
      const tileTop = idx('Bovenkant pannen');
      t = BATTEN_FALLBACK;
      top = offsetLine((tileTop > 0 ? lines[tileTop - 1] : lines[lines.length - 1]).pts, t);
      frame.notes.push(`Panlatdikte niet ingevuld: getekend met ${mm(t)}.`);
    }
    const tileTopIdx = idx('Bovenkant pannen');
    const tileT = tileTopIdx > 0 ? lines[tileTopIdx].offset - lines[tileTopIdx - 1].offset : 0;
    const hi = top.reduce((best, p, i) => (p.y > top[best].y ? i : best), 0);
    const ends = tiles.planes.length === 1 ? [hi === 0 ? top.length - 1 : 0] : [0, top.length - 1];
    tiles.planes.forEach((plane, k) => {
      const end = ends[k];
      if (end === undefined || end === hi) return;
      // The plane: from the highest point to its end, straight (a tiled plane has no knee).
      const T = top[hi];
      const E = top[end];
      const L = Math.hypot(E.x - T.x, E.y - T.y);
      if (L < 1e-6) return;
      const d = { x: (E.x - T.x) / L, y: (E.y - T.y) / L };
      const n = d.x > 0 ? { x: -d.y, y: d.x } : { x: d.y, y: -d.x }; // outward (up)
      const at = (s: number): Point => ({ x: T.x + d.x * s, y: T.y + d.y * s });
      const marks = [plane.ridgeGap, ...Array.from({ length: plane.gauge > 0 ? plane.spaces : 0 }, (_, i) => plane.ridgeGap + (i + 1) * plane.gauge), L - BATTEN_WIDTH / 2];
      for (const s of marks) {
        const a = at(Math.max(0, s - BATTEN_WIDTH / 2));
        const b = at(Math.min(L, s + BATTEN_WIDTH / 2));
        // Down to the layer under the battens, square to the plane.
        const drop = (p: Point): Point => ({ x: p.x - n.x * t, y: p.y - n.y * t });
        frame.members.push({ kind: 'batten', poly: [a, b, drop(b), drop(a)], w0, w1 });
      }
      // Tiles, row by row on the battens (each row a strip, so the rows show).
      if (tileT > 0) {
        const lift = (p: Point): Point => ({ x: p.x + n.x * tileT, y: p.y + n.y * tileT });
        const cuts = [0, ...marks.slice(0, -1).filter((m) => m > 0 && m < L), L];
        for (let i = 0; i + 1 < cuts.length; i++) {
          const a = at(cuts[i]);
          const b = at(cuts[i + 1]);
          frame.members.push({ kind: 'tiles', poly: [a, b, lift(b), lift(a)], w0, w1 });
        }
        tiled = true;
      }
    });
  } else if (idx('Bovenkant panlat') > 0) {
    frame.notes.push('Vul de pannen in (latafstand, laatste latafstand) om de panlatten te zien.');
  }
  const deck = idx('Bovenkant dakbeschot');
  if (deck > 0) {
    frame.ghosts.push(...sheetAlong('deck', lines[deck].pts, w0, w1));
    frame.members.push({ kind: 'deck', poly: [...lines[deck - 1].pts, ...[...lines[deck].pts].reverse()], w0, w1 });
  }
  const tilesLine = idx('Bovenkant pannen');
  // Without a tile layout: the tile layer as one sheet.
  if (!tiled && tilesLine > 0) frame.members.push({ kind: 'tiles', poly: [...lines[tilesLine - 1].pts, ...[...lines[tilesLine].pts].reverse()], w0, w1 });
  const tileTop = idx('Bovenkant pannen');
  if (tileTop > 0) frame.ghosts.push(...sheetAlong('tiles', lines[tileTop].pts, w0, w1));
  else if (tiles) frame.ghosts.push(...sheetAlong('tiles', lines[lines.length - 1].pts, w0, w1));
}

/** The planes of a polyline (rafter top), collinear segments merged. */
export function planesOf(pts: Point[]): RoofPlane[] {
  const out: RoofPlane[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    if (l < 1e-9) continue;
    // Normal pointing up.
    let nu = -(b.y - a.y) / l;
    let nv = (b.x - a.x) / l;
    if (nv < 0) {
      nu = -nu;
      nv = -nv;
    }
    const u0 = Math.min(a.x, b.x);
    const u1 = Math.max(a.x, b.x);
    const last = out[out.length - 1];
    if (last && Math.abs(last.nu - nu) < 1e-6 && Math.abs(last.nv - nv) < 1e-6) {
      last.u0 = Math.min(last.u0, u0);
      last.u1 = Math.max(last.u1, u1);
    } else out.push({ u0, u1, nu, nv });
  }
  return out;
}

/** Section points moved along u. */
const shift = (pts: Point[], du: number): Point[] => pts.map((p) => ({ x: p.x + du, y: p.y }));

/** An afdak: footings, posts, beams, rafters with their notches, and what lies on them. */
function afdakFrame(dak: DakResult, o: AfdakOutcome): Frame {
  const frame: Frame = { members: [], ghosts: [], planes: [], notes: [] };
  const { plan, rafters: r } = o;
  if (!r) return { ...frame, notes: [o.roofMessage ?? 'Vul het dak van het afdak in.'] };
  const D = plan.depth;
  const W = plan.width;
  const u = (s: number) => D - s;
  const pw = plan.postWidth;
  const pd = plan.postDepth;
  const [back, front] = r.seats;

  for (const p of plan.posts) {
    const height = p.row === 'voor' ? r.frontPost : (r.backPost ?? 0);
    if (plan.footing) {
      const f = plan.footing / 2;
      frame.members.push({ kind: 'footing', poly: rect(u(p.s) - f, -FOOTING_TOP, u(p.s) + f, 0), w0: p.x - f, w1: p.x + f });
    }
    frame.members.push({ kind: 'post', poly: rect(u(p.s + pd / 2), 0, u(p.s - pd / 2), height), w0: p.x - pw / 2, w1: p.x + pw / 2 });
  }
  const bh = o.beamHeight ?? 0;
  const rw = o.rafterWidth ?? 0;
  /** A beam along the width, with a pocket under every rafter when it has one. */
  const beam = (st: typeof front, height: number) => {
    const full = rect(u(st.s1), st.z - height, u(st.s0), st.z);
    if (st.pocket <= 1e-6) {
      frame.members.push({ kind: 'beam', poly: full, w0: 0, w1: W });
      return;
    }
    const low = rect(u(st.s1), st.z - height, u(st.s0), st.floor);
    let w = 0;
    for (const x of r.xs) {
      const a = Math.max(0, x - rw / 2);
      const b = Math.min(W, x + rw / 2);
      if (a > w + 1e-6) frame.members.push({ kind: 'beam', poly: full, w0: w, w1: a });
      frame.members.push({ kind: 'beam', poly: low, w0: a, w1: b });
      w = b;
    }
    if (W > w + 1e-6) frame.members.push({ kind: 'beam', poly: full, w0: w, w1: W });
  };
  beam(front, bh);
  const backBeam = plan.attached ? (o.backBeamHeight ?? Math.min(bh, 0.15)) : bh;
  beam(back, backBeam);

  const h = o.rafterHeight ?? 0;
  const outline = rafterOutline(r, D, h).map((p) => ({ x: u(p.x), y: p.y }));
  const topAt = (sv: number) => r.undersideAt(sv) + h / Math.cos((r.pitch * Math.PI) / 180);
  frame.planes = planesOf([
    { x: u(D), y: topAt(D) },
    { x: u(r.start), y: topAt(r.start) },
  ]);
  for (const x of r.xs) frame.members.push({ kind: 'rafter', poly: outline, w0: x - rw / 2, w1: x + rw / 2 });

  // Joist hangers: back plate on the beam face, the seat, and a flange on each side.
  const hg = back.hanger;
  if (hg) {
    const b1 = back.s1;
    const e = b1 + hg.seat;
    const zuB = r.undersideAt(b1);
    const zuE = r.undersideAt(e);
    const flange =
      hg.kind === 'vlak'
        ? rect(u(e), hg.bottom, u(b1), hg.bottom + hg.height)
        : [{ x: u(b1), y: zuB }, { x: u(e), y: zuE }, { x: u(e), y: zuE + hg.height }, { x: u(b1), y: zuB + hg.height }];
    const seat =
      hg.kind === 'vlak'
        ? rect(u(e), hg.bottom - STEEL, u(b1), hg.bottom)
        : [{ x: u(b1), y: zuB - STEEL }, { x: u(e), y: zuE - STEEL }, { x: u(e), y: zuE }, { x: u(b1), y: zuB }];
    const plate = rect(u(b1), hg.bottom - STEEL, u(b1) + STEEL, hg.bottom + hg.height);
    for (const x of r.xs) {
      const a = x - rw / 2;
      const b = x + rw / 2;
      frame.members.push(
        { kind: 'hanger', poly: plate, w0: a - STEEL, w1: b + STEEL },
        { kind: 'hanger', poly: seat, w0: a, w1: b },
        { kind: 'hanger', poly: flange, w0: a - STEEL, w1: a },
        { kind: 'hanger', poly: flange, w0: b, w1: b + STEEL },
      );
    }
  }

  // The build-up is worked out in the roof's section (x from the front seat); here u = D − s.
  if (dak.buildup) {
    const sFront = front.s1 - front.length;
    const lines = dak.buildup.lines.map((l) => ({ ...l, pts: shift(l.pts, D - sFront) }));
    layersOnTop(dak, lines, 0, W, r.xs, frame);
  }

  // Walls and the building: see-through panels.
  const zu = r.undersideAt;
  for (const wall of plan.walls) {
    if (wall.side === 'links' || wall.side === 'rechts') {
      const poly = [
        { x: u(wall.s1), y: 0 },
        { x: u(wall.s0), y: 0 },
        { x: u(wall.s0), y: zu(wall.s0) },
        { x: u(wall.s1), y: zu(wall.s1) },
      ];
      frame.ghosts.push(panelAt('wall', poly, (wall.x0 + wall.x1) / 2));
      frame.members.push({ kind: 'wall', poly, w0: wall.x0, w1: wall.x1 });
    } else {
      const s = (wall.s0 + wall.s1) / 2;
      const zTop = (wall.side === 'voor' ? front.z : back.z) - bh;
      frame.members.push({ kind: 'wall', poly: rect(u(wall.s1), 0, u(wall.s0), zTop), w0: wall.x0, w1: wall.x1 });
      frame.ghosts.push({
        kind: 'wall',
        pts: [
          { x: wall.x0, y: u(s), z: 0 },
          { x: wall.x1, y: u(s), z: 0 },
          { x: wall.x1, y: u(s), z: zTop },
          { x: wall.x0, y: u(s), z: zTop },
        ],
      });
    }
  }
  if (plan.attached) {
    const lines = dak.buildup?.lines;
    const top = (lines ? Math.max(...lines[lines.length - 1].pts.map((p) => p.y)) : r.ends.back.top) + 0.3;
    frame.members.push({ kind: 'building', poly: rect(D, 0, D + 2 * WALL, top), w0: -0.4, w1: W + 0.4 });
    frame.ghosts.push({
      kind: 'wall',
      pts: [
        { x: -0.4, y: D, z: 0 },
        { x: W + 0.4, y: D, z: 0 },
        { x: W + 0.4, y: D, z: top },
        { x: -0.4, y: D, z: top },
      ],
    });
  }
  frame.notes.push(`Panlat ${mm(BATTEN_WIDTH)} en tengel ${mm(COUNTER_WIDTH)} breed aangenomen.`);
  return frame;
}

/** A roof on walls: the rafters (both slopes as one piece per pair), counter battens, battens. */
function roofFrame(dak: DakResult): Frame {
  const frame: Frame = { members: [], ghosts: [], planes: [], notes: [] };
  const bu = dak.buildup;
  const top = bu?.lines.find((l) => l.name === 'Bovenkant spoor / gording');
  if (!bu || !top) return { ...frame, notes: ['Vul bij de dakopbouw de hoogte van de spoor in om de constructie in 3D te zien.'] };
  const L = dak.length;
  const total = dak.purlinLength;
  if (L === null || total === null) return { ...frame, notes: ['Vul de daklengte in om de constructie in 3D te zien.'] };
  const g0 = dak.gableOverhang ?? 0;
  const rw = dak.rafterWidth ?? 0.05;
  const spacing = dak.rafterSpacing ?? 0.6;
  if (dak.rafterWidth == null || dak.rafterSpacing == null) {
    frame.notes.push(`Spoorbreedte of h.o.h. niet ingevuld: getekend met ${mm(rw)} breed, ${mm(spacing)} h.o.h.`);
  }
  // Rafters between the gables, the outer ones flush with the gable walls.
  const n = Math.max(2, Math.ceil((L - rw) / spacing - 1e-9) + 1);
  const step = (L - rw) / (n - 1);
  const ws = Array.from({ length: n }, (_, i) => g0 + rw / 2 + i * step);
  const poly = [...bu.lines[0].pts, ...[...top.pts].reverse()];
  frame.planes = planesOf(top.pts);
  for (const w of ws) frame.members.push({ kind: 'rafter', poly, w0: w - rw / 2, w1: w + rw / 2 });
  layersOnTop(dak, bu.lines, 0, total, ws, frame);

  // Gables and the long walls, see-through.
  const roof = dak.roof;
  frame.ghosts.push(panelAt('wall', roof.outline, g0), panelAt('wall', roof.outline, g0 + L));
  frame.members.push({ kind: 'building', poly: roof.outline, w0: g0, w1: g0 + WALL }, { kind: 'building', poly: roof.outline, w0: g0 + L - WALL, w1: g0 + L });
  if (roof.fromFloor) {
    for (const x of [0, roof.span]) {
      const zTop = heightOn(bu.lines[0].pts, x);
      const inner = x === 0 ? WALL : roof.span - WALL;
      frame.members.push({ kind: 'building', poly: rect(Math.min(x, inner), 0, Math.max(x, inner), zTop), w0: g0 + WALL, w1: g0 + L - WALL });
      frame.ghosts.push({
        kind: 'wall',
        pts: [
          { x: g0, y: x, z: 0 },
          { x: g0 + L, y: x, z: 0 },
          { x: g0 + L, y: x, z: zTop },
          { x: g0, y: x, z: zTop },
        ],
      });
    }
  }
  frame.notes.push(`${n} sporen ${mm(step)} h.o.h.; panlat ${mm(BATTEN_WIDTH)} en tengel ${mm(COUNTER_WIDTH)} breed aangenomen.`);
  return frame;
}

/** The construction of a roof or an afdak. */
export function buildFrame(dak: DakResult): Frame {
  return dak.afdak ? afdakFrame(dak, dak.afdak) : roofFrame(dak);
}

// ---------------------------------------------------------------------------
// Pieces for drawing: every prism cut into small blocks, so that drawing the blocks far to near
// (painter's algorithm) gives a correct picture where members cross or rest on each other.

export interface PieceFace {
  pts: P3[];
  normal: P3;
  /** Real edges of the face (cuts between blocks of one member are left out). */
  edges: [P3, P3][];
}

export interface Piece {
  kind: MemberKind;
  centre: P3;
  faces: PieceFace[];
}

/** Largest block size, m. */
const BLOCK = 0.45;

function area(poly: Point[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/** Sutherland–Hodgman: the polygon inside one axis-parallel half plane. */
function clipHalf(poly: Point[], axis: 'x' | 'y', value: number, keepAbove: boolean): Point[] {
  const out: Point[] = [];
  const inside = (p: Point) => (keepAbove ? p[axis] >= value - 1e-12 : p[axis] <= value + 1e-12);
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ia = inside(a);
    const ib = inside(b);
    if (ia) out.push(a);
    if (ia !== ib) {
      const t = (value - a[axis]) / (b[axis] - a[axis]);
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      p[axis] = value;
      out.push(p);
    }
  }
  return out;
}

/** Cut a prism into blocks and give each block its outward faces. */
export function piecesOf(prism: Prism, block = BLOCK): Piece[] {
  let poly = prism.poly;
  if (poly.length < 3) return [];
  if (area(poly) < 0) poly = [...poly].reverse();
  const us = poly.map((p) => p.x);
  const vs = poly.map((p) => p.y);
  const grid = (lo: number, hi: number) => {
    const n = Math.max(1, Math.ceil((hi - lo) / block - 1e-9));
    return Array.from({ length: n + 1 }, (_, i) => lo + ((hi - lo) * i) / n);
  };
  const gu = grid(Math.min(...us), Math.max(...us));
  const gv = grid(Math.min(...vs), Math.max(...vs));
  const gw = grid(Math.min(prism.w0, prism.w1), Math.max(prism.w0, prism.w1));
  const W0 = gw[0];
  const W1 = gw[gw.length - 1];
  const pieces: Piece[] = [];
  const world = (p: Point, w: number): P3 => ({ x: w, y: p.x, z: p.y });

  for (let i = 0; i + 1 < gu.length; i++) {
    const strip = clipHalf(clipHalf(poly, 'x', gu[i], true), 'x', gu[i + 1], false);
    if (strip.length < 3) continue;
    for (let j = 0; j + 1 < gv.length; j++) {
      const cell = clipHalf(clipHalf(strip, 'y', gv[j], true), 'y', gv[j + 1], false);
      if (cell.length < 3 || Math.abs(area(cell)) < 1e-10) continue;
      // Cut lines inside the member (not its outline): edges on them are not real.
      const cuts: { axis: 'x' | 'y'; value: number }[] = [];
      if (i > 0) cuts.push({ axis: 'x', value: gu[i] });
      if (i + 2 < gu.length) cuts.push({ axis: 'x', value: gu[i + 1] });
      if (j > 0) cuts.push({ axis: 'y', value: gv[j] });
      if (j + 2 < gv.length) cuts.push({ axis: 'y', value: gv[j + 1] });
      const onCut = (p: Point) => cuts.filter((c) => Math.abs(p[c.axis] - c.value) < 1e-9);
      const edgeOnCut = (a: Point, b: Point) => onCut(a).some((c) => onCut(b).includes(c));
      const cu = cell.reduce((s, p) => s + p.x, 0) / cell.length;
      const cv = cell.reduce((s, p) => s + p.y, 0) / cell.length;

      for (let k = 0; k + 1 < gw.length; k++) {
        const wa = gw[k];
        const wb = gw[k + 1];
        const faces: PieceFace[] = [];
        const capEdges = (w: number): [P3, P3][] =>
          cell.map((a, m) => [a, cell[(m + 1) % cell.length]] as [Point, Point]).filter(([a, b]) => !edgeOnCut(a, b)).map(([a, b]) => [world(a, w), world(b, w)]);
        if (wa === W0) faces.push({ pts: [...cell].reverse().map((p) => world(p, wa)), normal: { x: -1, y: 0, z: 0 }, edges: capEdges(wa) });
        if (wb === W1) faces.push({ pts: cell.map((p) => world(p, wb)), normal: { x: 1, y: 0, z: 0 }, edges: capEdges(wb) });
        for (let m = 0; m < cell.length; m++) {
          const a = cell[m];
          const b = cell[(m + 1) % cell.length];
          const l = Math.hypot(b.x - a.x, b.y - a.y);
          if (l < 1e-9 || edgeOnCut(a, b)) continue;
          const normal = { x: 0, y: (b.y - a.y) / l, z: -(b.x - a.x) / l };
          const edges: [P3, P3][] = [];
          // Along the member: a real corner of the section (not where a cut crosses a straight edge).
          if (!onCut(a).length) edges.push([world(a, wa), world(a, wb)]);
          if (!onCut(b).length) edges.push([world(b, wa), world(b, wb)]);
          if (wa === W0) edges.push([world(a, wa), world(b, wa)]);
          if (wb === W1) edges.push([world(a, wb), world(b, wb)]);
          faces.push({ pts: [world(a, wa), world(b, wa), world(b, wb), world(a, wb)], normal, edges });
        }
        pieces.push({ kind: prism.kind, centre: { x: (wa + wb) / 2, y: cu, z: cv }, faces });
      }
    }
  }
  return pieces;
}

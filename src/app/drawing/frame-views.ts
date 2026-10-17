/**
 * The roof construction in 3D as a drawing: blocks of timber drawn far to near, each face shaded
 * by the light, with the real edges of the members as lines. Tiles, decking and walls are drawn
 * see-through on top (or left out), so they never hide the timber.
 */
import { Camera, P3, projector, viewDirection } from '../geometry/building';
import { Frame, GhostKind, MemberKind, Piece, piecesOf } from '../geometry/frame3d';
import { Point } from '../geometry/geometry';
import { Prim, View } from './vector';

export const MEMBER_COLOURS: Record<MemberKind, [number, number, number]> = {
  footing: [168, 168, 160],
  post: [176, 138, 92],
  beam: [196, 156, 104],
  rafter: [226, 196, 140],
  counter: [150, 178, 120],
  batten: [214, 120, 84],
};

export const MEMBER_NAMES: Record<MemberKind, string> = {
  footing: 'Poer',
  post: 'Staander',
  beam: 'Ligger',
  rafter: 'Spoor',
  counter: 'Tengel',
  batten: 'Panlat',
};

const GHOST_COLOURS: Record<GhostKind, string> = {
  tiles: 'rgb(170,82,60)',
  deck: 'rgb(200,170,120)',
  wall: 'rgb(140,146,150)',
};

const LIGHT = (() => {
  const v = { x: -0.45, y: -0.75, z: 0.65 };
  const l = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / l, y: v.y / l, z: v.z / l };
})();

const dot = (a: P3, b: P3) => a.x * b.x + a.y * b.y + a.z * b.z;

function shade(rgb: [number, number, number], normal: P3): string {
  const k = 0.62 + 0.38 * Math.max(0, dot(normal, LIGHT));
  return `rgb(${rgb.map((c) => Math.round(c * k)).join(',')})`;
}

export interface FrameViewOptions {
  /** Tiles and decking: see-through, or left out. */
  cover: 'doorzichtig' | 'uit';
  walls: 'doorzichtig' | 'uit';
  /** Battens and counter battens. */
  battens: boolean;
  title?: string;
}

/** Blocks of every member; worked out once, then only projected when the view turns. */
export function framePieces(frame: Frame): Piece[] {
  return frame.members.flatMap(piecesOf);
}

/** Order of the layers on a roof plane, from the inside out. */
const RANK: Partial<Record<MemberKind, number>> = { rafter: 0, counter: 1, batten: 2 };

/**
 * Far to near. Sorting blocks by their centre alone goes wrong where thin members lie on each
 * other, so the layers on a roof plane are drawn in their stacking order: seen from above the
 * plane rafters, then counter battens, then battens (from below the other way round), and the
 * posts and beams under the roof before it (from below: after it). Within a layer, far to near.
 */
export function drawOrder(frame: Frame, pieces: Piece[], cam: Camera): Piece[] {
  const view = viewDirection(cam);
  const proj = projector(cam);
  const depth = new Map(pieces.map((p) => [p, proj(p.centre).depth]));
  const byDepth = (a: Piece, b: Piece) => depth.get(b)! - depth.get(a)!;
  const planes = frame.planes;
  if (!planes.length) return [...pieces].sort(byDepth);
  const planeOf = (p: Piece) => {
    const u = p.centre.y;
    let best = 0;
    let dist = Infinity;
    planes.forEach((pl, i) => {
      const d = u < pl.u0 ? pl.u0 - u : u > pl.u1 ? u - pl.u1 : 0;
      if (d < dist) {
        dist = d;
        best = i;
      }
    });
    return best;
  };
  const above = planes.map((pl) => pl.nu * view.y + pl.nv * view.z > 0);
  const supports = pieces.filter((p) => RANK[p.kind] === undefined).sort(byDepth);
  const groups = planes.map(() => [] as Piece[]);
  for (const p of pieces) if (RANK[p.kind] !== undefined) groups[planeOf(p)].push(p);
  groups.forEach((g, i) => g.sort((a, b) => (above[i] ? 1 : -1) * (RANK[a.kind]! - RANK[b.kind]!) || byDepth(a, b)));
  const mean = (g: Piece[]) => (g.length ? g.reduce((s, p) => s + depth.get(p)!, 0) / g.length : 0);
  const roof = groups
    .map((g, i) => ({ g, d: mean(g), i }))
    .sort((a, b) => b.d - a.d)
    .flatMap((x) => x.g);
  // The supports stand under the first plane (an afdak has one).
  return above[0] ? [...supports, ...roof] : [...roof, ...supports];
}

export function frameView(frame: Frame, pieces: Piece[], cam: Camera, opts: FrameViewOptions): View {
  const view = viewDirection(cam);
  const proj = projector(cam);
  const to2 = (p: P3): Point => {
    const q = proj(p);
    return { x: q.x, y: q.y };
  };
  const prims: Prim[] = [];

  // See-through sheets: those behind the timber first, those in front of it last.
  const ghosts = frame.ghosts.filter((g) => (g.kind === 'wall' ? opts.walls : opts.cover) === 'doorzichtig');
  const depthOf = (pts: P3[]) => pts.reduce((s, p) => s + proj(p).depth, 0) / pts.length;
  const shown = pieces.filter((p) => opts.battens || (p.kind !== 'batten' && p.kind !== 'counter'));
  const mid = shown.length ? shown.reduce((s, p) => s + proj(p.centre).depth, 0) / shown.length : 0;
  const ghostPrim = (g: (typeof ghosts)[number]): Prim => ({ t: 'poly', rings: [g.pts.map(to2)], cls: g.kind === 'deck' ? 'ghost ghost-faint' : 'ghost', fill: GHOST_COLOURS[g.kind] });
  const ordered = ghosts.map((g) => ({ g, d: depthOf(g.pts) })).sort((a, b) => b.d - a.d);
  for (const { g } of ordered.filter((o) => o.d >= mid)) prims.push(ghostPrim(g));

  for (const p of drawOrder(frame, shown, cam)) {
    const edges: [Point, Point][] = [];
    for (const f of p.faces) {
      if (dot(f.normal, view) <= 1e-6) continue;
      const fill = shade(MEMBER_COLOURS[p.kind], f.normal);
      prims.push({ t: 'poly', rings: [f.pts.map(to2)], cls: 'solid', fill, stroke: fill });
      for (const [a, b] of f.edges) edges.push([to2(a), to2(b)]);
    }
    if (edges.length) prims.push({ t: 'segs', segs: edges, cls: 'edge' });
  }

  for (const { g } of ordered.filter((o) => o.d < mid)) prims.push(ghostPrim(g));
  return { prims, title: opts.title ?? 'Constructie in 3D', scalable: false };
}

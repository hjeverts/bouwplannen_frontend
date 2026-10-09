/**
 * Floors stacked into a building, and a 3D model of it as flat faces: facades with their windows
 * and doors, roof planes, flat roofs, and an interior "cut-away" of one floor.
 * Plus an orthographic projection with hidden-surface handling (back-face culling and painter's order).
 */
import { FloorPlan, PlanOpening, signedArea } from './floorplan';
import { Point } from './geometry';

export interface LevelInput {
  id: string;
  name: string;
  plan: FloorPlan;
  /** Id of the floor this one stands on; null for the ground floor. */
  below: string | null;
  /** From the ceiling of the floor below to the floor of this one. */
  floorThickness: number;
  /** Shift relative to the floor below (outside of the walls, front-left corner). */
  dx: number;
  dy: number;
}

export interface Level {
  id: string;
  name: string;
  plan: FloorPlan;
  /** Height of this floor's floor above the ground floor. */
  base: number;
  /** Highest ceiling or wall plate of its rooms, from its own floor. */
  storey: number;
  offset: Point;
  /** Number in the stack, 0 = ground floor. */
  number: number;
  /** Floor thickness of the level directly above, when there is one. */
  above: LevelInput | null;
}

export interface P3 {
  x: number;
  y: number;
  z: number;
}

export type FaceKind = 'facade' | 'roof' | 'flat' | 'floor' | 'inner' | 'cap';

export interface Decal {
  pts: P3[];
  kind: 'glass' | 'door';
  name: string;
}

export interface Face {
  kind: FaceKind;
  pts: P3[];
  holes: P3[][];
  /** Visible side. */
  normal: P3;
  decals: Decal[];
  /** Drawing order group: level first, then layer. */
  level: number;
  layer: number;
}

/** Floors connected to `focusId` (below and above), with their heights. Floors that cannot be stacked are left out. */
export function stackLevels(inputs: LevelInput[], focusId: string): Level[] {
  const byId = new Map(inputs.map((l) => [l.id, l]));
  // Walk down to the ground floor (guarding against loops).
  let root = byId.get(focusId);
  const seen = new Set<string>();
  while (root && root.below && byId.has(root.below) && !seen.has(root.id)) {
    seen.add(root.id);
    root = byId.get(root.below)!;
  }
  if (!root) return [];
  const out: Level[] = [];
  const visit = (l: LevelInput, base: number, offset: Point, number: number) => {
    if (out.some((x) => x.id === l.id)) return;
    const storey = Math.max(0, ...l.plan.rooms.flatMap((r) => r.heights));
    const children = inputs.filter((c) => c.below === l.id && c.id !== l.id);
    out.push({ id: l.id, name: l.name, plan: l.plan, base, storey, offset, number, above: children[0] ?? null });
    for (const c of children) visit(c, base + storey + Math.max(0, c.floorThickness), { x: offset.x + c.dx, y: offset.y + c.dy }, number + 1);
  };
  visit(root, 0, { x: 0, y: 0 }, 0);
  return out.sort((a, b) => a.base - b.base || a.number - b.number);
}

const p3 = (p: Point, z: number, o: Point): P3 => ({ x: p.x + o.x, y: p.y + o.y, z });

function ringCcw(ring: Point[], outer: boolean): Point[] {
  const ccw = signedArea(ring) > 0;
  return ccw === outer ? ring : [...ring].reverse();
}

/** Insert points where the roof underside bends, so facade tops follow the roof. */
function splitEdge(p: Point, q: Point, cuts: number[], axis: 'x' | 'y'): Point[] {
  const a = axis === 'x' ? p.y : p.x; // across coordinate
  const b = axis === 'x' ? q.y : q.x;
  const out: Point[] = [p];
  const inner = cuts.filter((c) => (c - a) * (c - b) < -1e-9).sort((u, v) => (a < b ? u - v : v - u));
  for (const c of inner) {
    const t = (c - a) / (b - a);
    out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
  }
  return out;
}

/** Outside face of an exterior opening, as a decal. */
function openingDecal(o: PlanOpening, base: number, offset: Point, outerWall: number, cutAt = Infinity): Decal | null {
  const top = Math.min(o.sill + o.height, cutAt);
  if (top <= o.sill + 1e-6) return null;
  const out = { x: -o.inward.x * outerWall, y: -o.inward.y * outerWall };
  const a = { x: o.a.x + out.x, y: o.a.y + out.y };
  const b = { x: o.b.x + out.x, y: o.b.y + out.y };
  return {
    pts: [p3(a, base + o.sill, offset), p3(b, base + o.sill, offset), p3(b, base + top, offset), p3(a, base + top, offset)],
    kind: o.door ? 'door' : 'glass',
    name: o.name,
  };
}

/** Does point p lie on segment a–b (within 2 cm)? */
function onSegment(p: P3, a: P3, b: P3): boolean {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby || 1;
  const t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2;
  if (t < -0.01 || t > 1.01) return false;
  return Math.hypot(a.x + abx * t - p.x, a.y + aby * t - p.y) < 0.02;
}

/** The building from outside: facades with windows and doors, flat roofs and the roof planes. */
export function exteriorFaces(levels: Level[]): Face[] {
  const faces: Face[] = [];
  levels.forEach((lv, li) => {
    const { plan, offset } = lv;
    const roof = plan.roof;
    const axis = roof?.ridge ?? 'x';
    const cuts = roof ? roof.profile.map((p) => p.c) : [];
    const flatTop = lv.base + lv.storey + (lv.above ? Math.max(0, lv.above.floorThickness) : 0);
    const topAt = (p: Point) => (roof ? lv.base + roof.heightAt(axis === 'x' ? p.y : p.x) : flatTop);
    const facades: Face[] = [];
    for (const poly of plan.footprint) {
      poly.forEach((ring0, ri) => {
        const ring = ringCcw(ring0, ri === 0);
        for (let i = 0; i < ring.length; i++) {
          const p = ring[i];
          const q = ring[(i + 1) % ring.length];
          const len = Math.hypot(q.x - p.x, q.y - p.y);
          if (len < 1e-6) continue;
          // Outward normal: right of the walking direction for a counter-clockwise outer ring.
          const normal = { x: (q.y - p.y) / len, y: -(q.x - p.x) / len, z: 0 };
          const tops = [...splitEdge(p, q, cuts, axis), q];
          const pts = [p3(p, lv.base, offset), p3(q, lv.base, offset), ...tops.reverse().map((t) => p3(t, topAt(t), offset))];
          facades.push({ kind: 'facade', pts, holes: [], normal, decals: [], level: li, layer: 1 });
        }
      });
    }
    for (const o of plan.openings.filter((x) => x.exterior)) {
      const d = openingDecal(o, lv.base, offset, plan.outerWall);
      if (!d) continue;
      const host = facades.find(
        (f) => Math.abs(f.normal.x + o.inward.x) < 0.02 && Math.abs(f.normal.y + o.inward.y) < 0.02 && onSegment(d.pts[0], f.pts[0], f.pts[1]) && onSegment(d.pts[1], f.pts[0], f.pts[1]),
      );
      if (host) host.decals.push(d);
    }
    faces.push(...facades);
    if (!roof) {
      for (const poly of plan.footprint) {
        faces.push({
          kind: 'flat',
          pts: poly[0].map((p) => p3(p, flatTop, offset)),
          holes: poly.slice(1).map((r) => r.map((p) => p3(p, flatTop, offset))),
          normal: { x: 0, y: 0, z: 1 },
          decals: [],
          level: li,
          layer: 0,
        });
      }
    } else {
      const e = roof.eaves;
      for (let i = 0; i + 1 < e.length; i++) {
        const at = (c: number, v: number, z: number): P3 =>
          axis === 'x' ? { x: v + offset.x, y: c + offset.y, z: z + lv.base } : { x: c + offset.x, y: v + offset.y, z: z + lv.base };
        const pts = [at(e[i].c, roof.from, e[i].z), at(e[i + 1].c, roof.from, e[i + 1].z), at(e[i + 1].c, roof.to, e[i + 1].z), at(e[i].c, roof.to, e[i].z)];
        const normal = faceNormal(pts);
        const up = normal.z < 0 ? { x: -normal.x, y: -normal.y, z: -normal.z } : normal;
        faces.push({ kind: 'roof', pts, holes: [], normal: up, decals: [], level: li, layer: 2 });
      }
    }
  });
  return faces;
}

/** One floor without its ceiling, walls cut at `cut` metres: floors, inside walls, outside walls and the cut wall tops. */
export function cutawayFaces(level: Level, cut: number): Face[] {
  const { plan } = level;
  const o = { x: 0, y: 0 };
  const faces: Face[] = [];
  for (const r of plan.rooms) {
    const holes = plan.voids.filter((v) => v.room === r.index).map((v) => v.points.map((p) => p3(p, 0, o)));
    faces.push({ kind: 'floor', pts: r.points.map((p) => p3(p, 0, o)), holes, normal: { x: 0, y: 0, z: 1 }, decals: [], level: 0, layer: 0 });
    for (const w of r.walls) {
      const top = (t: number) => Math.min(cut, w.heightFrom + ((w.heightTo - w.heightFrom) * t) / (w.length || 1));
      const at = (t: number, z: number) => p3({ x: w.from.x + w.dir.x * t, y: w.from.y + w.dir.y * t }, z, o);
      const holes: P3[][] = [];
      for (const op of w.openings) {
        const hi = Math.min(op.sill + op.height, cut);
        if (hi <= op.sill + 1e-6) continue;
        const a = Math.max(0, op.offset);
        const b = Math.min(w.length, op.offset + op.width);
        if (b <= a) continue;
        holes.push([at(a, op.sill), at(b, op.sill), at(b, hi), at(a, hi)]);
      }
      faces.push({
        kind: 'inner',
        pts: [at(0, 0), at(w.length, 0), at(w.length, top(w.length)), at(0, top(0))],
        holes,
        normal: { x: w.inward.x, y: w.inward.y, z: 0 },
        decals: [],
        level: 0,
        layer: 1,
      });
    }
  }
  for (const poly of plan.footprint) {
    poly.forEach((ring0, ri) => {
      const ring = ringCcw(ring0, ri === 0);
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i];
        const q = ring[(i + 1) % ring.length];
        const len = Math.hypot(q.x - p.x, q.y - p.y);
        if (len < 1e-6) continue;
        const normal = { x: (q.y - p.y) / len, y: -(q.x - p.x) / len, z: 0 };
        faces.push({
          kind: 'facade',
          pts: [p3(p, 0, o), p3(q, 0, o), p3(q, cut, o), p3(p, cut, o)],
          holes: [],
          normal,
          decals: [],
          level: 0,
          layer: 1,
        });
      }
    });
  }
  // Exterior openings as holes in the outside walls.
  for (const op of plan.openings.filter((x) => x.exterior)) {
    const d = openingDecal(op, 0, o, plan.outerWall, cut);
    if (!d) continue;
    const host = faces.find(
      (f) => f.kind === 'facade' && Math.abs(f.normal.x + op.inward.x) < 0.02 && Math.abs(f.normal.y + op.inward.y) < 0.02 && onSegment(d.pts[0], f.pts[0], f.pts[1]),
    );
    host?.holes.push(d.pts);
  }
  faces.push({
    kind: 'cap',
    pts: plan.wallRings[0]?.map((p) => p3(p, cut, o)) ?? [],
    holes: plan.wallRings.slice(1).map((r) => r.map((p) => p3(p, cut, o))),
    normal: { x: 0, y: 0, z: 1 },
    decals: [],
    level: 0,
    layer: 2,
  });
  return faces.filter((f) => f.pts.length >= 3);
}

export function faceNormal(pts: P3[]): P3 {
  // Newell's method.
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    x += (a.y - b.y) * (a.z + b.z);
    y += (a.z - b.z) * (a.x + b.x);
    z += (a.x - b.x) * (a.y + b.y);
  }
  const l = Math.hypot(x, y, z) || 1;
  return { x: x / l, y: y / l, z: z / l };
}

export interface Camera {
  /** Rotation around the vertical axis, degrees. 0 = looking at the front (from small y). */
  azimuth: number;
  /** Angle above the horizon, degrees. 0 = a true elevation. */
  elevation: number;
}

export interface Projected {
  kind: FaceKind | Decal['kind'];
  /** Screen coordinates in metres (x right, y up). */
  rings: Point[][];
  /** 0..1, how much the face is turned towards the light. */
  light: number;
  name?: string;
  /** For decals: the face it sits on is turned squarely to the viewer. */
  frontal?: boolean;
  /** Index of the floor in the stack. */
  level: number;
}

const DEG = Math.PI / 180;

export function viewDirection(cam: Camera): P3 {
  const az = cam.azimuth * DEG;
  const el = cam.elevation * DEG;
  // Direction from the scene towards the camera.
  return { x: -Math.sin(az) * Math.cos(el), y: -Math.cos(az) * Math.cos(el), z: Math.sin(el) };
}

export function projector(cam: Camera) {
  const az = cam.azimuth * DEG;
  const el = cam.elevation * DEG;
  const cos = Math.cos(az);
  const sin = Math.sin(az);
  return (p: P3) => {
    const x1 = p.x * cos - p.y * sin;
    const y1 = p.x * sin + p.y * cos;
    return { x: x1, y: p.z * Math.cos(el) + y1 * Math.sin(el), depth: y1 * Math.cos(el) - p.z * Math.sin(el) };
  };
}

const LIGHT = (() => {
  const v = { x: -0.45, y: -0.75, z: 0.65 };
  const l = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / l, y: v.y / l, z: v.z / l };
})();

/** Visible faces in drawing order, projected to the screen. */
export function project(faces: Face[], cam: Camera): Projected[] {
  const view = viewDirection(cam);
  const proj = projector(cam);
  const visible = faces.filter((f) => f.normal.x * view.x + f.normal.y * view.y + f.normal.z * view.z > 1e-6);
  const depth = (f: Face) => f.pts.reduce((s, p) => s + proj(p).depth, 0) / f.pts.length;
  const sorted = visible
    .map((f) => ({ f, d: depth(f) }))
    .sort((a, b) => a.f.level - b.f.level || a.f.layer - b.f.layer || b.d - a.d);
  const out: Projected[] = [];
  for (const { f } of sorted) {
    const light = Math.max(0, f.normal.x * LIGHT.x + f.normal.y * LIGHT.y + f.normal.z * LIGHT.z);
    const facing = f.normal.x * view.x + f.normal.y * view.y + f.normal.z * view.z;
    out.push({ kind: f.kind, rings: [f.pts, ...f.holes].map((r) => r.map((p) => ({ x: proj(p).x, y: proj(p).y }))), light, level: f.level });
    for (const d of f.decals) {
      out.push({ kind: d.kind, rings: [d.pts.map((p) => ({ x: proj(p).x, y: proj(p).y }))], light, name: d.name, frontal: facing > 0.999, level: f.level });
    }
  }
  return out;
}

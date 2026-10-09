/**
 * Floors stacked into a building, and a 3D model of it as flat faces: facades with their windows
 * and doors, roof planes, flat roofs, and an interior "cut-away" of one floor.
 * Plus an orthographic projection with hidden-surface handling (back-face culling and painter's order).
 */
import { MultiPolygon, Polygon as ClipPolygon, Ring } from 'polygon-clipping';
import { difference, intersection } from './clip';
import { FloorPlan, grow, PlanOpening, pointInPolygon, signedArea } from './floorplan';
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

export type FaceKind = 'facade' | 'roof' | 'flat' | 'floor' | 'inner' | 'cap' | 'dormer';

export interface Decal {
  pts: P3[];
  kind: 'glass' | 'door' | 'roldeur';
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
  /** Within the layer, lower first (flat roofs at different heights); otherwise by depth. */
  order?: number;
  /** Drawn right after this face (a dormer on its roof plane). */
  host?: Face;
  /** Facades: the bottom edge, for placing windows and doors. */
  edge?: [P3, P3];
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

const toRing = (pts: Point[]): Ring => {
  const ring: Ring = pts.map((p) => [p.x, p.y] as [number, number]);
  ring.push([pts[0].x, pts[0].y]);
  return ring;
};

function ringCcw(ring: Point[], outer: boolean): Point[] {
  const ccw = signedArea(ring) > 0;
  return ccw === outer ? ring : [...ring].reverse();
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
    kind: o.style === 'roldeur' ? 'roldeur' : o.door ? 'door' : 'glass',
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

/** Parameters (0..1) along p→q where segment a→b crosses or touches it. */
function crossings(p: Point, q: Point, a: Point, b: Point): number[] {
  const r = { x: q.x - p.x, y: q.y - p.y };
  const s = { x: b.x - a.x, y: b.y - a.y };
  const den = r.x * s.y - r.y * s.x;
  const len = Math.hypot(r.x, r.y) || 1;
  const out: number[] = [];
  // Ends of a–b lying on p–q (within 2 mm).
  for (const e of [a, b]) {
    const t = ((e.x - p.x) * r.x + (e.y - p.y) * r.y) / (len * len);
    const d = Math.abs((e.x - p.x) * r.y - (e.y - p.y) * r.x) / len;
    if (d < 0.002 && t > 1e-6 && t < 1 - 1e-6) out.push(t);
  }
  if (Math.abs(den) < 1e-12) return out;
  const t = ((a.x - p.x) * s.y - (a.y - p.y) * s.x) / den;
  const u = ((a.x - p.x) * r.y - (a.y - p.y) * r.x) / den;
  if (t > 1e-6 && t < 1 - 1e-6 && u >= -1e-9 && u <= 1 + 1e-9) out.push(t);
  return out;
}

function insideFootprint(p: Point, footprint: Point[][][]): boolean {
  return footprint.some((poly) => pointInPolygon(p, poly[0]) && !poly.slice(1).some((h) => pointInPolygon(p, h)));
}

function distanceToPolygon(p: Point, poly: Point[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / (abx * abx + aby * aby || 1)));
    best = Math.min(best, Math.hypot(a.x + abx * t - p.x, a.y + aby * t - p.y));
  }
  return best;
}

/**
 * Heights of the tops of the walls of one floor: under a roof the roof's underside, under a floor
 * above the underside of that floor, otherwise a flat roof on the room's own height.
 */
function topsOf(levels: Level[], lv: Level) {
  const plan = lv.plan;
  const grown = plan.rooms.map((r) => grow(r.points, plan.outerWall));
  const above = levels.filter((l) => l.number === lv.number + 1 && l.base > lv.base);
  /** Upper floors' outlines in this floor's coordinates. */
  const aboveRings = above.map((a) => ({
    level: a,
    footprint: a.plan.footprint.map((poly) => poly.map((ring) => ring.map((p) => ({ x: p.x + a.offset.x - lv.offset.x, y: p.y + a.offset.y - lv.offset.y })))),
  }));
  const coveredBy = (p: Point) => aboveRings.find((a) => insideFootprint(p, a.footprint))?.level ?? null;
  const ownerOf = (p: Point): number => {
    const i = grown.findIndex((g) => pointInPolygon(p, g));
    if (i >= 0) return i;
    let best = 0;
    let dist = Infinity;
    grown.forEach((g, j) => {
      const d = distanceToPolygon(p, g);
      if (d < dist) [best, dist] = [j, d];
    });
    return best;
  };
  const maxHeight = plan.rooms.map((r) => Math.max(...r.heights));
  /** Top of room `ri` at p, given whether that spot is under a floor above. */
  const top = (ri: number, p: Point, upper: Level | null): number => {
    const rr = plan.roomRoof[ri];
    if (rr !== null && rr !== undefined) {
      const roof = plan.roofs[rr];
      return lv.base + roof.heightAt(roof.ridge === 'x' ? p.y : p.x);
    }
    if (upper) return upper.base;
    return lv.base + maxHeight[ri] + plan.flatThickness;
  };
  /** Where the tops can bend or jump along p→q. */
  const splits = (p: Point, q: Point): number[] => {
    const ts = new Set<number>([0, 1]);
    const add = (t: number) => {
      if (t > 1e-6 && t < 1 - 1e-6) ts.add(Math.round(t * 1e9) / 1e9);
    };
    for (const g of grown) for (let i = 0; i < g.length; i++) crossings(p, q, g[i], g[(i + 1) % g.length]).forEach(add);
    for (const a of aboveRings) for (const ring of a.footprint.flat()) for (let i = 0; i < ring.length; i++) crossings(p, q, ring[i], ring[(i + 1) % ring.length]).forEach(add);
    for (const roof of plan.roofs) {
      const a = roof.ridge === 'x' ? p.y : p.x;
      const b = roof.ridge === 'x' ? q.y : q.x;
      if (Math.abs(b - a) < 1e-9) continue;
      for (const pp of roof.profile) add((pp.c - a) / (b - a));
    }
    return [...ts].sort((x, y) => x - y);
  };
  return { grown, coveredBy, ownerOf, top, splits };
}

/** Wall face along p→q from `bottom` up to the tops, which may bend and jump. */
function wallPolygon(p: Point, q: Point, ts: number[], bottomAt: (pt: Point, seg: number) => number, topAt: (pt: Point, seg: number) => number, offset: Point): P3[][] {
  const lerp = (t: number): Point => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
  // One polygon per run of segments where the wall is higher than its bottom.
  const polys: P3[][] = [];
  let bottom: P3[] = [];
  let tops: P3[] = [];
  const flush = () => {
    if (bottom.length >= 2) polys.push(dedupe([...bottom, ...tops.reverse()]));
    bottom = [];
    tops = [];
  };
  for (let k = 0; k + 1 < ts.length; k++) {
    const a = lerp(ts[k]);
    const b = lerp(ts[k + 1]);
    const ba = bottomAt(a, k);
    const bb = bottomAt(b, k);
    const ta = topAt(a, k);
    const tb = topAt(b, k);
    if (ta <= ba + 1e-4 && tb <= bb + 1e-4) {
      flush();
      continue;
    }
    if (ta <= ba + 1e-4 || tb <= bb + 1e-4) {
      // The wall dips under its bottom half way: cut at the crossing.
      const da = ta - ba;
      const db = tb - bb;
      const t = da / (da - db);
      const m = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      const zm = ba + (bb - ba) * t;
      if (da > 0) {
        if (!bottom.length) bottom.push(p3(a, ba, offset));
        bottom.push(p3(m, zm, offset));
        tops.push(p3(a, ta, offset), p3(m, zm, offset));
        flush();
      } else {
        flush();
        bottom.push(p3(m, zm, offset), p3(b, bb, offset));
        tops.push(p3(m, zm, offset), p3(b, tb, offset));
      }
      continue;
    }
    if (!bottom.length) bottom.push(p3(a, ba, offset));
    bottom.push(p3(b, bb, offset));
    tops.push(p3(a, ta, offset), p3(b, tb, offset));
  }
  flush();
  return polys.filter((poly) => poly.length >= 3);
}

/** Drop repeated points and points on a straight line between their neighbours. */
function dedupe(pts: P3[]): P3[] {
  let out = pts.filter((p, i) => {
    const q = pts[(i - 1 + pts.length) % pts.length];
    return Math.abs(p.x - q.x) > 1e-7 || Math.abs(p.y - q.y) > 1e-7 || Math.abs(p.z - q.z) > 1e-7;
  });
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      const a = out[(i - 1 + out.length) % out.length];
      const b = out[i];
      const c = out[(i + 1) % out.length];
      const u = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
      const v = { x: c.x - b.x, y: c.y - b.y, z: c.z - b.z };
      const cr = Math.hypot(u.y * v.z - u.z * v.y, u.z * v.x - u.x * v.z, u.x * v.y - u.y * v.x);
      const len = Math.hypot(u.x, u.y, u.z) * Math.hypot(v.x, v.y, v.z);
      if (len > 0 && cr / len < 1e-6 && u.x * v.x + u.y * v.y + u.z * v.z > 0) {
        out = out.filter((_, j) => j !== i);
        changed = true;
        break;
      }
    }
  }
  return out;
}

/**
 * The building from outside: facades with windows and doors, walls rising above a lower roof next
 * to them, flat roofs, roof planes with roof windows, and dormers.
 */
export function exteriorFaces(levels: Level[]): Face[] {
  const faces: Face[] = [];
  levels.forEach((lv, li) => {
    const { plan, offset } = lv;
    const tops = topsOf(levels, lv);
    const facades: Face[] = [];

    // Facades along the outline. Each piece takes the top of the room behind it.
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
          const ts = tops.splits(p, q);
          const info = ts.slice(0, -1).map((t, k) => {
            const tm = (t + ts[k + 1]) / 2;
            const m = { x: p.x + (q.x - p.x) * tm - normal.x * 0.02, y: p.y + (q.y - p.y) * tm - normal.y * 0.02 };
            return { owner: tops.ownerOf(m), upper: tops.coveredBy(m) };
          });
          const polys = wallPolygon(p, q, ts, () => lv.base, (pt, k) => tops.top(info[k].owner, pt, info[k].upper), offset);
          for (const pts of polys) {
            const bottom = pts.filter((x) => Math.abs(x.z - lv.base) < 1e-6);
            const edge: [P3, P3] = [bottom[0] ?? pts[0], bottom[bottom.length - 1] ?? pts[1]];
            facades.push({ kind: 'facade', pts, holes: [], normal, decals: [], level: li, layer: 1, edge });
          }
        }
      });
    }
    for (const o of plan.openings.filter((x) => x.exterior)) {
      const d = openingDecal(o, lv.base, offset, plan.outerWall);
      if (!d) continue;
      const host = facades.find(
        (f) =>
          Math.abs(f.normal.x + o.inward.x) < 0.02 &&
          Math.abs(f.normal.y + o.inward.y) < 0.02 &&
          onBottom(d.pts[0], f) &&
          onBottom(d.pts[1], f),
      );
      if (host) host.decals.push(d);
    }
    faces.push(...facades);

    // Walls between two rooms whose tops differ (an extension against the house): the part of the
    // higher side that rises above the lower one, facing the lower room.
    for (const r of plan.rooms) {
      for (const w of r.walls) {
        for (const nb of w.neighbours) {
          const p = { x: w.from.x + w.dir.x * nb.from, y: w.from.y + w.dir.y * nb.from };
          const q = { x: w.from.x + w.dir.x * nb.to, y: w.from.y + w.dir.y * nb.to };
          const ts = tops.splits(p, q);
          const info = ts.slice(0, -1).map((t, k) => {
            const tm = (t + ts[k + 1]) / 2;
            const m = { x: p.x + (q.x - p.x) * tm, y: p.y + (q.y - p.y) * tm };
            const own = { x: m.x + w.inward.x * 0.02, y: m.y + w.inward.y * 0.02 };
            const other = { x: m.x - w.inward.x * (nb.thickness + 0.02), y: m.y - w.inward.y * (nb.thickness + 0.02) };
            return { ownUpper: tops.coveredBy(own), otherUpper: tops.coveredBy(other) };
          });
          const polys = wallPolygon(
            p,
            q,
            ts,
            (pt, k) => tops.top(r.index, pt, info[k].ownUpper),
            (pt, k) => tops.top(nb.room, pt, info[k].otherUpper),
            offset,
          );
          for (const pts of polys) faces.push({ kind: 'facade', pts, holes: [], normal: { x: w.inward.x, y: w.inward.y, z: 0 }, decals: [], level: li, layer: 1 });
        }
      }
    }

    // Flat roofs: rooms without a roof, where no floor stands on them.
    const footprintGeom = plan.footprint.map((poly) => poly.map((ring) => toRing(ring)));
    plan.rooms.forEach((r, ri) => {
      if (plan.roomRoof[ri] !== null && plan.roomRoof[ri] !== undefined) return;
      let area: MultiPolygon = intersection([toRing(tops.grown[ri])], footprintGeom as MultiPolygon);
      const others = plan.rooms.filter((x) => x.index !== ri).map((x) => [toRing(x.points)] as ClipPolygon);
      if (others.length) area = difference(area, ...others);
      for (const above of levels.filter((l) => l.number === lv.number + 1 && l.base > lv.base)) {
        const shifted = above.plan.footprint.map((poly) => poly.map((ring) => toRing(ring.map((p) => ({ x: p.x + above.offset.x - lv.offset.x, y: p.y + above.offset.y - lv.offset.y })))));
        if (shifted.length) area = difference(area, shifted as MultiPolygon);
      }
      const z = lv.base + Math.max(...r.heights) + plan.flatThickness;
      for (const poly of area) {
        const rings = poly.map((ring) => ring.slice(0, -1).map(([x, y]) => ({ x, y })));
        if (rings[0].length < 3) continue;
        faces.push({
          kind: 'flat',
          pts: rings[0].map((p) => p3(p, z, offset)),
          holes: rings.slice(1).map((h) => h.map((p) => p3(p, z, offset))),
          normal: { x: 0, y: 0, z: 1 },
          decals: [],
          level: li,
          layer: 0,
          order: z,
        });
      }
    });

    // Roof planes, roof windows and dormers.
    for (const roof of plan.roofs) {
      const e = roof.eaves;
      const at = (c: number, v: number, z: number): P3 =>
        roof.ridge === 'x' ? { x: v + offset.x, y: c + offset.y, z: z + lv.base } : { x: c + offset.x, y: v + offset.y, z: z + lv.base };
      const shift = (p: P3): P3 => ({ x: p.x + offset.x, y: p.y + offset.y, z: p.z + lv.base });
      const planeFaces: Face[] = [];
      for (let i = 0; i + 1 < e.length; i++) {
        const pts = [at(e[i].c, roof.from, e[i].z), at(e[i + 1].c, roof.from, e[i + 1].z), at(e[i + 1].c, roof.to, e[i + 1].z), at(e[i].c, roof.to, e[i].z)];
        const normal = faceNormal(pts);
        const up = normal.z < 0 ? { x: -normal.x, y: -normal.y, z: -normal.z } : normal;
        const face: Face = { kind: 'roof', pts, holes: [], normal: up, decals: [], level: li, layer: 2 };
        planeFaces.push(face);
        faces.push(face);
      }
      for (const w of roof.windows) {
        planeFaces[w.plane]?.decals.push({ pts: w.pts.map(shift), kind: 'glass', name: w.name });
      }
      for (const d of roof.dormers) {
        const host = planeFaces[d.plane];
        const facing = { x: d.facing.x, y: d.facing.y, z: 0 };
        const along = roof.ridge === 'x' ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
        const front: Face = { kind: 'dormer', pts: d.front.map(shift), holes: [], normal: facing, decals: [], level: li, layer: 2, host };
        if (d.window) front.decals.push({ pts: d.window.map(shift), kind: 'glass', name: d.name });
        faces.push(
          front,
          { kind: 'dormer', pts: d.cheeks[0].map(shift), holes: [], normal: { x: -along.x, y: -along.y, z: 0 }, decals: [], level: li, layer: 2, host },
          { kind: 'dormer', pts: d.cheeks[1].map(shift), holes: [], normal: along, decals: [], level: li, layer: 2, host },
          { kind: 'flat', pts: d.top.map(shift), holes: [], normal: { x: 0, y: 0, z: 1 }, decals: [], level: li, layer: 2, host },
        );
      }
    }
  });
  return faces;
}

/** Does p lie on the bottom edge (first two points) of a facade? */
function onBottom(p: P3, f: Face): boolean {
  const [a, b] = f.edge ?? [f.pts[0], f.pts[1]];
  return onSegment(p, a, b);
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
  const centre = (f: Face) => f.pts.reduce((s, p) => s + proj(p).depth, 0) / f.pts.length;
  // A dormer goes right after its roof plane (slightly nearer), whatever its own centre is.
  const depth = (f: Face) => (f.host ? centre(f.host) - 1e-3 - (f.kind === 'flat' ? 1e-4 : 0) : centre(f));
  const sorted = visible
    .map((f) => ({ f, d: depth(f) }))
    .sort((a, b) => a.f.level - b.f.level || a.f.layer - b.f.layer || (a.f.order ?? 0) - (b.f.order ?? 0) || b.d - a.d);
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

/**
 * Drawings of a floor plan and the building: plan with dimensions, 3D views and the four
 * elevations with dimensions. Output is the vector format of ./vector, in metres.
 */
import { Camera, cutawayFaces, exteriorFaces, Level, project, Projected } from '../geometry/building';
import { FloorPlan, pointInPolygon } from '../geometry/floorplan';
import { Point } from '../geometry/geometry';
import { formatArea } from '../geometry/units';
import { Prim, View } from './vector';

const mm = (m: number) => String(Math.round(m * 1000));

const COLOURS: Record<Projected['kind'], [number, number, number]> = {
  facade: [221, 212, 196],
  dormer: [236, 233, 226],
  roof: [112, 78, 64],
  flat: [140, 146, 142],
  floor: [233, 228, 216],
  inner: [246, 242, 234],
  cap: [61, 68, 65],
  glass: [150, 188, 210],
  door: [122, 90, 64],
  roldeur: [120, 128, 132],
};

function shade(kind: Projected['kind'], light: number): string {
  const f = 0.64 + 0.36 * light;
  const [r, g, b] = COLOURS[kind];
  return `rgb(${Math.round(r * f)},${Math.round(g * f)},${Math.round(b * f)})`;
}

function projectedPrims(faces: Projected[], labels = true): Prim[] {
  const prims: Prim[] = [];
  for (const f of faces) {
    const cls = f.kind === 'glass' ? 'f-glass' : f.kind === 'door' ? 'f-door' : f.kind === 'roldeur' ? 'f-roll' : 'f';
    const decal = f.kind === 'glass' || f.kind === 'door' || f.kind === 'roldeur';
    prims.push({ t: 'poly', rings: f.rings, cls, fill: decal ? undefined : shade(f.kind, f.light) });
    if (f.kind === 'roldeur' && f.rings[0].length === 4) {
      // Horizontal slats about every 25 cm (bottom-left, bottom-right, top-right, top-left).
      const [bl, br, tr, tl] = f.rings[0];
      const h = Math.hypot(tl.x - bl.x, tl.y - bl.y);
      const n = Math.max(2, Math.round(h / 0.25));
      for (let i = 1; i < n; i++) {
        const t = i / n;
        prims.push({
          t: 'line',
          pts: [
            { x: bl.x + (tl.x - bl.x) * t, y: bl.y + (tl.y - bl.y) * t },
            { x: br.x + (tr.x - br.x) * t, y: br.y + (tr.y - br.y) * t },
          ],
          cls: 'slat',
        });
      }
    }
  }
  if (labels) {
    // Names of frontal openings, when there is room for them (drawn last so nothing covers them).
    for (const f of faces) {
      if (!f.frontal || !f.name) continue;
      const xs = f.rings[0].map((p) => p.x);
      const ys = f.rings[0].map((p) => p.y);
      const w = Math.max(...xs) - Math.min(...xs);
      if (w < 0.7) continue;
      prims.push({
        t: 'text',
        at: { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 },
        text: f.name,
        cls: f.kind === 'door' || f.kind === 'roldeur' ? 'label on-dark' : 'label muted',
        size: 2,
      });
    }
  }
  return prims;
}

export interface PlanViewOptions {
  /** Lengths of every wall inside the rooms. */
  roomDims?: boolean;
  /** Dashed outline of the roof. */
  roof?: boolean;
  /** Stairwells in the floor above, shown dashed ("trap ↑"). */
  fromAbove?: { name: string; points: Point[] }[];
  /** A loft: the rooms of the floor it lies in, as thin lines. */
  under?: Point[][];
  /** Lofts lying in this floor: dashed outline with name and floor height. */
  lofts?: { name: string; height: number; rings: Point[][] }[];
  title?: string;
}

/** Floor plan of one level with wall thicknesses, doors, windows and dimensions. */
export function planView(plan: FloorPlan, opts: PlanViewOptions = {}): View {
  const prims: Prim[] = [];
  for (const r of plan.rooms) prims.push({ t: 'poly', rings: r.floor?.length ? r.floor : [r.points], cls: 'room' });
  if (plan.wallRings.length) prims.push({ t: 'poly', rings: plan.wallRings, cls: 'wall' });

  for (const o of plan.openings) {
    const out = { x: -o.inward.x * o.thickness, y: -o.inward.y * o.thickness };
    const a2 = { x: o.a.x + out.x, y: o.a.y + out.y };
    const b2 = { x: o.b.x + out.x, y: o.b.y + out.y };
    prims.push({ t: 'poly', rings: [[o.a, o.b, b2, a2]], cls: 'gap' });
    prims.push({ t: 'line', pts: [o.a, a2], cls: 'sym' }, { t: 'line', pts: [o.b, b2], cls: 'sym' });
    if (o.style === 'deur') {
      // Leaf open at 90°, hinged on the face of the wall it opens to, with the swing.
      const inwards = o.swing !== 'buiten';
      const towards = inwards ? o.inward : { x: -o.inward.x, y: -o.inward.y };
      const [p, q] = inwards ? [o.a, o.b] : [a2, b2];
      const hinge = o.hingeAt === 'a' ? p : q;
      const other = o.hingeAt === 'a' ? q : p;
      const leaf = { x: hinge.x + towards.x * o.width, y: hinge.y + towards.y * o.width };
      prims.push({ t: 'line', pts: [hinge, leaf], cls: 'sym' });
      const u = { x: (other.x - hinge.x) / o.width, y: (other.y - hinge.y) / o.width };
      const arc: Point[] = [];
      for (let i = 0; i <= 16; i++) {
        const t = (i / 16) * (Math.PI / 2);
        arc.push({
          x: hinge.x + (towards.x * Math.cos(t) + u.x * Math.sin(t)) * o.width,
          y: hinge.y + (towards.y * Math.cos(t) + u.y * Math.sin(t)) * o.width,
        });
      }
      prims.push({ t: 'line', pts: arc, cls: 'sym-thin' });
    } else if (o.style === 'roldeur') {
      // Overhead roller door: the curtain in the wall, the coil box inside along the top (dashed).
      const m = 0.5;
      prims.push({
        t: 'line',
        pts: [
          { x: o.a.x + out.x * m, y: o.a.y + out.y * m },
          { x: o.b.x + out.x * m, y: o.b.y + out.y * m },
        ],
        cls: 'sym',
      });
      const box = 0.35;
      const ai = { x: o.a.x + o.inward.x * box, y: o.a.y + o.inward.y * box };
      const bi = { x: o.b.x + o.inward.x * box, y: o.b.y + o.inward.y * box };
      prims.push({ t: 'line', pts: [o.a, ai, bi, o.b], cls: 'sym-thin' });
      const mid = { x: (ai.x + bi.x) / 2 + o.inward.x * 0.35, y: (ai.y + bi.y) / 2 + o.inward.y * 0.35 };
      prims.push({ t: 'text', at: mid, text: 'roldeur ↑', cls: 'label-sub', size: 2 });
    } else {
      const m = 0.5;
      prims.push({ t: 'line', pts: [o.a, o.b, b2, a2], cls: 'sym', closed: true });
      prims.push({
        t: 'line',
        pts: [
          { x: o.a.x + out.x * m, y: o.a.y + out.y * m },
          { x: o.b.x + out.x * m, y: o.b.y + out.y * m },
        ],
        cls: 'sym',
      });
    }
  }

  // Holes in this floor: crossed, with their size; holes in the floor above: dashed.
  for (const v of plan.voids) {
    const [a, b, c, d] = v.points;
    prims.push({ t: 'poly', rings: [v.points], cls: 'void' });
    prims.push({ t: 'line', pts: [a, c], cls: 'sym' }, { t: 'line', pts: [b, d], cls: 'sym' });
    prims.push({ t: 'dim', a, b, off: -6 * orientationSign(v.points), text: mm(Math.hypot(b.x - a.x, b.y - a.y)), ext: false });
    prims.push({ t: 'dim', a: b, b: c, off: -6 * orientationSign(v.points), text: mm(Math.hypot(c.x - b.x, c.y - b.y)), ext: false });
    prims.push({ t: 'text', at: centre(v.points), text: v.name, cls: 'label-sub', size: 2.3, dy: 2.2 });
  }
  for (const ring of opts.under ?? []) prims.push({ t: 'line', pts: ring, cls: 'sym-thin', closed: true });
  for (const loft of opts.lofts ?? []) {
    for (const ring of loft.rings) prims.push({ t: 'line', pts: ring, cls: 'roof-line', closed: true });
    const all = loft.rings.flat();
    if (all.length) {
      // In the middle of the loft, under the room's own name if that is there too.
      const c = { x: (Math.min(...all.map((p) => p.x)) + Math.max(...all.map((p) => p.x))) / 2, y: (Math.min(...all.map((p) => p.y)) + Math.max(...all.map((p) => p.y))) / 2 };
      prims.push({ t: 'text', at: c, text: `${loft.name} +${mm(loft.height)}`, cls: 'label-sub', size: 2.2 });
    }
  }
  for (const v of opts.fromAbove ?? []) {
    prims.push({ t: 'line', pts: v.points, cls: 'sym-thin', closed: true });
    prims.push({ t: 'text', at: centre(v.points), text: `${v.name} ↑`, cls: 'label-sub', size: 2.3 });
  }

  for (const r of plan.rooms) {
    const xs = r.points.map((p) => p.x);
    const ys = r.points.map((p) => p.y);
    // Small rooms (toilet, meter cupboard): name and size as text instead of dimension lines.
    const small = Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) < 1.8;
    if (small) {
      const size = r.walls.length === 4 ? `${mm(r.walls[0].length)}×${mm(r.walls[1].length)}` : formatArea(r.area);
      prims.push({ t: 'text', at: r.centroid, text: r.name, cls: 'label', size: 2.2, dy: 1.3 });
      prims.push({ t: 'text', at: r.centroid, text: size, cls: 'label-sub', size: 1.9, dy: -1.3 });
      continue;
    }
    prims.push({ t: 'text', at: r.centroid, text: r.name, cls: 'label', size: 2.8, dy: 1.8 });
    prims.push({ t: 'text', at: r.centroid, text: formatArea(r.area), cls: 'label-sub', size: 2.3, dy: -1.8 });
    if (opts.roomDims !== false) {
      for (const w of r.walls) {
        if (w.length < 0.6) continue;
        // Inside the room: the inward side of the wall.
        const left = { x: -w.dir.y, y: w.dir.x };
        const inside = left.x * w.inward.x + left.y * w.inward.y > 0 ? 1 : -1;
        prims.push({ t: 'dim', a: w.from, b: w.to, off: 3.2 * inside, text: mm(w.length), ext: false });
      }
    }
  }

  // Outside dimensions: chain along the front and right side, and the totals.
  const o = plan.outer;
  const near = 0.06;
  const front = new Set<number>([o.minX, o.maxX]);
  const side = new Set<number>([o.minY, o.maxY]);
  for (const r of plan.rooms) {
    const xs = r.points.map((p) => p.x);
    const ys = r.points.map((p) => p.y);
    if (Math.min(...ys) - (o.minY + plan.outerWall) < near) [Math.min(...xs), Math.max(...xs)].forEach((x) => front.add(x));
    if (o.maxX - plan.outerWall - Math.max(...xs) < near) [Math.min(...ys), Math.max(...ys)].forEach((y) => side.add(y));
  }
  const chain = (values: Set<number>) =>
    [...values].sort((a, b) => a - b).filter((v, i, arr) => i === 0 || v - arr[i - 1] > 0.002);
  const fx = chain(front);
  const sy = chain(side);
  if (fx.length > 2) {
    for (let i = 0; i + 1 < fx.length; i++) prims.push({ t: 'dim', a: { x: fx[i], y: o.minY }, b: { x: fx[i + 1], y: o.minY }, off: -6, text: mm(fx[i + 1] - fx[i]) });
  }
  prims.push({ t: 'dim', a: { x: o.minX, y: o.minY }, b: { x: o.maxX, y: o.minY }, off: fx.length > 2 ? -13 : -6, text: mm(o.maxX - o.minX) });
  if (sy.length > 2) {
    for (let i = 0; i + 1 < sy.length; i++) prims.push({ t: 'dim', a: { x: o.maxX, y: sy[i] }, b: { x: o.maxX, y: sy[i + 1] }, off: -6, text: mm(sy[i + 1] - sy[i]) });
  }
  prims.push({ t: 'dim', a: { x: o.maxX, y: o.minY }, b: { x: o.maxX, y: o.maxY }, off: sy.length > 2 ? -13 : -6, text: mm(o.maxY - o.minY) });

  for (const r of opts.roof === false ? [] : plan.roofs) {
    const c0 = r.eaves[0].c;
    const c1 = r.eaves[r.eaves.length - 1].c;
    const at = (c: number, v: number): Point => (r.ridge === 'x' ? { x: v, y: c } : { x: c, y: v });
    prims.push({ t: 'line', pts: [at(c0, r.from), at(c1, r.from), at(c1, r.to), at(c0, r.to)], cls: 'roof-line', closed: true });
    const top = r.ridgeHeight;
    for (const p of r.profile) {
      const isRidge = Math.abs(p.z - top) < 1e-6;
      const isEdge = p === r.profile[0] || p === r.profile[r.profile.length - 1];
      if (isEdge) continue;
      prims.push({ t: 'line', pts: [at(p.c, r.from), at(p.c, r.to)], cls: isRidge ? 'ridge-line' : 'roof-line' });
    }
    for (const d of r.dormers) {
      prims.push({ t: 'line', pts: d.outline, cls: 'sym-thin', closed: true });
      prims.push({ t: 'text', at: centre(d.outline), text: d.name, cls: 'label-sub', size: 2.1 });
    }
    for (const w of r.windows) {
      prims.push({ t: 'line', pts: w.outline, cls: 'sym', closed: true });
      prims.push({ t: 'line', pts: [w.outline[0], w.outline[2]], cls: 'sym-thin' });
      prims.push({ t: 'text', at: centre(w.outline), text: w.name, cls: 'label-sub', size: 2.1, dy: 2.2 });
    }
  }
  return { prims, title: opts.title, scalable: true };
}

function centre(points: Point[]): Point {
  return { x: points.reduce((s, p) => s + p.x, 0) / points.length, y: points.reduce((s, p) => s + p.y, 0) / points.length };
}

/** +1 for counter-clockwise corners, -1 for clockwise: which side of an edge is inside. */
function orientationSign(points: Point[]): number {
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    s += p.x * q.y - q.x * p.y;
  }
  return s >= 0 ? -1 : 1;
}

export type Side = 'voor' | 'rechts' | 'achter' | 'links';

export const SIDE_LABELS: Record<Side, string> = {
  voor: 'Voorgevel',
  rechts: 'Rechterzijgevel',
  achter: 'Achtergevel',
  links: 'Linkerzijgevel',
};

const SIDE_AZIMUTH: Record<Side, number> = { voor: 0, rechts: -90, achter: 180, links: 90 };

/** The building from outside, in 3D. */
export function exteriorView(levels: Level[], cam: Camera, title?: string): View {
  return { prims: projectedPrims(project(exteriorFaces(levels), cam), false), title, scalable: false };
}

/** One floor from above with the walls cut, like a doll's house. */
export function cutawayView(level: Level, cam: Camera, title?: string, host?: Level): View {
  const proj = (p: Point, z = 0) => {
    const az = (cam.azimuth * Math.PI) / 180;
    const el = (cam.elevation * Math.PI) / 180;
    const y1 = p.x * Math.sin(az) + p.y * Math.cos(az);
    return { x: p.x * Math.cos(az) - p.y * Math.sin(az), y: z * Math.cos(el) + y1 * Math.sin(el) };
  };
  const cutOf = (lv: Level) => {
    const minHeight = Math.min(...lv.plan.rooms.flatMap((r) => r.heights));
    return Math.max(0.5, Math.min(Number.isFinite(minHeight) ? minHeight : 2.4, 2.6));
  };
  if (level.open && host) {
    // A loft: the floor it lies in, its walls cut just under the loft, and the loft on top.
    const dz = level.base - host.base;
    const d = { x: level.offset.x - host.offset.x, y: level.offset.y - host.offset.y };
    const lower = cutawayFaces(host, Math.max(0.5, Math.min(cutOf(host), dz - 0.02)));
    const loft = cutawayFaces(level, 0).map((f) => ({
      ...f,
      level: 1,
      pts: f.pts.map((p) => ({ x: p.x + d.x, y: p.y + d.y, z: p.z + dz })),
      holes: f.holes.map((h) => h.map((p) => ({ x: p.x + d.x, y: p.y + d.y, z: p.z + dz }))),
    }));
    const prims = projectedPrims(project([...lower, ...loft], cam), false);
    for (const r of host.plan.rooms) prims.push({ t: 'text', at: proj(r.centroid), text: r.name, cls: 'label', size: 2.4 });
    for (const r of level.plan.rooms) prims.push({ t: 'text', at: proj({ x: r.centroid.x + d.x, y: r.centroid.y + d.y }, dz), text: r.name, cls: 'label', size: 2.6 });
    return { prims, title, scalable: false };
  }
  const faces = project(cutawayFaces(level, cutOf(level)), cam);
  const prims = projectedPrims(faces, false);
  for (const r of level.plan.rooms) prims.push({ t: 'text', at: proj(r.centroid), text: r.name, cls: 'label', size: 2.6 });
  return { prims, title, scalable: false };
}

/** Elevation of one side with dimensions: openings, overall width, floor levels, eaves and ridge. */
export function elevationView(levels: Level[], side: Side, opts: { chains?: boolean } = {}): View {
  const faces = project(exteriorFaces(levels), { azimuth: SIDE_AZIMUTH[side], elevation: 0 });
  const prims = projectedPrims(faces);
  const walls = faces.filter((f) => f.kind === 'facade');
  if (walls.length === 0) return { prims, title: SIDE_LABELS[side], scalable: true };
  const xs = walls.flatMap((f) => f.rings[0].map((p) => p.x));
  const ys = faces.flatMap((f) => f.rings[0].map((p) => p.y));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const all = faces.flatMap((f) => f.rings[0].map((p) => p.x));
  const roofMin = Math.min(...all);
  const roofMax = Math.max(...all);
  const top = Math.max(...ys);

  prims.push({ t: 'line', pts: [{ x: roofMin - 0.8, y: 0 }, { x: roofMax + 0.8, y: 0 }], cls: 'ground' });

  // Horizontal: per floor a chain through its openings seen square-on, then the overall width.
  let row = -6;
  const floors = opts.chains === false ? [] : [...new Set(faces.filter((f) => f.frontal).map((f) => f.level))].sort((a, b) => a - b);
  for (const lvl of floors) {
    const stops = new Set<number>([minX, maxX]);
    for (const f of faces) {
      if (!f.frontal || f.level !== lvl) continue;
      const fx = f.rings[0].map((p) => p.x);
      stops.add(Math.min(...fx));
      stops.add(Math.max(...fx));
    }
    const xsSorted = [...stops].sort((a, b) => a - b).filter((v, i, arr) => i === 0 || v - arr[i - 1] > 0.002);
    for (let i = 0; i + 1 < xsSorted.length; i++) {
      prims.push({ t: 'dim', a: { x: xsSorted[i], y: 0 }, b: { x: xsSorted[i + 1], y: 0 }, off: row, text: mm(xsSorted[i + 1] - xsSorted[i]), ext: i === 0 && row === -6 });
    }
    if (floors.length > 1 || levels.length > 1) {
      prims.push({ t: 'text', at: { x: minX, y: 0 }, text: levels[lvl]?.name ?? '', cls: 'label-sub', size: 2, anchor: 'end', dx: -2, dy: row - 0.2 });
    }
    row -= 8;
  }
  prims.push({ t: 'dim', a: { x: minX, y: 0 }, b: { x: maxX, y: 0 }, off: row, text: mm(maxX - minX) });
  if (roofMax - roofMin > maxX - minX + 0.01) {
    prims.push({ t: 'dim', a: { x: roofMin, y: top }, b: { x: roofMax, y: top }, off: 6, text: mm(roofMax - roofMin) });
  }

  // Vertical, right of the building: floor levels, eaves/top of the walls and the ridge.
  const heights = new Set<number>([0, top]);
  for (const lv of levels) if (lv.base > 0 && !lv.open) heights.add(lv.base);
  // In an elevation the screen height is the real height: take the corners of walls, dormers and flat roofs.
  // Only corners you can see: not covered by a face drawn later (nearer).
  faces.forEach((f, i) => {
    if (f.kind !== 'facade' && f.kind !== 'dormer' && f.kind !== 'flat' && f.kind !== 'roof') return;
    for (const p of f.rings[0]) {
      const hidden = faces.slice(i + 1).some((g) => g.kind !== 'glass' && g.kind !== 'door' && g.kind !== 'roldeur' && pointInPolygon(p, g.rings[0], -0.01));
      if (!hidden) heights.add(Math.round(p.y * 1e4) / 1e4);
    }
  });
  // Heights closer than 30 cm to one already shown would make the chain unreadable. Keep, in order:
  // ground and top, floor levels, then the other corners from low to high.
  const floorsAt = levels.filter((lv) => lv.base > 0 && !lv.open).map((lv) => lv.base);
  const rank = (h: number) => (h === 0 || h === top ? 0 : floorsAt.some((b) => Math.abs(b - h) < 1e-6) ? 1 : 2);
  const hs: number[] = [];
  for (const h of [...heights].filter((x) => x <= top + 1e-6).sort((a, b) => rank(a) - rank(b) || a - b)) {
    if (rank(h) === 0 || hs.every((k) => Math.abs(k - h) >= 0.29)) hs.push(h);
  }
  hs.sort((a, b) => a - b);
  const xr = roofMax;
  if (hs.length > 2) {
    for (let i = 0; i + 1 < hs.length; i++) {
      prims.push({ t: 'dim', a: { x: xr, y: hs[i] }, b: { x: xr, y: hs[i + 1] }, off: -6, text: mm(hs[i + 1] - hs[i]) });
    }
  }
  prims.push({ t: 'dim', a: { x: xr, y: 0 }, b: { x: xr, y: top }, off: hs.length > 2 ? -13 : -6, text: mm(top) });
  // Level marks on the left, as on a building drawing: "+2950".
  for (const h of hs) {
    prims.push({ t: 'text', at: { x: roofMin - 0.8, y: h }, text: h === 0 ? '±0' : `+${mm(h)}`, cls: 'label-sub', size: 2.4, anchor: 'end', dx: -1.2 });
    prims.push({ t: 'line', pts: [{ x: roofMin - 0.8, y: h }, { x: roofMin - 0.35, y: h }], cls: 'sym-thin' });
  }
  return { prims, title: SIDE_LABELS[side], scalable: true };
}

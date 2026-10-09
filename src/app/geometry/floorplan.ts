/**
 * A floor of a building: measured rooms placed against each other with the walls in between,
 * the outer walls around them, a check against the measured outside dimensions, and a roof on top.
 *
 * Rooms are measured from the inside, so the plan is built the way you measure: one room is the
 * starting point, every other room is placed against a wall of a room that is already placed,
 * with the thickness of the wall in between and a shift along that wall.
 *
 * Plan coordinates: metres, x to the right, y away from the viewer ("front" is the bottom of the
 * plan, at small y). After placing, everything is shifted so the outside of the building starts at (0, 0).
 */
import { MultiPolygon, Polygon as ClipPolygon, Ring } from 'polygon-clipping';
import { difference, union as unionAll } from './clip';
import { GeometryError, Point } from './geometry';
import { placeRoof, PlacedRoof, PlanRoofInput } from './roofs';

export { roofProfile } from './roofs';
export type { DormerInput, P3, PlacedDormer, PlacedRoof, PlacedRoofWindow, PlanRoofInput, ProfilePoint, RoofPlane, RoofWindowInput } from './roofs';

const MM = 0.001;

/** How an opening is drawn: a hinged door, an overhead roller door, a sliding glass door or a window. */
export type OpeningStyle = 'deur' | 'roldeur' | 'schuif' | 'raam';

export interface OpeningOptions {
  /** Kind of opening; when absent it follows from the name ("deur", "roldeur", "schuifpui", "raam"). */
  type?: OpeningStyle | null;
  /** Hinged door: opens into this room ('binnen') or to the other side ('buiten'). */
  swing?: 'binnen' | 'buiten' | null;
  /**
   * Hinged door, DIN: hinges on the left or right, seen from the side the door opens towards.
   * When absent the hinges are at the end nearest the wall's first corner.
   */
  hinge?: 'links' | 'rechts' | null;
}

export interface PlanOpeningInput extends OpeningOptions {
  name: string;
  wall: number;
  offset: number;
  width: number;
  height: number;
  sill: number;
}

export interface PlanLinkInput {
  /** Id of the room this room is placed against (must be placed earlier or later in the list). */
  to: string;
  /** Wall of this room (wall i runs from corner i to corner i+1). */
  wall: number;
  /** Wall of the other room it faces. */
  toWall: number;
  /** Thickness of the wall in between. */
  thickness: number;
  /**
   * Shift along the other room's wall: distance from its first corner (corner `toWall`) to the
   * nearest end of this room's wall. Negative moves it back past that corner.
   */
  offset: number;
  /**
   * The room lies inside the other room (a toilet in a garage) instead of against it. `thickness`
   * is then the room's own walls, and `distance` how far its wall is from the other room's wall
   * (0 = it uses that wall).
   */
  inside?: boolean;
  distance?: number;
}

export interface PlanRoomInput {
  id: string;
  name: string;
  /** Corners as measured (local coordinates of the shape). */
  points: Point[];
  /** Height at every corner (floor to ceiling or wall plate). */
  heights: number[];
  openings: PlanOpeningInput[];
  volume: number | null;
  /** The corners were numbered clockwise: mirror the measured shape. */
  mirror: boolean;
  /** How the room is placed; null for the starting room. */
  link: PlanLinkInput | null;
}


/** A hole in the floor (stairwell, vide), placed in a room from one of its walls. */
export interface PlanVoidInput {
  name: string;
  room: string;
  wall: number;
  /** Along the wall, from its first corner to the near side of the hole. */
  offset: number;
  /** From the wall into the room to the hole. */
  distance: number;
  /** Size along the wall and into the room. */
  width: number;
  length: number;
}

export interface PlacedVoid {
  name: string;
  room: number;
  /** Corners in plan coordinates. */
  points: Point[];
  area: number;
}

export interface PlanInput {
  rooms: PlanRoomInput[];
  voids?: PlanVoidInput[];
  outerWall: number;
  /** Measured outside dimensions: width of the front (x) and depth (y). */
  measuredWidth: number | null;
  measuredDepth: number | null;
  /** Quarter turns (counter-clockwise) of the whole plan, to choose which side is the front. */
  turn: number;
  /** Roofs on this floor; rooms under no roof get a flat roof. */
  roofs?: PlanRoofInput[];
  /** @deprecated single roof over the whole floor; use `roofs`. */
  roof?: PlanRoofInput | null;
  /** Thickness of a flat roof above rooms without a roof or a floor above (default 0,300). */
  flatThickness?: number;
}

export interface WallOpening extends OpeningOptions {
  name: string;
  door: boolean;
  style: OpeningStyle;
  /** Along this wall, from its first corner to the near edge. */
  offset: number;
  width: number;
  height: number;
  sill: number;
  /** False when the opening was placed in the neighbouring room and shows up here through the wall. */
  own: boolean;
}

export interface Neighbour {
  room: number;
  wall: number;
  thickness: number;
  /** Part of this wall (distance from its first corner) that the neighbour covers. */
  from: number;
  to: number;
}

export interface PlacedWall {
  room: number;
  index: number;
  from: Point;
  to: Point;
  length: number;
  /** Unit vector along the wall and the normal pointing into the room. */
  dir: Point;
  inward: Point;
  heightFrom: number;
  heightTo: number;
  neighbours: Neighbour[];
  openings: WallOpening[];
}

export interface PlacedRoom {
  index: number;
  id: string;
  name: string;
  points: Point[];
  heights: number[];
  walls: PlacedWall[];
  area: number;
  volume: number | null;
  centroid: Point;
  /** Corner (index) of this room at which the link's shift is measured, for the editor. */
  shiftCorner: number | null;
  /** Wall area of the room minus all openings, including those from neighbours. */
  netWallArea: number;
  /** Room this one lies inside (index), or null. */
  host: number | null;
  /** Floor of the room as drawn: its outline minus rooms inside it with their walls (even-odd rings). */
  floor: Point[][];
}

/** A door or window in the plan, on the inside face of its own room's wall. */
export interface PlanOpening {
  name: string;
  /** Hinged or roller door (drawn as a door, not as glass). */
  door: boolean;
  style: OpeningStyle;
  /** Hinged door: where the leaf turns. Into the room means towards `inward`. */
  swing: 'binnen' | 'buiten';
  /** Hinged door: the end with the hinges (a or b). */
  hingeAt: 'a' | 'b';
  room: number;
  wall: number;
  /** Ends on the inside face of the wall. */
  a: Point;
  b: Point;
  inward: Point;
  /** Thickness of the wall at the opening (outer wall or partition). */
  thickness: number;
  exterior: boolean;
  width: number;
  height: number;
  sill: number;
}

export interface Box {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface DimensionCheck {
  measured: number | null;
  /** Rooms plus walls in between plus the outer wall on both sides. */
  computed: number;
  /** Measured minus computed. */
  diff: number | null;
  /** Outer wall thickness that would make the measurement fit. */
  impliedWall: number | null;
}

export interface FloorPlan {
  rooms: PlacedRoom[];
  unplaced: { name: string; reason: string }[];
  openings: PlanOpening[];
  outerWall: number;
  /** Outline of the building, outside of the outer walls: polygons of rings, first ring outer. */
  footprint: Point[][][];
  /** Wall area in plan: footprint with the rooms cut out (rings for an even-odd fill). */
  wallRings: Point[][];
  outer: Box;
  inner: Box;
  width: DimensionCheck;
  depth: DimensionCheck;
  netArea: number;
  grossArea: number;
  volume: number | null;
  /** Length of the walls between rooms (each wall once). */
  partitionLength: number;
  /** Stairwells and other holes in this floor. */
  voids: PlacedVoid[];
  voidArea: number;
  roofs: PlacedRoof[];
  /** The first roof (most floors have one). */
  roof: PlacedRoof | null;
  /** Per room: index of the roof it is under, or null (flat roof or a floor above). */
  roomRoof: (number | null)[];
  flatThickness: number;
  warnings: string[];
}

interface Transform {
  cos: number;
  sin: number;
  tx: number;
  ty: number;
  mirror: boolean;
}

const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: Point, k: number): Point => ({ x: a.x * k, y: a.y * k });
const dot = (a: Point, b: Point): number => a.x * b.x + a.y * b.y;
const cross = (a: Point, b: Point): number => a.x * b.y - a.y * b.x;
const unit = (a: Point): Point => {
  const l = Math.hypot(a.x, a.y) || 1;
  return { x: a.x / l, y: a.y / l };
};

export function signedArea(points: Point[]): number {
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    s += p.x * q.y - q.x * p.y;
  }
  return s / 2;
}

function apply(t: Transform, p: Point): Point {
  const x = p.x;
  const y = t.mirror ? -p.y : p.y;
  return { x: x * t.cos - y * t.sin + t.tx, y: x * t.sin + y * t.cos + t.ty };
}

function rotate(p: Point, cos: number, sin: number): Point {
  return { x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos };
}

function inwardNormal(dir: Point, ccw: boolean): Point {
  return ccw ? { x: -dir.y, y: dir.x } : { x: dir.y, y: -dir.x };
}

function wallName(i: number, n: number): string {
  return `${i + 1}–${((i + 1) % n) + 1}`;
}

/**
 * Outward offset of a simple polygon by distance d with mitred corners (the outside of a wall of
 * thickness d). Self-intersections at tight inward corners are resolved by the union afterwards.
 */
export function grow(points: Point[], d: number): Point[] {
  const n = points.length;
  const ccw = signedArea(points) > 0;
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n];
    const cur = points[i];
    const next = points[(i + 1) % n];
    const d1 = unit(sub(cur, prev));
    const d2 = unit(sub(next, cur));
    const n1 = mul(inwardNormal(d1, ccw), -d);
    const n2 = mul(inwardNormal(d2, ccw), -d);
    const c = cross(d1, d2);
    if (Math.abs(c) < 1e-9) {
      out.push(add(cur, n1)); // straight corner
      continue;
    }
    // Intersect the two offset lines: (cur + n1) + d1 * s  and  (cur + n2) + d2 * u.
    const p1 = add(cur, n1);
    const p2 = add(cur, n2);
    const s = cross(sub(p2, p1), d2) / c;
    out.push(add(p1, mul(d1, s)));
  }
  return out;
}

const toRing = (pts: Point[]): Ring => {
  const ring: Ring = pts.map((p) => [p.x, p.y] as [number, number]);
  ring.push([pts[0].x, pts[0].y]);
  return ring;
};

const fromRing = (ring: Ring): Point[] => {
  const pts = ring.map(([x, y]) => ({ x, y }));
  if (pts.length > 1 && Math.abs(pts[0].x - pts[pts.length - 1].x) < 1e-12 && Math.abs(pts[0].y - pts[pts.length - 1].y) < 1e-12) pts.pop();
  return dropStraight(pts);
};

/**
 * Remove corners that lie on a straight line (union output keeps them), and steps of a few
 * millimetres that come from measuring tolerances, so facades are not cut into strips.
 */
function dropStraight(pts: Point[], tol = 0.003): Point[] {
  let out = pts;
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      const p = out[(i - 1 + out.length) % out.length];
      const q = out[i];
      const r = out[(i + 1) % out.length];
      const len = Math.hypot(r.x - p.x, r.y - p.y) || 1;
      if (Math.abs(cross(sub(q, p), sub(r, p))) / len < tol || Math.hypot(q.x - p.x, q.y - p.y) < tol) {
        out = out.filter((_, j) => j !== i);
        changed = true;
        break;
      }
    }
  }
  return out;
}

function boxOf(points: Point[]): Box {
  return {
    minX: Math.min(...points.map((p) => p.x)),
    maxX: Math.max(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxY: Math.max(...points.map((p) => p.y)),
  };
}

function check(measured: number | null, inner: number, outerWall: number): DimensionCheck {
  const computed = inner + 2 * outerWall;
  return {
    measured,
    computed,
    diff: measured === null ? null : measured - computed,
    impliedWall: measured === null ? null : (measured - inner) / 2,
  };
}

export function buildFloorPlan(input: PlanInput): FloorPlan {
  const outerWall = input.outerWall;
  if (!(outerWall > 0)) throw new GeometryError('De buitenmuur moet dikker zijn dan 0.');
  const warnings: string[] = [];
  const unplaced: { name: string; reason: string }[] = [];
  const byId = new Map(input.rooms.map((r) => [r.id, r]));

  // 1. Place the rooms: the first one fixed, the rest through their link, in as many passes as needed.
  const transforms = new Map<string, Transform>();
  const shiftCorner = new Map<string, number>();
  const turn = ((Math.round(input.turn) % 4) + 4) % 4;
  const first = input.rooms[0];
  if (!first) throw new GeometryError('Voeg minstens één ruimte toe.');
  transforms.set(first.id, { cos: [1, 0, -1, 0][turn], sin: [0, 1, 0, -1][turn], tx: 0, ty: 0, mirror: first.mirror });

  const placedPoints = (r: PlanRoomInput) => r.points.map((p) => apply(transforms.get(r.id)!, p));
  const isCcw = (r: PlanRoomInput) => signedArea(r.points) > 0 !== r.mirror;

  const problems = new Map<string, string>();
  let progress = true;
  while (progress) {
    progress = false;
    for (const r of input.rooms.slice(1)) {
      if (transforms.has(r.id) || problems.has(r.id)) continue;
      const link = r.link;
      if (!link) {
        problems.set(r.id, 'Kies tegen welke ruimte deze ligt.');
        continue;
      }
      const other = byId.get(link.to);
      if (!other || other.id === r.id) {
        problems.set(r.id, 'De ruimte waar deze tegen ligt staat niet (meer) in de plattegrond.');
        continue;
      }
      if (!transforms.has(other.id)) continue; // try again in the next pass
      const n = r.points.length;
      const m = other.points.length;
      if (link.wall < 0 || link.wall >= n || link.toWall < 0 || link.toWall >= m) {
        problems.set(r.id, 'Kies de wanden waarmee de ruimtes tegen elkaar liggen.');
        continue;
      }
      if (link.thickness < 0 || (link.distance ?? 0) < 0) {
        problems.set(r.id, link.thickness < 0 ? 'De muurdikte kan niet negatief zijn.' : 'De afstand uit de wand kan niet negatief zijn.');
        continue;
      }
      // Other room's wall in plan coordinates.
      const op = placedPoints(other);
      const b0 = op[link.toWall];
      const b1 = op[(link.toWall + 1) % m];
      const dB = unit(sub(b1, b0));
      const nB = inwardNormal(dB, signedArea(op) > 0);
      // This room's wall, mirrored if needed, before rotation.
      const local = r.points.map((p) => (r.mirror ? { x: p.x, y: -p.y } : p));
      const a0 = local[link.wall];
      const a1 = local[(link.wall + 1) % n];
      const nA = inwardNormal(unit(sub(a1, a0)), signedArea(local) > 0);
      // Rotate so this room's inside points away from the other room, or the same way when it lies inside it.
      const target = link.inside ? nB : mul(nB, -1);
      const angle = Math.atan2(target.y, target.x) - Math.atan2(nA.y, nA.x);
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const ra0 = rotate(a0, cos, sin);
      const ra1 = rotate(a1, cos, sin);
      const nearFirst = dot(ra0, dB) <= dot(ra1, dB);
      const e = nearFirst ? ra0 : ra1;
      shiftCorner.set(r.id, nearFirst ? link.wall : (link.wall + 1) % n);
      const goal = link.inside
        ? add(add(b0, mul(dB, link.offset)), mul(nB, link.distance ?? 0))
        : add(add(b0, mul(dB, link.offset)), mul(nB, -link.thickness));
      const t = sub(goal, e);
      // `apply` mirrors first, then rotates: matches how `local` was built.
      transforms.set(r.id, { cos, sin, tx: t.x, ty: t.y, mirror: r.mirror });
      progress = true;
    }
  }
  for (const r of input.rooms.slice(1)) {
    if (!transforms.has(r.id)) {
      unplaced.push({ name: r.name, reason: problems.get(r.id) ?? 'Ligt tegen een ruimte die zelf nog niet geplaatst is.' });
    }
  }

  const placedInputs = input.rooms.filter((r) => transforms.has(r.id));

  // 2. Shift so the outside of the building starts at (0, 0).
  let pts = placedInputs.map(placedPoints);
  const all = pts.flat();
  const raw = boxOf(all);
  const shift = { x: outerWall - raw.minX, y: outerWall - raw.minY };
  pts = pts.map((ring) => ring.map((p) => add(p, shift)));

  // 3. Rooms with their walls.
  const rooms: PlacedRoom[] = placedInputs.map((r, ri) => {
    const points = pts[ri];
    const n = points.length;
    const ccw = isCcw(r);
    const heights = r.heights.length === n ? r.heights : Array(n).fill(r.heights[0] ?? 0);
    const walls: PlacedWall[] = points.map((from, i) => {
      const to = points[(i + 1) % n];
      const dir = unit(sub(to, from));
      return {
        room: ri,
        index: i,
        from,
        to,
        length: Math.hypot(to.x - from.x, to.y - from.y),
        dir,
        inward: inwardNormal(dir, ccw),
        heightFrom: heights[i],
        heightTo: heights[(i + 1) % n],
        neighbours: [],
        openings: [],
      };
    });
    for (const o of r.openings) {
      if (o.wall < 0 || o.wall >= n) continue;
      const style = openingStyle(o.name, o.sill, o.type);
      walls[o.wall].openings.push({
        name: o.name,
        door: style === 'deur' || style === 'roldeur',
        style,
        swing: o.swing ?? null,
        hinge: o.hinge ?? null,
        offset: o.offset,
        width: o.width,
        height: o.height,
        sill: o.sill,
        own: true,
      });
    }
    const c = points.reduce((s, p) => add(s, p), { x: 0, y: 0 });
    return {
      index: ri,
      id: r.id,
      name: r.name,
      points,
      heights,
      walls,
      area: Math.abs(signedArea(points)),
      volume: r.volume,
      centroid: polygonCentroid(points) ?? mul(c, 1 / n),
      shiftCorner: shiftCorner.get(r.id) ?? null,
      netWallArea: 0,
      host: null,
      floor: [points],
    };
  });
  // Rooms inside another room.
  const innerWall = new Map<number, number>();
  placedInputs.forEach((r, ri) => {
    if (!r.link?.inside) return;
    const host = placedInputs.findIndex((x) => x.id === r.link!.to);
    if (host < 0) return;
    rooms[ri].host = host;
    innerWall.set(ri, r.link.thickness);
    if (!rooms[ri].points.every((q) => pointInPolygon(q, rooms[host].points) || onEdge(q, rooms[host].points, 0.005))) {
      warnings.push(`${rooms[ri].name} steekt buiten ${rooms[host].name} uit. Controleer de afstanden.`);
    }
  });
  const related = (a: PlacedRoom, b: PlacedRoom) => a.host === b.index || b.host === a.index;

  // 4. Which walls face another room, and how thick the wall in between is.
  const maxPartition = Math.max(0.6, outerWall + 0.1, ...placedInputs.map((r) => (r.link ? r.link.thickness + 0.05 : 0)));
  for (const w of rooms.flatMap((r) => r.walls)) {
    for (const v of rooms.flatMap((r) => r.walls)) {
      if (v.room === w.room || related(rooms[w.room], rooms[v.room])) continue;
      if (dot(w.dir, v.dir) > -0.9998) continue; // not anti-parallel (within ~1°)
      const d = dot(sub(v.from, w.from), mul(w.inward, -1));
      if (d < -MM || d > maxPartition) continue;
      const s0 = dot(sub(v.from, w.from), w.dir);
      const s1 = dot(sub(v.to, w.from), w.dir);
      const from = Math.max(0, Math.min(s0, s1));
      const to = Math.min(w.length, Math.max(s0, s1));
      if (to - from < 0.01) continue;
      if (d < MM) {
        warnings.push(`${rooms[w.room].name} en ${rooms[v.room].name} overlappen of liggen zonder muur tegen elkaar.`);
      }
      w.neighbours.push({ room: v.room, wall: v.index, thickness: Math.max(0, d), from, to });
    }
  }
  for (const r of rooms) {
    if (r.host === null) continue;
    const host = rooms[r.host];
    const t = innerWall.get(r.index) ?? 0.1;
    for (const w of r.walls) {
      const mid = add(w.from, mul(w.dir, w.length / 2));
      if (onEdge(mid, host.points, 0.01)) continue; // uses the host's wall
      if (w.neighbours.length) continue;
      w.neighbours.push({ room: host.index, wall: -1, thickness: t, from: 0, to: w.length });
    }
  }
  for (const r of rooms) {
    // Overlapping rooms: a corner of one room inside another.
    for (const o of rooms) {
      if (o.index <= r.index || related(r, o)) continue;
      const inside = r.points.some((p) => pointInPolygon(p, o.points, -0.005)) || o.points.some((p) => pointInPolygon(p, r.points, -0.005));
      if (inside) warnings.push(`${r.name} en ${o.name} overlappen elkaar. Controleer de koppeling en de muurdikte.`);
    }
  }

  // 5. Openings in a wall between two rooms show up on both sides.
  const openings: PlanOpening[] = [];
  for (const w of rooms.flatMap((r) => r.walls)) {
    for (const o of w.openings.filter((x) => x.own)) {
      const mid = o.offset + o.width / 2;
      const nb = w.neighbours.find((x) => mid >= x.from - MM && mid <= x.to + MM);
      const a = add(w.from, mul(w.dir, o.offset));
      const b = add(w.from, mul(w.dir, o.offset + o.width));
      const swing = o.swing === 'buiten' ? 'buiten' : 'binnen';
      openings.push({
        name: o.name,
        door: o.door,
        style: o.style,
        swing,
        hingeAt: hingeEnd(a, b, swing === 'binnen' ? w.inward : mul(w.inward, -1), o.hinge ?? null),
        room: w.room,
        wall: w.index,
        a,
        b,
        inward: w.inward,
        thickness: nb ? nb.thickness : outerWall,
        exterior: !nb,
        width: o.width,
        height: o.height,
        sill: o.sill,
      });
      if (!nb) continue;
      const v = rooms[nb.room].walls[nb.wall];
      if (!v) continue; // a free-standing wall inside a room: the room's side is counted below
      const pa = add(a, mul(w.inward, -nb.thickness));
      const pb = add(b, mul(w.inward, -nb.thickness));
      const sa = dot(sub(pa, v.from), v.dir);
      const sb = dot(sub(pb, v.from), v.dir);
      v.openings.push({ ...o, offset: Math.min(sa, sb), own: false });
    }
  }
  for (const r of rooms) {
    let gross = 0;
    let holes = 0;
    for (const w of r.walls) {
      gross += (w.length * (w.heightFrom + w.heightTo)) / 2;
      holes += w.openings.reduce((s, o) => s + o.width * o.height, 0);
    }
    r.netWallArea = Math.max(0, gross - holes);
  }
  // A room inside another: its own walls add wall area on the other room's side, and take floor away.
  const carved = new Map<number, ClipPolygon[]>();
  for (const r of rooms) {
    if (r.host === null) continue;
    const host = rooms[r.host];
    const t = innerWall.get(r.index) ?? 0.1;
    const grown = grow(r.points, t);
    const hostHeight = host.heights.reduce((a, b) => a + b, 0) / host.heights.length;
    let extra = 0;
    r.walls.forEach((w, i) => {
      if (!w.neighbours.some((nb) => nb.wall === -1)) return;
      const len = segmentInside(grown[i], grown[(i + 1) % grown.length], host.points);
      extra += len * hostHeight - w.openings.reduce((a, o) => a + o.width * o.height, 0);
    });
    host.netWallArea += Math.max(0, extra);
    carved.set(host.index, [...(carved.get(host.index) ?? []), [toRing(grown)]]);
  }
  for (const [hi, pieces] of carved) {
    const host = rooms[hi];
    const before = host.area;
    const rest = difference([[toRing(host.points)]], ...pieces);
    host.floor = rest.flatMap((poly) => poly.map(fromRing));
    host.area = rest.reduce((a, poly) => a + Math.abs(signedArea(fromRing(poly[0]))) - poly.slice(1).reduce((h, ring) => h + Math.abs(signedArea(fromRing(ring))), 0), 0);
    if (host.volume !== null) {
      const avg = host.heights.reduce((a, b) => a + b, 0) / host.heights.length;
      host.volume = Math.max(0, host.volume - (before - host.area) * avg);
    }
  }
  for (const r of rooms) r.centroid = labelPoint(r.floor) ?? r.centroid;

  // 6. Outline of the building: every room grown by the outer wall, plus the walls in between.
  const pieces: ClipPolygon[] = rooms.map((r) => [toRing(grow(r.points, outerWall))]);
  for (const w of rooms.flatMap((r) => r.walls)) {
    for (const nb of w.neighbours) {
      // Walls up to twice the outer wall are already closed by the grown rooms on both sides.
      if (nb.thickness < MM || nb.thickness <= 2 * outerWall - 1e-6) continue;
      const p0 = add(w.from, mul(w.dir, nb.from));
      const p1 = add(w.from, mul(w.dir, nb.to));
      const out = mul(w.inward, -nb.thickness);
      // Slightly wider than the gap so the union closes it without slivers.
      const e = mul(w.inward, 1e-3);
      pieces.push([toRing([add(p0, e), add(p1, e), add(add(p1, out), mul(e, -1)), add(add(p0, out), mul(e, -1))])]);
    }
  }
  const union: MultiPolygon = unionAll(...pieces);
  const footprint = union.map((poly) => poly.map(fromRing)).filter((poly) => poly[0] && poly[0].length >= 3);
  const roomsUnion = unionAll(...rooms.flatMap((r) => (r.host === null && !carved.has(r.index) ? [[toRing(r.points)] as ClipPolygon] : [])), ...rooms.filter((r) => r.host !== null || carved.has(r.index)).flatMap((r) => evenOddPolygons(r.floor)));
  const walled = roomsUnion.length ? difference(union, roomsUnion) : union;
  const wallRings = walled.flatMap((poly) => poly.map(fromRing));

  const outer = boxOf(footprint.flatMap((poly) => poly[0]));
  const inner = boxOf(rooms.flatMap((r) => r.points));
  const grossArea = footprint.reduce((s, poly) => s + Math.abs(signedArea(poly[0])) - poly.slice(1).reduce((h, ring) => h + Math.abs(signedArea(ring)), 0), 0);
  const netArea = rooms.reduce((s, r) => s + r.area, 0);
  const volume = rooms.every((r) => r.volume !== null) ? rooms.reduce((s, r) => s + (r.volume ?? 0), 0) : null;
  let partitionLength = 0;
  for (const w of rooms.flatMap((r) => r.walls)) {
    for (const nb of w.neighbours) if (nb.room > w.room || nb.wall === -1) partitionLength += nb.to - nb.from;
  }

  const width = check(input.measuredWidth, inner.maxX - inner.minX, outerWall);
  const depth = check(input.measuredDepth, inner.maxY - inner.minY, outerWall);

  // 7. Holes in the floor.
  const voids: PlacedVoid[] = [];
  for (const v of input.voids ?? []) {
    const label = v.name || 'Trapgat';
    const room = rooms.find((r) => r.id === v.room);
    if (!room) {
      warnings.push(`${label}: kies de ruimte waarin het ligt.`);
      continue;
    }
    const w = room.walls[v.wall];
    if (!w) {
      warnings.push(`${label}: kies de wand van ${room.name} waar je vanaf meet.`);
      continue;
    }
    if (!(v.width > 0) || !(v.length > 0)) {
      warnings.push(`${label}: breedte en lengte moeten groter zijn dan 0.`);
      continue;
    }
    const a = add(add(w.from, mul(w.dir, v.offset)), mul(w.inward, v.distance));
    const points = [a, add(a, mul(w.dir, v.width)), add(add(a, mul(w.dir, v.width)), mul(w.inward, v.length)), add(a, mul(w.inward, v.length))];
    if (!points.every((q) => pointInPolygon(q, room.points) || onEdge(q, room.points))) {
      warnings.push(`${label} valt (deels) buiten ${room.name}. Controleer de afstanden en de maat.`);
    }
    voids.push({ name: label, room: room.index, points, area: v.width * v.length });
  }
  const voidArea = voids.reduce((s, v) => s + v.area, 0);

  // 8. Roofs, each over its rooms (or the whole floor).
  const roofInputs = input.roofs ?? (input.roof ? [input.roof] : []);
  const roofs: PlacedRoof[] = [];
  const roomRoof: (number | null)[] = rooms.map(() => null);
  for (const r of roofInputs) {
    if (!rooms.length) break;
    const wanted = r.rooms && r.rooms.length ? rooms.filter((x) => r.rooms!.includes(x.id)) : rooms;
    if (wanted.length === 0) {
      warnings.push(`${r.name || 'Kap'}: kies over welke ruimtes de kap ligt.`);
      continue;
    }
    const box = boxOf(wanted.flatMap((x) => x.points));
    const region = { minX: box.minX - outerWall, maxX: box.maxX + outerWall, minY: box.minY - outerWall, maxY: box.maxY + outerWall };
    const placed = placeRoof(r, region, wanted.map((x) => x.index), warnings);
    for (const x of wanted) {
      if (roomRoof[x.index] !== null) warnings.push(`${x.name} ligt onder twee kappen; de eerste telt.`);
      else roomRoof[x.index] = roofs.length;
    }
    if (Math.abs(placed.spanDiff) > 0.02) {
      const across = r.ridge === 'x' ? 'diepte' : 'breedte';
      warnings.push(
        `De overspanning van ${placed.name === 'Kap' ? 'de kap' : `"${placed.name}"`} (${fmt(r.section.span)}) wijkt ${fmtMm(placed.spanDiff)} af van de ${across} eronder (${fmt(r.section.span + placed.spanDiff)}). De kap staat in het midden.`,
      );
    }
    roofs.push(placed);
  }
  // A room inside another is under the same roof.
  for (const r of rooms) if (r.host !== null && roomRoof[r.index] === null) roomRoof[r.index] = roomRoof[r.host];

  return {
    rooms,
    unplaced,
    openings,
    outerWall,
    footprint,
    wallRings,
    outer,
    inner,
    width,
    depth,
    netArea,
    grossArea,
    volume,
    partitionLength,
    voids,
    voidArea,
    roofs,
    roof: roofs[0] ?? null,
    roomRoof,
    flatThickness: input.flatThickness ?? 0.3,
    warnings: [...new Set(warnings)],
  };
}

/** Kind of opening: as chosen, or guessed from its name and sill. */
export function openingStyle(name: string, sill: number, type?: OpeningStyle | null): OpeningStyle {
  if (type) return type;
  if (/rol|overhead|sectiona|garage/i.test(name)) return 'roldeur';
  // A sliding glass door (schuifpui) is drawn as glass, without a swing.
  if (/pui|schuif/i.test(name)) return 'schuif';
  if (/deur|door|poort/i.test(name)) return 'deur';
  if (/raam|venster|window|kozijn/i.test(name)) return 'raam';
  return sill < 0.05 ? 'deur' : 'raam';
}

/**
 * End of a door opening a–b with the hinges. DIN left/right is seen from the side the door opens
 * towards: standing there and facing the door, the hinges are on your left or right hand.
 */
export function hingeEnd(a: Point, b: Point, opensTowards: Point, hinge: 'links' | 'rechts' | null): 'a' | 'b' {
  if (!hinge) return 'a';
  // Facing the door from the side it opens to: you look against `opensTowards`.
  const facing = mul(opensTowards, -1);
  const left = { x: -facing.y, y: facing.x };
  const bIsLeft = dot(sub(b, a), left) > 0;
  return (hinge === 'links') === bIsLeft ? 'b' : 'a';
}

function polygonCentroid(points: Point[]): Point | null {
  const a = signedArea(points);
  if (Math.abs(a) < 1e-12) return null;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    const f = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

/** Length of segment p–q that lies inside the polygon. */
function segmentInside(p: Point, q: Point, poly: Point[]): number {
  const ts = [0, 1];
  const d = sub(q, p);
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const e = sub(poly[(i + 1) % poly.length], a);
    const den = cross(d, e);
    if (Math.abs(den) < 1e-12) continue;
    const t = cross(sub(a, p), e) / den;
    const u = cross(sub(a, p), d) / den;
    if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t);
  }
  ts.sort((x, y) => x - y);
  const len = Math.hypot(d.x, d.y);
  let inside = 0;
  for (let i = 0; i + 1 < ts.length; i++) {
    const m = add(p, mul(d, (ts[i] + ts[i + 1]) / 2));
    if (pointInPolygon(m, poly) || onEdge(m, poly, 0.002)) inside += (ts[i + 1] - ts[i]) * len;
  }
  return inside;
}

/** Even-odd rings (outer outlines and holes, any order) as polygons for the clipping library. */
function evenOddPolygons(rings: Point[][]): ClipPolygon[] {
  const outers = rings.filter((r, i) => !rings.some((o, j) => j !== i && Math.abs(signedArea(o)) > Math.abs(signedArea(r)) && pointInPolygon(r[0], o)));
  return outers.map((o) => [toRing(o), ...rings.filter((h) => h !== o && pointInPolygon(h[0], o)).map(toRing)]);
}

/** A point well inside the floor for the room's name: farthest from the edges on a grid. */
function labelPoint(rings: Point[][]): Point | null {
  const pts = rings.flat();
  if (pts.length < 3) return null;
  const box = boxOf(pts);
  const inside = (p: Point) => rings.reduce((n, r) => (pointInPolygon(p, r) ? n + 1 : n), 0) % 2 === 1;
  const edgeDist = (p: Point) => {
    let best = Infinity;
    for (const r of rings) {
      for (let i = 0; i < r.length; i++) {
        const a = r[i];
        const ab = sub(r[(i + 1) % r.length], a);
        const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / (dot(ab, ab) || 1)));
        best = Math.min(best, Math.hypot(p.x - a.x - ab.x * t, p.y - a.y - ab.y * t));
      }
    }
    return best;
  };
  // Prefer the centroid of the outline when it is well inside (rectangles, most rooms).
  const c = polygonCentroid(rings[0]);
  const w = box.maxX - box.minX;
  const h = box.maxY - box.minY;
  if (c && inside(c) && edgeDist(c) > 0.25 * Math.min(w, h)) return c;
  let best: Point | null = null;
  let bestD = -1;
  const n = 24;
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n; j++) {
      const p = { x: box.minX + (w * i) / n, y: box.minY + (h * j) / n };
      if (!inside(p)) continue;
      const d = edgeDist(p);
      if (d > bestD) {
        bestD = d;
        best = p;
      }
    }
  }
  return best;
}

function onEdge(p: Point, poly: Point[], tol = 0.002): boolean {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ab = sub(b, a);
    const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / (dot(ab, ab) || 1)));
    const q = add(a, mul(ab, t));
    if (Math.hypot(p.x - q.x, p.y - q.y) <= tol) return true;
  }
  return false;
}

/** Is p inside the polygon, at least `margin` from its edges (negative margin = strictly inside)? */
export function pointInPolygon(p: Point, poly: Point[], margin = 0): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  if (!inside || margin === 0) return inside;
  // Distance to the nearest edge must exceed |margin|.
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ab = sub(b, a);
    const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / (dot(ab, ab) || 1)));
    const q = add(a, mul(ab, t));
    if (Math.hypot(p.x - q.x, p.y - q.y) < Math.abs(margin)) return false;
  }
  return true;
}

function fmt(m: number): string {
  return m.toFixed(3).replace('.', ',') + ' m';
}

function fmtMm(m: number): string {
  return `${Math.round(Math.abs(m) * 1000)} mm`;
}

export { wallName };

/**
 * Rooms with walls, possibly different heights per corner (sloped ceiling), and doors/windows
 * placed on a wall at a measured distance from a corner. Lengths in metres.
 */
import { GeometryError, Point, PolygonAnalysis } from './geometry';

export interface OpeningInput {
  name: string;
  /** Kind, swing and hinge side of a door (only used for drawing). */
  type?: 'deur' | 'roldeur' | 'schuif' | 'raam' | null;
  swing?: 'binnen' | 'buiten' | null;
  hinge?: 'links' | 'rechts' | null;
  /** Wall index (wall i runs from corner i to corner i+1), or null when not placed on a wall. */
  wall: number | null;
  /** Distance from the wall's first corner to the near edge of the opening, along the wall. */
  offset: number | null;
  width: number;
  height: number;
  /** Height of the bottom edge above the floor (0 for a door). */
  sill: number | null;
}

export interface WallResult {
  index: number;
  from: Point;
  to: Point;
  length: number;
  /** Heights at the wall's first and second corner. */
  heightFrom: number;
  heightTo: number;
  grossArea: number;
  openingsArea: number;
  netArea: number;
  openings: OpeningInput[];
}

export interface RoomResult {
  walls: WallResult[];
  floorArea: number;
  /** True when the room is not equally high everywhere. */
  sloped: boolean;
  minHeight: number;
  maxHeight: number;
  wallArea: number;
  /** All openings, placed or not. */
  openingsArea: number;
  netWallArea: number;
  volume: number;
  /**
   * 'vlak': all corner heights lie in one plane (flat or single-slope ceiling), volume is exact.
   * 'dakvorm': several planes; the ceiling is taken as a roof (ridges highest), which is exact for
   * gable, off-centre gable and hipped shapes when every ridge end is a corner.
   */
  ceiling: 'vlak' | 'dakvorm';
  /** Ceiling area along its slope (for ceiling boards or insulation). */
  ceilingArea: number;
  /** Floor triangles used for the volume and the 3D view (indices into the corner list). */
  triangles: [number, number, number][];
}

const MM = 0.001;

/** Height of a wall's top edge at distance `at` from its first corner (straight line between the corners). */
export function wallHeightAt(wall: Pick<WallResult, 'length' | 'heightFrom' | 'heightTo'>, at: number): number {
  const t = wall.length > 0 ? Math.min(1, Math.max(0, at / wall.length)) : 0;
  return wall.heightFrom + (wall.heightTo - wall.heightFrom) * t;
}

function wallName(i: number, n: number): string {
  return `${i + 1}–${((i + 1) % n) + 1}`;
}

function fmt(m: number): string {
  return m.toFixed(3).replace('.', ',') + ' m';
}

/**
 * @param heights one height for the whole room, or one per corner.
 */
export function analyzeRoom(shape: PolygonAnalysis, heights: number[], openings: OpeningInput[] = []): RoomResult {
  const n = shape.points.length;
  if (heights.length !== 1 && heights.length !== n) {
    throw new GeometryError(`Vul één hoogte in, of een hoogte voor elk van de ${n} hoekpunten.`);
  }
  const h = heights.length === 1 ? Array(n).fill(heights[0]) : heights;
  h.forEach((v, i) => {
    if (!Number.isFinite(v) || v <= 0) throw new GeometryError(`De hoogte bij hoekpunt ${i + 1} moet groter zijn dan 0.`);
  });

  const walls: WallResult[] = shape.points.map((from, i) => {
    const to = shape.points[(i + 1) % n];
    const length = shape.sides[i];
    const grossArea = (length * (h[i] + h[(i + 1) % n])) / 2;
    return { index: i, from, to, length, heightFrom: h[i], heightTo: h[(i + 1) % n], grossArea, openingsArea: 0, netArea: grossArea, openings: [] };
  });

  let openingsArea = 0;
  for (const o of openings) {
    const label = o.name ? `"${o.name}"` : 'Een opening';
    if (!(o.width > 0) || !(o.height > 0)) throw new GeometryError(`${label}: breedte en hoogte moeten groter zijn dan 0.`);
    const area = o.width * o.height;
    openingsArea += area;
    if (o.wall === null) continue;
    if (o.wall < 0 || o.wall >= n) throw new GeometryError(`${label}: wand ${o.wall + 1} bestaat niet.`);
    const wall = walls[o.wall];
    const offset = o.offset ?? 0;
    const sill = o.sill ?? 0;
    if (offset < 0 || sill < 0) throw new GeometryError(`${label}: afstand en borstwering kunnen niet negatief zijn.`);
    if (offset + o.width > wall.length + MM) {
      throw new GeometryError(
        `${label} past niet op wand ${wallName(o.wall, n)}: ${fmt(offset)} + ${fmt(o.width)} is langer dan de wand (${fmt(wall.length)}).`,
      );
    }
    const top = sill + o.height;
    const room = Math.min(wallHeightAt(wall, offset), wallHeightAt(wall, offset + o.width));
    if (top > room + MM) {
      throw new GeometryError(`${label} is te hoog voor wand ${wallName(o.wall, n)}: bovenkant ${fmt(top)}, wand daar ${fmt(room)} hoog.`);
    }
    for (const other of wall.openings) {
      const ox = other.offset ?? 0;
      const oy = other.sill ?? 0;
      const overlapX = offset < ox + other.width - MM && ox < offset + o.width - MM;
      const overlapY = sill < oy + other.height - MM && oy < top - MM;
      if (overlapX && overlapY) {
        throw new GeometryError(`${label} overlapt met ${other.name ? `"${other.name}"` : 'een andere opening'} op wand ${wallName(o.wall, n)}.`);
      }
    }
    wall.openings.push(o);
    wall.openingsArea += area;
    wall.netArea = Math.max(0, wall.grossArea - wall.openingsArea);
  }

  const planar = isPlanar(shape.points, h);
  const triangles = planar ? triangulate(shape.points) : roofTriangulation(shape.points, h) ?? triangulate(shape.points);
  let volume = 0;
  let ceilingArea = 0;
  for (const [a, b, c] of triangles) {
    const pa = shape.points[a];
    const pb = shape.points[b];
    const pc = shape.points[c];
    const area = Math.abs((pb.x - pa.x) * (pc.y - pa.y) - (pc.x - pa.x) * (pb.y - pa.y)) / 2;
    volume += (area * (h[a] + h[b] + h[c])) / 3;
    // Area of the same triangle lifted to ceiling height.
    const u = [pb.x - pa.x, pb.y - pa.y, h[b] - h[a]];
    const v = [pc.x - pa.x, pc.y - pa.y, h[c] - h[a]];
    const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    ceilingArea += Math.hypot(cross[0], cross[1], cross[2]) / 2;
  }

  const wallArea = walls.reduce((s, w) => s + w.grossArea, 0);
  const minHeight = Math.min(...h);
  const maxHeight = Math.max(...h);
  return {
    walls,
    floorArea: shape.area,
    sloped: maxHeight - minHeight > MM,
    minHeight,
    maxHeight,
    wallArea,
    openingsArea,
    netWallArea: Math.max(0, wallArea - openingsArea),
    volume,
    ceiling: planar ? 'vlak' : 'dakvorm',
    ceilingArea,
    triangles,
  };
}

/** Do the corner heights lie in one flat plane (within a millimetre)? */
export function isPlanar(points: Point[], heights: number[]): boolean {
  const n = points.length;
  // Find three corners that are not on one line to define the plane.
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let k = j + 1; k < n; k++) {
        const [a, b, c] = [points[i], points[j], points[k]];
        const det = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
        if (Math.abs(det) < 1e-9) continue;
        // Plane h = p + q x + r y through the three corners (Cramer's rule).
        const q = ((heights[j] - heights[i]) * (c.y - a.y) - (heights[k] - heights[i]) * (b.y - a.y)) / det;
        const r = ((b.x - a.x) * (heights[k] - heights[i]) - (c.x - a.x) * (heights[j] - heights[i])) / det;
        const p = heights[i] - q * a.x - r * a.y;
        return points.every((pt, m) => Math.abs(p + q * pt.x + r * pt.y - heights[m]) < MM);
      }
    }
  }
  return true;
}

/**
 * Triangulation that gives the largest volume under the corner heights. For a roof-shaped ceiling
 * (highest along the ridge, sloping down to the eaves) that is exactly the roof: any other choice
 * would cut under the ridge. Dynamic programming over valid diagonals, O(n³); n is small here.
 * Returns null when no valid triangulation is found (self-intersecting input).
 */
export function roofTriangulation(points: Point[], heights: number[]): [number, number, number][] | null {
  const n = points.length;
  let signed = 0;
  for (let i = 0; i < n; i++) signed += points[i].x * points[(i + 1) % n].y - points[(i + 1) % n].x * points[i].y;
  const orient = Math.sign(signed) || 1;

  const valid: boolean[][] = Array.from({ length: n }, () => Array(n).fill(false));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      valid[i][j] = valid[j][i] = j === i + 1 || (i === 0 && j === n - 1) || isDiagonal(points, i, j);
    }
  }

  const NEG = -Infinity;
  const best: number[][] = Array.from({ length: n }, () => Array(n).fill(NEG));
  const pick: number[][] = Array.from({ length: n }, () => Array(n).fill(-1));
  for (let i = 0; i < n - 1; i++) best[i][i + 1] = 0;
  for (let gap = 2; gap < n; gap++) {
    for (let i = 0; i + gap < n; i++) {
      const j = i + gap;
      if (!valid[i][j]) continue;
      for (let k = i + 1; k < j; k++) {
        if (best[i][k] === NEG || best[k][j] === NEG) continue;
        const [a, b, c] = [points[i], points[k], points[j]];
        const twice = ((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) * orient;
        if (twice <= 1e-12) continue;
        const v = best[i][k] + best[k][j] + ((twice / 2) * (heights[i] + heights[k] + heights[j])) / 3;
        if (v > best[i][j] + 1e-12) {
          best[i][j] = v;
          pick[i][j] = k;
        }
      }
    }
  }
  if (best[0][n - 1] === NEG) return null;
  const out: [number, number, number][] = [];
  const collect = (i: number, j: number) => {
    if (j - i < 2) return;
    const k = pick[i][j];
    out.push([i, k, j]);
    collect(i, k);
    collect(k, j);
  };
  collect(0, n - 1);
  return out;
}

/** Is the segment between corners i and j a diagonal inside the polygon (touching nothing else)? */
function isDiagonal(points: Point[], i: number, j: number): boolean {
  const n = points.length;
  const a = points[i];
  const b = points[j];
  const cross = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const onSegment = (p: Point, q: Point, r: Point) =>
    Math.abs(cross(p, q, r)) <= 1e-12 &&
    r.x >= Math.min(p.x, q.x) - 1e-12 && r.x <= Math.max(p.x, q.x) + 1e-12 &&
    r.y >= Math.min(p.y, q.y) - 1e-12 && r.y <= Math.max(p.y, q.y) + 1e-12;
  for (let k = 0; k < n; k++) {
    if (k !== i && k !== j && onSegment(a, b, points[k])) return false; // runs through another corner
    const k2 = (k + 1) % n;
    if (k === i || k === j || k2 === i || k2 === j) continue;
    const c = points[k];
    const d = points[k2];
    const d1 = cross(a, b, c);
    const d2 = cross(a, b, d);
    const d3 = cross(c, d, a);
    const d4 = cross(c, d, b);
    if (((d1 > 1e-12 && d2 < -1e-12) || (d1 < -1e-12 && d2 > 1e-12)) && ((d3 > 1e-12 && d4 < -1e-12) || (d3 < -1e-12 && d4 > 1e-12))) return false;
  }
  // The midpoint must lie inside (ray casting).
  const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  let inside = false;
  for (let k = 0, l = n - 1; k < n; l = k++) {
    const p = points[k];
    const q = points[l];
    if (p.y > m.y !== q.y > m.y && m.x < ((q.x - p.x) * (m.y - p.y)) / (q.y - p.y) + p.x) inside = !inside;
  }
  return inside;
}

/** Ear clipping for a simple polygon (convex or not, either orientation). */
export function triangulate(points: Point[]): [number, number, number][] {
  const n = points.length;
  if (n < 3) return [];
  let area = 0;
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const q = points[(i + 1) % n];
    area += p.x * q.y - q.x * p.y;
  }
  const ccw = area > 0;
  const idx = Array.from({ length: n }, (_, i) => i);
  const out: [number, number, number][] = [];
  const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const inside = (p: Point, a: Point, b: Point, c: Point) => {
    const d1 = cross(a, b, p);
    const d2 = cross(b, c, p);
    const d3 = cross(c, a, p);
    const hasNeg = d1 < -1e-12 || d2 < -1e-12 || d3 < -1e-12;
    const hasPos = d1 > 1e-12 || d2 > 1e-12 || d3 > 1e-12;
    return !(hasNeg && hasPos);
  };

  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i - 1 + idx.length) % idx.length];
      const ib = idx[i];
      const ic = idx[(i + 1) % idx.length];
      const [a, b, c] = [points[ia], points[ib], points[ic]];
      const turn = cross(a, b, c);
      if (ccw ? turn <= 1e-12 : turn >= -1e-12) continue; // reflex or straight: not an ear
      const blocked = idx.some((j) => j !== ia && j !== ib && j !== ic && inside(points[j], a, b, c));
      if (blocked) continue;
      out.push([ia, ib, ic]);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) {
      // Only straight (180°) corners left to remove: drop one without adding area.
      const straight = idx.findIndex((ib, i) => {
        const ia = idx[(i - 1 + idx.length) % idx.length];
        const ic = idx[(i + 1) % idx.length];
        return Math.abs(cross(points[ia], points[ib], points[ic])) <= 1e-12;
      });
      if (straight < 0) break;
      idx.splice(straight, 1);
    }
  }
  if (idx.length === 3) out.push([idx[0], idx[1], idx[2]]);
  return out;
}

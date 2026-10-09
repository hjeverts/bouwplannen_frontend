/**
 * Roofs placed on a floor: over all rooms or over some (an extension with its own roof), with
 * dormers (dakkapellen) and roof windows (dakramen) on their roof planes.
 *
 * A roof section (from the Dak & spant item) gives the underside of the roof across the ridge.
 * In plan, `c` is the coordinate across the ridge (y for a ridge along x, x for a ridge along y)
 * and `v` the coordinate along the ridge. Heights are from this floor.
 */
import { Point, RoofResult } from './geometry';

export interface P3 {
  x: number;
  y: number;
  z: number;
}

export interface DormerInput {
  name: string;
  /** Roof plane (index into the planes of the roof). */
  plane: number;
  /** Along the ridge, from the outside of the building at the start (left or front) to the dormer. */
  offset: number;
  width: number;
  /** Height of the front face, from where it meets the roof to the top. */
  frontHeight: number;
  /** Horizontal distance from the wall plate (eaves side of the plane) to the front face. */
  setback: number;
  /** Window in the front face, centred; null for none. */
  windowWidth: number | null;
  windowHeight: number | null;
}

export interface RoofWindowInput {
  name: string;
  plane: number;
  /** Along the ridge, from the outside of the building at the start to the window. */
  offset: number;
  /** Along the slope, from the lower edge of the plane (wall plate or knee) to the window. */
  up: number;
  width: number;
  /** Along the slope. */
  length: number;
}

export interface PlanRoofInput {
  /** Passed through to the placed roof, to find it back (e.g. the entry index). */
  key?: string;
  name?: string;
  section: RoofResult;
  /** Ridge parallel to the x axis (front facade) or the y axis. */
  ridge: 'x' | 'y';
  /** Put the roof's left side at the back (ridge x) or the right (ridge y) instead. */
  flip: boolean;
  /** Height of the wall plates above the floor, for roofs measured without wall heights. */
  plateHeight: number;
  overhang: number;
  gableOverhang: number;
  /** Roof length as entered on the roof, to compare with the building. */
  length: number | null;
  /** Ids of the rooms under this roof; empty = the whole floor. */
  rooms?: string[];
  dormers?: DormerInput[];
  windows?: RoofWindowInput[];
}

export interface ProfilePoint {
  /** Plan coordinate across the ridge (y for a ridge along x, x for a ridge along y). */
  c: number;
  z: number;
}

export interface RoofPlane {
  index: number;
  /** "voor", "achter", "links", "rechts", with "onder"/"boven" for a mansard roof. */
  label: string;
  lower: ProfilePoint;
  upper: ProfilePoint;
}

export interface PlacedDormer {
  name: string;
  plane: number;
  front: P3[];
  cheeks: [P3[], P3[]];
  top: P3[];
  window: P3[] | null;
  /** Horizontal unit vector the front faces (in plan). */
  facing: Point;
  /** Outline in plan, for the drawing. */
  outline: Point[];
  topHeight: number;
}

export interface PlacedRoofWindow {
  name: string;
  plane: number;
  pts: P3[];
  outline: Point[];
}

export interface PlacedRoof {
  key: string;
  name: string;
  section: RoofResult;
  ridge: 'x' | 'y';
  /** Indices of the rooms under this roof. */
  rooms: number[];
  /** Underside of the roof from wall plate to wall plate, increasing c. */
  profile: ProfilePoint[];
  /** Same, with the first and last point moved out by the overhang at the eaves (same slopes). */
  eaves: ProfilePoint[];
  planes: RoofPlane[];
  /** Extent along the ridge, including the overhang at the gables. */
  from: number;
  to: number;
  /** Extent of the building under it along the ridge (outside of the walls). */
  vMin: number;
  vMax: number;
  ridgeHeight: number;
  /** Building width across the ridge (outside of the walls) minus the roof span. */
  spanDiff: number;
  /** Building length along the ridge minus the roof length (when entered). */
  lengthDiff: number | null;
  dormers: PlacedDormer[];
  windows: PlacedRoofWindow[];
  /** Height of the roof underside at plan coordinate c across the ridge. */
  heightAt: (c: number) => number;
}

export interface Region {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Underside of the roof section as (across, height) points from wall plate to wall plate. */
export function roofProfile(section: RoofResult, plateHeight: number): { u: number; z: number }[] {
  const base = section.fromFloor ? 0 : plateHeight;
  let top: Point[];
  if (section.type === 'mansardekap') top = section.outline;
  else if (section.fromFloor) top = section.outline.slice(1, -1);
  else if (section.type === 'lessenaarsdak') top = section.outline.slice(0, 2);
  else top = section.outline;
  return top.map((p) => ({ u: p.x, z: p.y + base }));
}

function planeLabels(profile: ProfilePoint[], ridge: 'x' | 'y'): RoofPlane[] {
  const planes: RoofPlane[] = [];
  const n = profile.length - 1;
  for (let i = 0; i < n; i++) {
    const a = profile[i];
    const b = profile[i + 1];
    const [lower, upper] = a.z <= b.z ? [a, b] : [b, a];
    // The plane faces the side of its lower edge.
    const towardsSmall = lower.c < upper.c;
    let label = ridge === 'x' ? (towardsSmall ? 'voor' : 'achter') : towardsSmall ? 'links' : 'rechts';
    if (n === 4) label = `${i === 0 || i === n - 1 ? 'onder' : 'boven'} ${label}`;
    planes.push({ index: i, label, lower, upper });
  }
  return planes;
}

const fmt = (m: number) => m.toFixed(3).replace('.', ',') + ' m';

/**
 * Place a roof centred across the region (outside of the walls of the rooms it covers),
 * along the ridge over the full length of the region plus the gable overhang.
 */
export function placeRoof(input: PlanRoofInput, region: Region, rooms: number[], warnings: string[]): PlacedRoof {
  const { section, ridge, flip } = input;
  const name = input.name || 'Kap';
  const [cMin, cMax] = ridge === 'x' ? [region.minY, region.maxY] : [region.minX, region.maxX];
  const [vMin, vMax] = ridge === 'x' ? [region.minX, region.maxX] : [region.minY, region.maxY];
  const centre = (cMin + cMax) / 2;
  const start = centre - section.span / 2;
  let profile = roofProfile(section, input.plateHeight).map((p) => ({ c: flip ? start + section.span - p.u : start + p.u, z: p.z }));
  if (flip) profile = profile.reverse();

  const extend = (p: ProfilePoint, q: ProfilePoint, by: number): ProfilePoint => {
    // From p away from q, by a horizontal distance `by`, following the slope p–q.
    const dc = p.c - q.c;
    const slope = (p.z - q.z) / (dc || 1);
    const step = Math.sign(dc) * by;
    return { c: p.c + step, z: p.z + slope * step };
  };
  const o = Math.max(0, input.overhang);
  const eaves =
    o > 0 && profile.length >= 2
      ? [extend(profile[0], profile[1], o), ...profile.slice(1, -1), extend(profile[profile.length - 1], profile[profile.length - 2], o)]
      : profile;

  const heightAt = (c: number): number => {
    if (c <= profile[0].c) return profile[0].z;
    for (let i = 1; i < profile.length; i++) {
      const p = profile[i - 1];
      const q = profile[i];
      if (c <= q.c) return p.z + ((q.z - p.z) * (c - p.c)) / (q.c - p.c || 1);
    }
    return profile[profile.length - 1].z;
  };
  const planes = planeLabels(profile, ridge);
  const toPlan = (c: number, v: number): Point => (ridge === 'x' ? { x: v, y: c } : { x: c, y: v });
  const at = (c: number, v: number, z: number): P3 => ({ ...toPlan(c, v), z });

  const dormers: PlacedDormer[] = [];
  for (const d of input.dormers ?? []) {
    const label = `${name}, ${d.name || 'dakkapel'}`;
    const plane = planes[d.plane];
    if (!plane) {
      warnings.push(`${label}: kies het dakvlak.`);
      continue;
    }
    if (!(d.width > 0) || !(d.frontHeight > 0)) {
      warnings.push(`${label}: breedte en hoogte moeten groter zijn dan 0.`);
      continue;
    }
    const { lower, upper } = plane;
    const run = Math.abs(upper.c - lower.c);
    const dir = Math.sign(upper.c - lower.c) || 1;
    const slope = (upper.z - lower.z) / (run || 1);
    const setback = Math.max(0, d.setback);
    if (setback >= run) {
      warnings.push(`${label}: ligt verder dan het dakvlak breed is (${fmt(run)}).`);
      continue;
    }
    const cF = lower.c + dir * setback;
    const zF = lower.z + slope * setback;
    const zT = zF + d.frontHeight;
    let back = slope > 0 ? (zT - lower.z) / slope : run;
    if (back > run + 1e-9) {
      warnings.push(`${label}: komt boven ${planes.length === 4 ? 'de knik' : 'de nok'} uit; de bovenkant is afgekapt.`);
      back = run;
    }
    const cB = lower.c + dir * back;
    const zTop = Math.min(zT, lower.z + slope * back);
    const v0 = vMin + d.offset;
    const v1 = v0 + d.width;
    if (v0 < vMin - 1e-6 || v1 > vMax + 1e-6) warnings.push(`${label}: valt (deels) buiten de lengte van het gebouw.`);
    let window: P3[] | null = null;
    if (d.windowWidth && d.windowHeight && d.windowWidth > 0 && d.windowHeight > 0) {
      if (d.windowWidth > d.width + 1e-6 || d.windowHeight > d.frontHeight + 1e-6) {
        warnings.push(`${label}: het raam is groter dan de voorkant.`);
      } else {
        const wv0 = (v0 + v1) / 2 - d.windowWidth / 2;
        const wz0 = zF + (d.frontHeight - d.windowHeight) / 2;
        window = [at(cF, wv0, wz0), at(cF, wv0 + d.windowWidth, wz0), at(cF, wv0 + d.windowWidth, wz0 + d.windowHeight), at(cF, wv0, wz0 + d.windowHeight)];
      }
    }
    const facingC = -dir;
    dormers.push({
      name: d.name || 'dakkapel',
      plane: d.plane,
      front: [at(cF, v0, zF), at(cF, v1, zF), at(cF, v1, zTop), at(cF, v0, zTop)],
      cheeks: [
        [at(cF, v0, zF), at(cF, v0, zTop), at(cB, v0, zTop)],
        [at(cF, v1, zF), at(cB, v1, zTop), at(cF, v1, zTop)],
      ],
      top: [at(cF, v0, zTop), at(cF, v1, zTop), at(cB, v1, zTop), at(cB, v0, zTop)],
      window,
      facing: ridge === 'x' ? { x: 0, y: facingC } : { x: facingC, y: 0 },
      outline: [toPlan(cF, v0), toPlan(cF, v1), toPlan(cB, v1), toPlan(cB, v0)],
      topHeight: zTop,
    });
  }

  const windows: PlacedRoofWindow[] = [];
  for (const w of input.windows ?? []) {
    const label = `${name}, ${w.name || 'dakraam'}`;
    const plane = planes[w.plane];
    if (!plane) {
      warnings.push(`${label}: kies het dakvlak.`);
      continue;
    }
    if (!(w.width > 0) || !(w.length > 0)) {
      warnings.push(`${label}: breedte en lengte moeten groter zijn dan 0.`);
      continue;
    }
    const { lower, upper } = plane;
    const L = Math.hypot(upper.c - lower.c, upper.z - lower.z);
    const t0 = Math.max(0, w.up) / L;
    const t1 = (Math.max(0, w.up) + w.length) / L;
    if (t1 > 1 + 1e-9) warnings.push(`${label}: past niet op het dakvlak (${fmt(L)} langs de helling).`);
    const lerp = (t: number) => ({ c: lower.c + (upper.c - lower.c) * Math.min(1, t), z: lower.z + (upper.z - lower.z) * Math.min(1, t) });
    const a = lerp(t0);
    const b = lerp(t1);
    const v0 = vMin + w.offset;
    const v1 = v0 + w.width;
    if (v0 < vMin - 1e-6 || v1 > vMax + 1e-6) warnings.push(`${label}: valt (deels) buiten de lengte van het gebouw.`);
    windows.push({
      name: w.name || 'dakraam',
      plane: w.plane,
      pts: [at(a.c, v0, a.z), at(a.c, v1, a.z), at(b.c, v1, b.z), at(b.c, v0, b.z)],
      outline: [toPlan(a.c, v0), toPlan(a.c, v1), toPlan(b.c, v1), toPlan(b.c, v0)],
    });
  }

  const g = Math.max(0, input.gableOverhang);
  return {
    key: input.key ?? '',
    name,
    section,
    ridge,
    rooms,
    profile,
    eaves,
    planes,
    from: vMin - g,
    to: vMax + g,
    vMin,
    vMax,
    ridgeHeight: Math.max(...profile.map((p) => p.z)),
    spanDiff: cMax - cMin - section.span,
    lengthDiff: input.length === null ? null : vMax - vMin - input.length,
    dormers,
    windows,
    heightAt,
  };
}

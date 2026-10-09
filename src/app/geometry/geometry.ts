/**
 * Pure geometry for on-site measuring. All lengths are in metres, all angles in degrees.
 * No Angular dependencies, so this file can be unit-tested and reused (e.g. ported to the backend).
 */

export interface Point {
  x: number;
  y: number;
}

export class GeometryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeometryError';
  }
}

const RAD = Math.PI / 180;
/** Relative tolerance for "these measurements just about close a triangle". */
const EPS = 1e-9;

export const toRad = (deg: number): number => deg * RAD;
export const toDeg = (rad: number): number => rad / RAD;

function requirePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new GeometryError(`${label} moet groter zijn dan 0.`);
  }
}

function requireAngle(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0 || value >= 180) {
    throw new GeometryError(`${label} moet tussen 0° en 180° liggen.`);
  }
}

/** Clamp a cosine into [-1, 1] to absorb floating point noise from measurements that just close. */
function clampCos(value: number): number {
  return Math.min(1, Math.max(-1, value));
}

function checkTriangleInequality(a: number, b: number, c: number): void {
  const [x, y, z] = [a, b, c].sort((p, q) => p - q);
  const slack = (x + y - z) / z;
  if (slack < -1e-6) {
    throw new GeometryError(
      `Met deze maten kun je geen driehoek maken: ${fmt(x)} + ${fmt(y)} is korter dan ${fmt(z)}. Controleer of je dezelfde punten hebt gemeten.`,
    );
  }
}

function fmt(n: number): string {
  return n.toFixed(3).replace('.', ',') + ' m';
}

/**
 * Angle (degrees) between sides a and b, i.e. the angle opposite side c (law of cosines).
 */
export function angleFromSides(a: number, b: number, c: number): number {
  requirePositive(a, 'Zijde a');
  requirePositive(b, 'Zijde b');
  requirePositive(c, 'Zijde c');
  checkTriangleInequality(a, b, c);
  return toDeg(Math.acos(clampCos((a * a + b * b - c * c) / (2 * a * b))));
}

/**
 * The "three-point method" for a corner: measure distance a from the corner along wall 1,
 * distance b from the corner along wall 2, and the distance c between those two marks.
 */
export interface CornerResult {
  angle: number;
  /** Deviation from 90°: positive = wider than square. */
  deviationFromSquare: number;
  /** The c you would have measured if the corner were exactly 90°. */
  squareDiagonal: number;
  /** Offset at the end of wall 2 (over length b) caused by the deviation. */
  offsetOverB: number;
}

export function cornerAngle(a: number, b: number, c: number): CornerResult {
  const angle = angleFromSides(a, b, c);
  const deviation = angle - 90;
  return {
    angle,
    deviationFromSquare: deviation,
    squareDiagonal: Math.hypot(a, b),
    offsetOverB: b * Math.sin(toRad(deviation)),
  };
}

/** Third side from two sides and the angle between them (SAS). */
export function sideFromAngle(a: number, b: number, angleDeg: number): number {
  requirePositive(a, 'Zijde a');
  requirePositive(b, 'Zijde b');
  requireAngle(angleDeg, 'De hoek');
  return Math.sqrt(Math.max(0, a * a + b * b - 2 * a * b * Math.cos(toRad(angleDeg))));
}

// ---------------------------------------------------------------------------
// General triangle solver
// ---------------------------------------------------------------------------

/** Sides a, b, c lie opposite angles A, B, C. Unknown values are undefined/null. */
export interface TriangleInput {
  a?: number | null;
  b?: number | null;
  c?: number | null;
  A?: number | null;
  B?: number | null;
  C?: number | null;
}

export interface Triangle {
  a: number;
  b: number;
  c: number;
  A: number;
  B: number;
  C: number;
  area: number;
  perimeter: number;
  /** Heights onto side a, b, c. */
  ha: number;
  hb: number;
  hc: number;
}

const has = (v: number | null | undefined): v is number => v !== null && v !== undefined && Number.isFinite(v);

function complete(a: number, b: number, c: number): Triangle {
  checkTriangleInequality(a, b, c);
  const A = toDeg(Math.acos(clampCos((b * b + c * c - a * a) / (2 * b * c))));
  const B = toDeg(Math.acos(clampCos((a * a + c * c - b * b) / (2 * a * c))));
  const C = 180 - A - B;
  const s = (a + b + c) / 2;
  const area = Math.sqrt(Math.max(0, s * (s - a) * (s - b) * (s - c)));
  return { a, b, c, A, B, C, area, perimeter: a + b + c, ha: (2 * area) / a, hb: (2 * area) / b, hc: (2 * area) / c };
}

/**
 * Solve a triangle from any three independent values (at least one side).
 * Returns one solution, two for the ambiguous SSA case, or throws when the input is impossible.
 */
export function solveTriangle(input: TriangleInput): Triangle[] {
  const sides = [input.a, input.b, input.c];
  const angles = [input.A, input.B, input.C];
  sides.forEach((s, i) => has(s) && requirePositive(s, `Zijde ${'abc'[i]}`));
  angles.forEach((ang, i) => has(ang) && requireAngle(ang, `Hoek ${'ABC'[i]}`));

  const nSides = sides.filter(has).length;
  const nAngles = angles.filter(has).length;
  if (nSides === 0) throw new GeometryError('Vul minstens één zijde in; met alleen hoeken ligt de grootte niet vast.');
  if (nSides + nAngles < 3) throw new GeometryError('Vul drie waarden in (minstens één zijde).');
  if (nSides + nAngles > 3) throw new GeometryError('Vul precies drie waarden in; laat de rest leeg.');

  // SSS
  if (nSides === 3) return [complete(input.a!, input.b!, input.c!)];

  // Work on index-based arrays: side i is opposite angle i.
  const s = sides.map((v) => (has(v) ? v : null));
  const g = angles.map((v) => (has(v) ? v : null));

  if (nAngles >= 2) {
    // AAS / ASA: third angle follows, then law of sines.
    const known = g.filter((v): v is number => v !== null);
    const sum = known.reduce((p, q) => p + q, 0);
    if (sum >= 180) throw new GeometryError('De hoeken samen zijn 180° of meer; dat kan niet in een driehoek.');
    const full = g.map((v) => (v === null ? 180 - sum : v));
    const i = s.findIndex((v) => v !== null);
    const k = s[i]! / Math.sin(toRad(full[i]));
    const [a, b, c] = full.map((ang) => k * Math.sin(toRad(ang)));
    return [complete(a, b, c)];
  }

  // Two sides, one angle.
  const angleIdx = g.findIndex((v) => v !== null);
  const angle = g[angleIdx]!;
  if (s[angleIdx] === null) {
    // SAS: the angle is between the two known sides.
    const [p, q] = s.filter((v): v is number => v !== null);
    const third = sideFromAngle(p, q, angle);
    const full = [...s];
    full[angleIdx] = third;
    return [complete(full[0]!, full[1]!, full[2]!)];
  }

  // SSA: known side opposite the known angle, plus one other side.
  const opposite = s[angleIdx]!;
  const otherIdx = s.findIndex((v, idx) => v !== null && idx !== angleIdx);
  const other = s[otherIdx]!;
  const sinOther = (other * Math.sin(toRad(angle))) / opposite;
  if (sinOther > 1 + EPS) throw new GeometryError('Met deze zijden en hoek kun je geen driehoek maken.');
  // sin = 1 (within rounding) means exactly one, right-angled, solution.
  const base = toDeg(Math.asin(Math.min(1, sinOther)));
  const candidates = Math.abs(sinOther - 1) < 1e-9 ? [90] : [base, 180 - base];

  const results: Triangle[] = [];
  for (const otherAngle of candidates) {
    const third = 180 - angle - otherAngle;
    if (third <= 1e-9) continue;
    const thirdIdx = 3 - angleIdx - otherIdx;
    const full = [...s];
    full[thirdIdx] = (opposite / Math.sin(toRad(angle))) * Math.sin(toRad(third));
    results.push(complete(full[0]!, full[1]!, full[2]!));
  }
  if (results.length === 0) throw new GeometryError('Met deze zijden en hoek kun je geen driehoek maken.');
  return results;
}

// ---------------------------------------------------------------------------
// Polygons (floor plans, gable walls, any flat shape)
// ---------------------------------------------------------------------------

export interface PolygonAnalysis {
  points: Point[];
  sides: number[];
  /** Interior angle at each vertex, in degrees. */
  angles: number[];
  area: number;
  perimeter: number;
  convex: boolean;
}

function dist(p: Point, q: Point): number {
  return Math.hypot(q.x - p.x, q.y - p.y);
}

function signedArea(points: Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    sum += p.x * q.y - q.x * p.y;
  }
  return sum / 2;
}

/** Side lengths, interior angles, area and convexity of a simple polygon (any orientation). */
export function analyzePolygon(points: Point[]): PolygonAnalysis {
  const n = points.length;
  if (n < 3) throw new GeometryError('Een vorm heeft minstens drie hoekpunten.');
  const orientation = Math.sign(signedArea(points)) || 1;
  const sides: number[] = [];
  const angles: number[] = [];
  let convex = true;
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n];
    const cur = points[i];
    const next = points[(i + 1) % n];
    sides.push(dist(cur, next));
    const v1 = { x: prev.x - cur.x, y: prev.y - cur.y };
    const v2 = { x: next.x - cur.x, y: next.y - cur.y };
    const inner = toDeg(Math.acos(clampCos((v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y)))));
    // Cross product of (cur - prev) x (next - cur) tells whether we turn with the polygon's orientation.
    const cross = (cur.x - prev.x) * (next.y - cur.y) - (cur.y - prev.y) * (next.x - cur.x);
    const reflex = Math.sign(cross) === -orientation && Math.abs(cross) > 1e-12;
    if (reflex) convex = false;
    angles.push(reflex ? 360 - inner : inner);
  }
  return {
    points,
    sides,
    angles,
    area: Math.abs(signedArea(points)),
    perimeter: sides.reduce((p, q) => p + q, 0),
    convex,
  };
}

/**
 * Build a shape from its sides plus diagonals from the first corner (P1).
 *
 * Corners P1..Pn go around the shape. sides[i] = |P(i+1) P(i+2)|, the last side closes back to P1.
 * diagonals[k] = |P1 P(k+3)| for k = 0..n-4 (so a 4-corner shape needs 1 diagonal, a 5-corner shape 2).
 * Each new corner is placed to the left of the previous diagonal (counter-clockwise walk), unless
 * flip[k] is set for that corner, which handles inward (concave) corners.
 */
export function polygonFromDiagonals(sides: number[], diagonals: number[], flip: boolean[] = []): PolygonAnalysis {
  const n = sides.length;
  if (n < 3) throw new GeometryError('Een vorm heeft minstens drie zijden.');
  if (diagonals.length !== n - 3) {
    throw new GeometryError(`Een vorm met ${n} hoeken heeft ${n - 3} diagonaal/diagonalen vanaf hoek 1 nodig.`);
  }
  sides.forEach((s, i) => requirePositive(s, `Zijde ${i + 1}`));
  diagonals.forEach((d, i) => requirePositive(d, `Diagonaal 1–${i + 3}`));

  const pts: Point[] = [
    { x: 0, y: 0 },
    { x: sides[0], y: 0 },
  ];
  // Distance from P1 to each later corner: diagonals, then the closing side.
  const fromStart = [...diagonals, sides[n - 1]];
  for (let k = 2; k < n; k++) {
    const prev = pts[k - 1];
    const r1 = fromStart[k - 2]; // |P1 Pk|
    const r2 = sides[k - 1]; // |P(k-1) Pk|
    const d = Math.hypot(prev.x, prev.y);
    try {
      checkTriangleInequality(d, r1, r2);
    } catch {
      throw new GeometryError(
        `Hoekpunt ${k + 1} past niet: de maten van zijde ${k} en ${k === n - 1 ? `zijde ${n}` : `diagonaal 1–${k + 1}`} sluiten niet aan. Controleer die maten.`,
      );
    }
    // Angle at P1 between direction to prev and direction to new point.
    const alpha = Math.acos(clampCos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1)));
    const base = Math.atan2(prev.y, prev.x);
    const dir = flip[k] ? base - alpha : base + alpha;
    pts.push({ x: r1 * Math.cos(dir), y: r1 * Math.sin(dir) });
  }
  return analyzePolygon(pts);
}

export interface TraverseResult extends PolygonAnalysis {
  /** Computed length of the closing side (last corner back to the first). */
  closingLength: number;
  /** Measured closing side minus computed one, when the closing side was measured. */
  misclosure: number | null;
}

/**
 * Build a shape by walking its sides with the measured interior angles in between.
 *
 * sides: n lengths; the last one (closing side) may be null if it was not measured.
 * angles: interior angles at corners P2..P(n-1) (n-2 values), e.g. from the three-point method.
 * The closing side is computed and compared to the measured value as a check.
 */
export function polygonFromAngles(sides: (number | null)[], angles: number[]): TraverseResult {
  const n = sides.length;
  if (n < 3) throw new GeometryError('Een vorm heeft minstens drie zijden.');
  if (angles.length !== n - 2) throw new GeometryError(`Voor ${n} zijden zijn ${n - 2} hoeken nodig (hoek 2 t/m ${n - 1}).`);
  for (let i = 0; i < n - 1; i++) requirePositive(sides[i] ?? NaN, `Zijde ${i + 1}`);
  angles.forEach((a, i) => {
    // 180° is allowed: a straight corner, e.g. the point under a ridge on a gable wall.
    if (!Number.isFinite(a) || a <= 0 || a >= 360) {
      throw new GeometryError(`Hoek ${i + 2} moet tussen 0° en 360° liggen.`);
    }
  });

  const pts: Point[] = [{ x: 0, y: 0 }];
  let heading = 0; // radians, walking counter-clockwise
  for (let i = 0; i < n - 1; i++) {
    const p = pts[i];
    pts.push({ x: p.x + sides[i]! * Math.cos(heading), y: p.y + sides[i]! * Math.sin(heading) });
    if (i < n - 2) heading += toRad(180 - angles[i]);
  }
  const closingLength = dist(pts[n - 1], pts[0]);
  if (closingLength < 1e-9) throw new GeometryError('De vorm sluit zich op het eerste hoekpunt; controleer de hoeken.');
  const measured = sides[n - 1];
  const analysis = analyzePolygon(pts);
  return {
    ...analysis,
    closingLength,
    misclosure: has(measured) ? measured - closingLength : null,
  };
}

// ---------------------------------------------------------------------------
// Roofs and trusses
// ---------------------------------------------------------------------------

export type RoofType = 'zadeldak' | 'lessenaarsdak' | 'mansardekap';

export interface RoofInput {
  type: 'zadeldak' | 'lessenaarsdak';
  /** Horizontal span, wall to wall (outside of the wall plates). */
  span: number;
  /**
   * Wall-plate heights. Leave both empty to work relative to the plates; fill them in (from the
   * floor) when the walls differ, e.g. a shed with a higher front wall. One filled in = both equal.
   */
  wallLeft?: number | null;
  wallRight?: number | null;
  /** Ridge height (zadeldak) or height difference (lessenaarsdak), in the same reference as the walls. */
  rise?: number | null;
  /** Left pitch (lessenaarsdak: the pitch). */
  pitch?: number | null;
  pitchRight?: number | null;
  /** Left rafter (lessenaarsdak: the rafter). */
  rafter?: number | null;
  rafterRight?: number | null;
  /** Horizontal distance from the left wall to the ridge (zadeldak). */
  ridgeOffset?: number | null;
  /** Horizontal overhang beyond the wall, measured level. */
  overhang?: number | null;
}

export interface RoofSide {
  run: number;
  /** Height of the slope: from its wall plate up to the ridge (or knee). */
  rise: number;
  pitch: number;
  /** Pitch as a percentage (rise per 100 horizontal). */
  pitchPercent: number;
  /** Rafter length from wall plate to ridge, along the slope. */
  rafter: number;
  /** Rafter length including the overhang. */
  rafterWithOverhang: number;
}

export interface RoofResult {
  type: RoofType;
  span: number;
  /** Height of the ridge (lessenaarsdak: of the high side), in the reference of the wall heights. */
  rise: number;
  /** Left slope; for a mansard roof the steep lower part (same on both sides). */
  left: RoofSide;
  right: RoofSide | null;
  /** Mansard roof only: the flatter upper part, from the knee to the ridge. */
  upper: RoofSide | null;
  /** Mansard roof only: left knee point (where the slope changes). */
  knee: Point | null;
  /** Ridge point (x from the left wall, y height). */
  ridge: Point;
  /** Wall-plate heights used (0 when worked relative to the plates). */
  plateLeft: number;
  plateRight: number;
  /** True when wall heights were given, so the outline and gable area start at the floor. */
  fromFloor: boolean;
  /** True when only one value was given and the ridge was assumed in the middle. */
  ridgeAssumedCentre: boolean;
  /** Area of the gable end: above the plates, or from the floor when wall heights were given. */
  gableArea: number;
  /** Outline of the gable end for drawing. */
  outline: Point[];
}

function side(run: number, rise: number, overhang: number): RoofSide {
  const pitchRad = Math.atan2(rise, run);
  const rafter = Math.hypot(run, rise);
  return {
    run,
    rise,
    pitch: toDeg(pitchRad),
    pitchPercent: (rise / run) * 100,
    rafter,
    rafterWithOverhang: rafter + overhang / Math.cos(pitchRad),
  };
}

function requirePitch(p: number, label: string): void {
  if (p <= 0 || p >= 90) throw new GeometryError(`${label} moet tussen 0° en 90° liggen.`);
}

export function roofSection(input: RoofInput): RoofResult {
  const span = input.span;
  requirePositive(span, 'De overspanning');
  const overhang = has(input.overhang) ? input.overhang : 0;
  if (overhang < 0) throw new GeometryError('De overstek kan niet negatief zijn.');
  const fromFloor = has(input.wallLeft) || has(input.wallRight);
  const hL = has(input.wallLeft) ? input.wallLeft : has(input.wallRight) ? input.wallRight : 0;
  const hR = has(input.wallRight) ? input.wallRight : hL;
  if (fromFloor) {
    requirePositive(hL, 'De muurhoogte links');
    requirePositive(hR, 'De muurhoogte rechts');
  }
  return input.type === 'lessenaarsdak' ? leanTo(input, span, hL, hR, overhang, fromFloor) : gable(input, span, hL, hR, overhang, fromFloor);
}

function finish(
  type: RoofType,
  span: number,
  ridge: Point,
  left: RoofSide,
  right: RoofSide | null,
  hL: number,
  hR: number,
  fromFloor: boolean,
  ridgeAssumedCentre: boolean,
  top: Point[],
): RoofResult {
  const outline = fromFloor ? [{ x: 0, y: 0 }, ...top, { x: span, y: 0 }] : top;
  return {
    type,
    span,
    rise: ridge.y,
    left,
    right,
    upper: null,
    knee: null,
    ridge,
    plateLeft: hL,
    plateRight: hR,
    fromFloor,
    ridgeAssumedCentre,
    gableArea: Math.abs(signedArea(outline)),
    outline,
  };
}

/** Lean-to: one slope from the left wall plate up (or down) to the right wall. */
function leanTo(input: RoofInput, span: number, hL: number, hR: number, overhang: number, fromFloor: boolean): RoofResult {
  const values = [input.rise, input.pitch, input.rafter].filter(has).length;
  let diff: number;
  if (fromFloor && Math.abs(hR - hL) > 1e-9) {
    if (values > 0) throw new GeometryError('De twee muurhoogtes bepalen de helling al; laat hoogteverschil, helling en sparlengte leeg.');
    diff = Math.abs(hR - hL);
  } else {
    if (values !== 1) throw new GeometryError('Vul één van deze in: hoogteverschil, dakhelling of sparlengte.');
    if (has(input.rise)) {
      requirePositive(input.rise, 'Het hoogteverschil');
      diff = input.rise;
    } else if (has(input.pitch)) {
      requirePitch(input.pitch, 'De dakhelling');
      diff = span * Math.tan(toRad(input.pitch));
    } else {
      requirePositive(input.rafter!, 'De sparlengte');
      if (input.rafter! <= span) throw new GeometryError(`De sparlengte moet langer zijn dan de overspanning (${fmt(span)}).`);
      diff = Math.sqrt(input.rafter! ** 2 - span ** 2);
    }
  }
  // Without wall heights the slope rises to the right; with them it follows the walls.
  const rightHigh = !fromFloor || hR >= hL;
  const low = rightHigh ? hL : hR;
  const leftPt = { x: 0, y: rightHigh ? low : low + diff };
  const rightPt = { x: span, y: rightHigh ? low + diff : low };
  const top = fromFloor ? [leftPt, rightPt] : [leftPt, rightPt, { x: span, y: 0 }];
  const ridge = rightHigh ? rightPt : leftPt;
  return finish('lessenaarsdak', span, ridge, side(span, diff, overhang), null, leftPt.y, rightPt.y, fromFloor, false, top);
}

/**
 * Gable roof with the ridge anywhere between the walls and walls of different height.
 * Two values fix it: any two of left/right pitch, left/right rafter, ridge height, ridge offset.
 */
function gable(input: RoofInput, span: number, hL: number, hR: number, overhang: number, fromFloor: boolean): RoofResult {
  const { pitch: pL, pitchRight: pR, rafter: rL, rafterRight: rR, rise: H } = input;
  let xr = has(input.ridgeOffset) ? input.ridgeOffset : null;
  if (has(pL)) requirePitch(pL, 'De dakhelling links');
  if (has(pR)) requirePitch(pR, 'De dakhelling rechts');
  if (has(rL)) requirePositive(rL, 'De spar links');
  if (has(rR)) requirePositive(rR, 'De spar rechts');
  if (has(H)) requirePositive(H, 'De nokhoogte');

  // Each value gives the ridge height as a function of the ridge position x.
  const heightOf: ((x: number) => number)[] = [];
  if (has(pL)) heightOf.push((x) => hL + x * Math.tan(toRad(pL)));
  if (has(pR)) heightOf.push((x) => hR + (span - x) * Math.tan(toRad(pR)));
  if (has(rL)) heightOf.push((x) => (x < rL ? hL + Math.sqrt(rL ** 2 - x ** 2) : NaN));
  if (has(rR)) heightOf.push((x) => (span - x < rR ? hR + Math.sqrt(rR ** 2 - (span - x) ** 2) : NaN));
  if (has(H)) heightOf.push(() => H);

  const count = heightOf.length + (xr !== null ? 1 : 0);
  let assumedCentre = false;
  if (count === 1 && xr === null && Math.abs(hL - hR) < 1e-9) {
    xr = span / 2;
    assumedCentre = true;
  } else if (count !== 2) {
    throw new GeometryError(
      count < 2
        ? 'Vul twee waarden in: dakhelling links of rechts, spar links of rechts, nokhoogte of afstand tot de nok.'
        : 'Vul precies twee waarden in; laat de andere leeg.',
    );
  }

  let ridgeHeight: number;
  if (xr !== null) {
    if (xr <= 0 || xr >= span) throw new GeometryError('De nok moet tussen de twee muren liggen.');
    ridgeHeight = heightOf[0](xr);
    if (!Number.isFinite(ridgeHeight)) throw new GeometryError('De spar is te kort om de nok op die plek te halen.');
  } else {
    // Two height functions: find the x where they meet.
    const [f, g] = heightOf;
    const diff = (x: number) => f(x) - g(x);
    const steps = 4000;
    const roots: number[] = [];
    let prevX = (span * 0.5) / steps;
    let prev = diff(prevX);
    for (let i = 1; i < steps; i++) {
      const x = (span * (i + 0.5)) / steps;
      const d = diff(x);
      if (Number.isFinite(prev) && Number.isFinite(d) && Math.sign(prev) !== Math.sign(d)) {
        let lo = prevX;
        let hi = x;
        for (let k = 0; k < 80; k++) {
          const mid = (lo + hi) / 2;
          if (Math.sign(diff(mid)) === Math.sign(diff(lo))) lo = mid;
          else hi = mid;
        }
        roots.push((lo + hi) / 2);
      } else if (d === 0) roots.push(x);
      prevX = x;
      prev = d;
    }
    const distinct = roots.filter((r, i) => i === 0 || r - roots[i - 1] > span * 1e-6);
    roots.length = 0;
    roots.push(...distinct);
    if (roots.length === 0) throw new GeometryError('Met deze twee waarden komen de dakvlakken niet bij elkaar. Controleer de maten.');
    if (roots.length > 1) throw new GeometryError('Met deze twee waarden passen meerdere nokposities. Vul liever een helling of de nokhoogte in.');
    xr = roots[0];
    ridgeHeight = f(xr);
  }

  if (ridgeHeight <= hL + 1e-9 || ridgeHeight <= hR + 1e-9) throw new GeometryError('De nok moet hoger liggen dan beide muurplaten.');
  const left = side(xr, ridgeHeight - hL, overhang);
  const right = side(span - xr, ridgeHeight - hR, overhang);
  const ridge = { x: xr, y: ridgeHeight };
  return finish('zadeldak', span, ridge, left, right, hL, hR, fromFloor, assumedCentre, [{ x: 0, y: hL }, ridge, { x: span, y: hR }]);
}

/** A straight slope: horizontal run, vertical rise, pitch (degrees) and length along the slope. */
export interface Slope {
  run: number;
  rise: number;
  pitch: number;
  length: number;
}

export interface SlopeInput {
  run?: number | null;
  rise?: number | null;
  pitch?: number | null;
  length?: number | null;
}

/** Complete a slope from exactly two of run, rise, pitch and length. */
export function solveSlope(input: SlopeInput, label = 'Dit dakdeel'): Slope {
  const { run, rise, pitch, length } = input;
  const count = [run, rise, pitch, length].filter(has).length;
  if (count !== 2) throw new GeometryError(`${label}: vul precies twee van de vier waarden in.`);
  if (has(run)) requirePositive(run, `${label}: de horizontale maat`);
  if (has(rise)) requirePositive(rise, `${label}: de hoogte`);
  if (has(length)) requirePositive(length, `${label}: de lengte`);
  if (has(pitch) && (pitch <= 0 || pitch >= 90)) throw new GeometryError(`${label}: de helling moet tussen 0° en 90° liggen.`);
  const tooShort = () => new GeometryError(`${label}: de lengte langs de helling moet langer zijn dan de horizontale of verticale maat.`);

  let r: number;
  let h: number;
  if (has(run) && has(rise)) [r, h] = [run, rise];
  else if (has(run) && has(pitch)) [r, h] = [run, run * Math.tan(toRad(pitch))];
  else if (has(run) && has(length)) {
    if (length <= run) throw tooShort();
    [r, h] = [run, Math.sqrt(length ** 2 - run ** 2)];
  } else if (has(rise) && has(pitch)) [r, h] = [rise / Math.tan(toRad(pitch)), rise];
  else if (has(rise) && has(length)) {
    if (length <= rise) throw tooShort();
    [r, h] = [Math.sqrt(length ** 2 - rise ** 2), rise];
  } else [r, h] = [length! * Math.cos(toRad(pitch!)), length! * Math.sin(toRad(pitch!))];
  return { run: r, rise: h, pitch: toDeg(Math.atan2(h, r)), length: Math.hypot(r, h) };
}

export interface MansardInput {
  /** Horizontal span, wall to wall. */
  span: number;
  /** Steep lower part: exactly two of run (inset to the knee), rise (knee height), pitch, length. */
  lower: SlopeInput;
  /** Flatter upper part: exactly one of rise (ridge above knee), pitch, length. Its run follows from the span. */
  upper: Omit<SlopeInput, 'run'>;
  overhang?: number | null;
}

/** Symmetric mansard roof (mansardekap): a steep lower slope and a flatter upper slope on each side. */
export function mansardSection(input: MansardInput): RoofResult {
  requirePositive(input.span, 'De overspanning');
  const overhang = has(input.overhang) ? input.overhang : 0;
  if (overhang < 0) throw new GeometryError('De overstek kan niet negatief zijn.');

  const lower = solveSlope(input.lower, 'Onderdak');
  const half = input.span / 2;
  if (lower.run >= half - 1e-9) {
    throw new GeometryError(`Onderdak: de knik ligt ${fmt(lower.run)} naar binnen, dat is voorbij het midden (${fmt(half)}).`);
  }
  const upperGiven = [input.upper.rise, input.upper.pitch, input.upper.length].filter(has).length;
  if (upperGiven !== 1) throw new GeometryError('Bovendak: vul precies één in: hoogte tot de nok, helling of lengte.');
  const upper = solveSlope({ run: half - lower.run, ...input.upper }, 'Bovendak');
  if (upper.pitch >= lower.pitch) {
    throw new GeometryError('Het bovendak moet flauwer zijn dan het onderdak, anders is het geen mansardekap.');
  }

  const rise = lower.rise + upper.rise;
  const knee = { x: lower.run, y: lower.rise };
  const outline: Point[] = [
    { x: 0, y: 0 },
    knee,
    { x: half, y: rise },
    { x: input.span - lower.run, y: lower.rise },
    { x: input.span, y: 0 },
  ];
  const lowerSide = side(lower.run, lower.rise, overhang);
  return {
    type: 'mansardekap',
    span: input.span,
    rise,
    left: lowerSide,
    right: lowerSide,
    upper: side(upper.run, upper.rise, 0),
    knee,
    ridge: outline[2],
    plateLeft: 0,
    plateRight: 0,
    fromFloor: false,
    ridgeAssumedCentre: false,
    gableArea: Math.abs(signedArea(outline)),
    outline,
  };
}

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

export interface Opening {
  width: number;
  height: number;
}

export interface RoomTotals {
  floorArea: number;
  volume: number | null;
  wallArea: number | null;
  openingsArea: number;
  netWallArea: number | null;
}

/** Floor area, volume and wall area of a room with straight walls of equal height. */
export function roomTotals(shape: PolygonAnalysis, height: number | null, openings: Opening[] = []): RoomTotals {
  const openingsArea = openings.reduce((sum, o) => {
    requirePositive(o.width, 'Breedte opening');
    requirePositive(o.height, 'Hoogte opening');
    return sum + o.width * o.height;
  }, 0);
  if (!has(height)) {
    return { floorArea: shape.area, volume: null, wallArea: null, openingsArea, netWallArea: null };
  }
  requirePositive(height, 'De hoogte');
  const wallArea = shape.perimeter * height;
  return {
    floorArea: shape.area,
    volume: shape.area * height,
    wallArea,
    openingsArea,
    netWallArea: Math.max(0, wallArea - openingsArea),
  };
}

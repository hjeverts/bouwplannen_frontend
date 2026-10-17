/**
 * Lean-to roof on posts (afdak), seen from above: where the posts and their footings go (centre
 * of every post), how far apart, how far out of the wall, the diagonals to set them out square,
 * and the closed sides.
 *
 * Coordinates: x from the left edge of the roof to the right, s from the back (the building wall,
 * or the back edge of a free-standing roof) to the front.
 */

export type Side = 'links' | 'rechts' | 'voor' | 'achter';

export interface AfdakInput {
  width: number;
  depth: number;
  attached: boolean;
  /** Corner of the building to the left edge of the roof, along the wall (null = not known). */
  wallOffset: number | null;
  postWidth: number;
  postDepth: number;
  postsFront: number;
  postsBack: number;
  overhangSide: number;
  overhangFront: number;
  overhangBack: number;
  footing: number | null;
  walls: Side[];
  wallThickness: number;
}

export interface Post {
  name: string;
  row: 'voor' | 'achter';
  /** Centre of the post. */
  x: number;
  s: number;
}

export interface Diagonal {
  from: { x: number; s: number; label: string };
  to: { x: number; s: number; label: string };
  length: number;
}

export interface AfdakWall {
  side: Side;
  /** Rectangle: x0..x1 by s0..s1. */
  x0: number;
  x1: number;
  s0: number;
  s1: number;
}

export interface AfdakResult {
  width: number;
  depth: number;
  attached: boolean;
  posts: Post[];
  /** Centre to centre along each row. */
  spacingFront: number | null;
  spacingBack: number | null;
  /** From the wall (or the back edge) to the centre of the front row, and of the back row. */
  frontRow: number;
  backRow: number | null;
  /** Against a building: points on the wall straight behind the outer front posts, to measure from. */
  wallMarks: { x: number; label: string }[];
  /** Two diagonals of the rectangle the outer posts (and wall marks) make: equal when square. */
  diagonals: Diagonal[];
  walls: AfdakWall[];
  footing: number | null;
  postWidth: number;
  postDepth: number;
  wallOffset: number | null;
  warnings: string[];
}

const mm = (m: number) => `${Math.round(m * 1000)} mm`;

/** Centres of `n` posts between the outer centres a and b. */
function row(n: number, a: number, b: number): number[] {
  if (n <= 1) return [(a + b) / 2];
  return Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));
}

export function computeAfdak(input: AfdakInput): AfdakResult {
  const warnings: string[] = [];
  const { width: W, depth: D, postWidth: pw, postDepth: pd } = input;
  if (!(W > 0) || !(D > 0)) throw new RangeError('De breedte en de diepte moeten groter zijn dan 0.');
  if (!(pw > 0) || !(pd > 0)) throw new RangeError('De maat van de staanders moet groter zijn dan 0.');
  const nF = Math.max(1, Math.round(input.postsFront));
  const nB = input.attached ? 0 : Math.max(1, Math.round(input.postsBack));
  // Outer post centres: the outside of the post the overhang in from the edge.
  const xa = input.overhangSide + pw / 2;
  const xb = W - input.overhangSide - pw / 2;
  if (xb < xa - 1e-9) throw new RangeError(`De staanders passen niet in de breedte: ${mm(W)} min twee keer de overstek is smaller dan een staander.`);
  const frontRow = D - input.overhangFront - pd / 2;
  const backRow = input.attached ? null : input.overhangBack + pd / 2;
  if (frontRow <= (backRow ?? 0) + 1e-9) throw new RangeError('De staanders passen niet in de diepte: de overstekken zijn te groot.');

  const posts: Post[] = [];
  let k = 1;
  if (backRow !== null) for (const x of row(nB, xa, xb)) posts.push({ name: `P${k++}`, row: 'achter', x, s: backRow });
  for (const x of row(nF, xa, xb)) posts.push({ name: `P${k++}`, row: 'voor', x, s: frontRow });
  const spacing = (n: number) => (n > 1 ? (xb - xa) / (n - 1) : null);

  // Set out from the wall: marks straight behind the outer posts. Free-standing: the back posts.
  const front = posts.filter((p) => p.row === 'voor');
  const back = posts.filter((p) => p.row === 'achter');
  const fL = front[0];
  const fR = front[front.length - 1];
  const wallMarks = input.attached ? [{ x: xa, label: 'M1' }, ...(nF > 1 ? [{ x: xb, label: 'M2' }] : [])] : [];
  const diagonals: Diagonal[] = [];
  const bL = input.attached ? { x: xa, s: 0, label: 'M1' } : { x: back[0].x, s: back[0].s, label: back[0].name };
  const bR = input.attached ? { x: xb, s: 0, label: 'M2' } : { x: back[back.length - 1].x, s: back[back.length - 1].s, label: back[back.length - 1].name };
  if (xb - xa > 1e-6) {
    const d = (a: { x: number; s: number }, b: { x: number; s: number }) => Math.hypot(b.x - a.x, b.s - a.s);
    const tl = { x: fL.x, s: fL.s, label: fL.name };
    const tr = { x: fR.x, s: fR.s, label: fR.name };
    diagonals.push({ from: bL, to: tr, length: d(bL, tr) }, { from: bR, to: tl, length: d(bR, tl) });
  }

  // Closed sides: on the post lines, flush with the outside of the posts.
  const t = Math.max(0, input.wallThickness);
  const xL0 = xa - pw / 2;
  const xR1 = xb + pw / 2;
  const sBack = backRow === null ? 0 : backRow - pd / 2;
  const sFront = frontRow + pd / 2;
  const walls: AfdakWall[] = [];
  for (const side of [...new Set(input.walls)]) {
    if (side === 'achter' && input.attached) {
      warnings.push('De achterkant is de muur van het gebouw: daar komt geen wand.');
      continue;
    }
    if (t <= 0) continue;
    if (side === 'links') walls.push({ side, x0: xL0, x1: xL0 + t, s0: sBack, s1: sFront });
    if (side === 'rechts') walls.push({ side, x0: xR1 - t, x1: xR1, s0: sBack, s1: sFront });
    if (side === 'voor') walls.push({ side, x0: xL0, x1: xR1, s0: sFront - t, s1: sFront });
    if (side === 'achter') walls.push({ side, x0: xL0, x1: xR1, s0: sBack, s1: sBack + t });
  }
  if (input.footing !== null && input.footing > 0 && input.footing < Math.max(pw, pd)) warnings.push('De poer is kleiner dan de staander.');
  const sp = spacing(nF);
  if (sp !== null && sp > 4) warnings.push(`Staanders ${mm(sp)} hart op hart: reken de ligger erop na.`);
  return {
    width: W,
    depth: D,
    attached: input.attached,
    posts,
    spacingFront: sp,
    spacingBack: nB ? spacing(nB) : null,
    frontRow,
    backRow,
    wallMarks,
    diagonals,
    walls,
    footing: input.footing && input.footing > 0 ? input.footing : null,
    postWidth: pw,
    postDepth: pd,
    wallOffset: input.wallOffset,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Roof: rafters (sporen) from the back support down over the front beam, each resting on a
// horizontal seat cut into its underside (vogelbek / keep).

export interface AfdakRoofInput {
  /** Pitch in degrees; null when both support heights are given. */
  pitch: number | null;
  /** Top of the front beam (on the posts) above the floor; null when worked out. */
  frontHeight: number | null;
  /** Top of the back support (beam against the building, or on the back posts); null when worked out. */
  backHeight: number | null;
  /** Front beam: width (front to back) and height. */
  beamWidth: number;
  beamHeight: number;
  /** Back support width (front to back): beam against the wall, or the back beam on its posts. */
  backWidth: number;
  rafterWidth: number;
  rafterHeight: number;
  /** Centre to centre. */
  rafterSpacing: number;
  /** Deepest notch as a part of the rafter height, square to the rafter: 1/3 or 1/4. */
  notchFraction: number;
  /**
   * Against a building: 'op' = the rafters rest on top of the beam (seat notch), 'tegen' = they
   * end against its front face with a plumb cut and are screwed to it (or hung in joist hangers).
   */
  backFix?: 'op' | 'tegen';
  /** 'tegen': top of the rafter above the top of the beam, at its face (0 = flush; negative = lower). */
  backOffset?: number;
  /** 'tegen': height of that beam, to check the rafter's end does not hang below it. */
  backBeamHeight?: number | null;
}

export interface Seat {
  name: string;
  /** Support from s0 (uphill face) to s1 (downhill face), top at z. */
  s0: number;
  s1: number;
  z: number;
  /** Seat: horizontal, from s1 − length to s1; plumb (heel) cut at s1 down `plumb`. */
  length: number;
  plumb: number;
  /** Depth of the notch square to the rafter, and what is left of the rafter above it. */
  depth: number;
  left: number;
  /** The seat is shorter than the support is wide (the notch would get too deep). */
  limited: boolean;
  /** The rafter ends against this support (no notch); `plumb` is then the height of its end cut. */
  against?: boolean;
}

export interface Rafter {
  pitch: number;
  /** Underside of the rafter: height at s. */
  undersideAt: (s: number) => number;
  /** Ends: plumb cuts at s = start (back) and s = depth (front). Length along the rafter, both edges. */
  length: number;
  /** Where the rafter starts at the back: 0 (wall or back edge), or the face of the beam it is fixed against. */
  start: number;
  seats: Seat[];
  /** Positions along the width (centres) and the spacing that comes out. */
  xs: number[];
  spacing: number;
  frontHeight: number;
  backHeight: number;
  /** Posts from the floor to the underside of their beam. */
  frontPost: number;
  backPost: number | null;
  /** Top of the rafter at the ends (plumb cut top) and its underside there. */
  ends: { back: { under: number; top: number }; front: { under: number; top: number } };
  warnings: string[];
}

const DEG = Math.PI / 180;

/** Seat on a support whose downhill face is at s1, for a rafter of height h at pitch a. */
function seatOn(name: string, s0: number, s1: number, z: number, h: number, a: number, fraction: number): Seat {
  const width = s1 - s0;
  // Deepest allowed notch square to the rafter: fraction × h. A seat of length L cuts L·sin a deep.
  const max = (fraction * h) / Math.sin(a);
  const length = Math.min(width, max);
  const depth = length * Math.sin(a);
  return { name, s0, s1, z, length, plumb: length * Math.tan(a), depth, left: h - depth, limited: max < width - 1e-9 };
}

/**
 * Rafters for an afdak: given the pitch and one support height, or both heights (then the pitch
 * follows). The rafters run from s = 0 (the wall, or the back edge) to s = depth (the front edge).
 */
export function computeRafters(plan: AfdakResult, roof: AfdakRoofInput): Rafter {
  const warnings: string[] = [];
  const h = roof.rafterHeight;
  if (!(h > 0) || !(roof.rafterWidth > 0)) throw new RangeError('Vul de maat van de sporen in.');
  if (!(roof.beamWidth > 0)) throw new RangeError('Vul de breedte van de voorligger in.');
  // Front beam centred on the front posts; back support against the wall, or centred on the back posts.
  const f0 = plan.frontRow - roof.beamWidth / 2;
  const f1 = plan.frontRow + roof.beamWidth / 2;
  const b0 = plan.backRow === null ? 0 : plan.backRow - roof.backWidth / 2;
  const b1 = plan.backRow === null ? roof.backWidth : plan.backRow + roof.backWidth / 2;
  if (!(roof.backWidth > 0)) throw new RangeError(plan.attached ? 'Vul de breedte van de ligger tegen het gebouw in.' : 'Vul de breedte van de achterligger in.');

  const against = plan.attached && roof.backFix === 'tegen';
  const offset = roof.backOffset ?? 0;
  /** Height difference between the back and the front support tops for pitch a. */
  const rise = (a: number) => {
    const sf = f1 - seatOn('', f0, f1, 0, h, a, roof.notchFraction).length;
    // Against the beam: the rafter's top at the beam face is `offset` above the beam top.
    if (against) return Math.tan(a) * (sf - b1) + h / Math.cos(a) - offset;
    const sb = b1 - seatOn('', b0, b1, 0, h, a, roof.notchFraction).length;
    return Math.tan(a) * (sf - sb);
  };
  let a: number;
  let zf: number;
  let zb: number;
  if (roof.pitch !== null) {
    if (!(roof.pitch > 0 && roof.pitch < 80)) throw new RangeError('De dakhelling moet tussen 0° en 80° liggen.');
    a = roof.pitch * DEG;
    if (roof.frontHeight !== null) {
      zf = roof.frontHeight;
      zb = zf + rise(a);
      if (roof.backHeight !== null && Math.abs(roof.backHeight - zb) > 0.001) {
        warnings.push(`Met deze helling komt de achterkant op ${Math.round(zb * 1000)} mm, niet op de ingevulde ${Math.round(roof.backHeight * 1000)} mm. Laat een van de drie leeg.`);
      }
    } else if (roof.backHeight !== null) {
      zb = roof.backHeight;
      zf = zb - rise(a);
    } else throw new RangeError('Vul de hoogte van de voorligger of van de ligger achter in.');
  } else {
    if (roof.frontHeight === null || roof.backHeight === null) throw new RangeError('Vul de dakhelling in, of beide hoogtes.');
    zf = roof.frontHeight;
    zb = roof.backHeight;
    if (zb <= zf && !against) throw new RangeError('De achterkant moet hoger liggen dan de voorligger.');
    // rise(a) grows with a: bisection.
    let lo = 0.1 * DEG;
    let hi = 79 * DEG;
    if (rise(hi) < zb - zf) throw new RangeError('Het hoogteverschil is te groot voor deze diepte.');
    if (rise(lo) > zb - zf) throw new RangeError('Het hoogteverschil is te klein: de spoor tegen de ligger komt dan al hoger dan de achterkant.');
    for (let i = 0; i < 80; i++) {
      const mid = (lo + hi) / 2;
      if (rise(mid) < zb - zf) lo = mid;
      else hi = mid;
    }
    a = (lo + hi) / 2;
  }
  const front = seatOn('Voorligger', f0, f1, zf, h, a, roof.notchFraction);
  const back: Seat = against
    ? { name: 'Ligger tegen gebouw', s0: b0, s1: b1, z: zb, length: 0, plumb: h / Math.cos(a), depth: 0, left: h, limited: false, against: true }
    : seatOn(plan.attached ? 'Ligger tegen gebouw' : 'Achterligger', b0, b1, zb, h, a, roof.notchFraction);
  // The underside passes through the start of the front seat.
  const sStart = f1 - front.length;
  const undersideAt = (s: number) => zf - Math.tan(a) * (s - sStart);
  const start = against ? b1 : 0;
  const length = (plan.depth - start) / Math.cos(a);
  const top = (s: number) => undersideAt(s) + h / Math.cos(a);
  if (against && roof.backBeamHeight && roof.backBeamHeight > 0) {
    // The end of the rafter against the beam should stay on the beam (for screws or a hanger).
    const below = zb - roof.backBeamHeight - undersideAt(b1);
    if (below > 0.001) warnings.push(`Ligger tegen gebouw: de onderkant van de spoor komt ${Math.round(below * 1000)} mm onder de ligger uit (loodsnede ${Math.round((h / Math.cos(a)) * 1000)} mm, ligger ${Math.round(roof.backBeamHeight * 1000)} mm). Zet de spoor hoger of gebruik een hogere ligger.`);
  }

  for (const st of [front, ...(against ? [] : [back])]) {
    if (st.length < Math.min(0.05, st.s1 - st.s0) - 1e-9) warnings.push(`${st.name}: de spoor ligt maar ${Math.round(st.length * 1000)} mm op; dat is weinig. Een hogere spoor of minder helling geeft meer oplegging.`);
    else if (st.limited) warnings.push(`${st.name}: de keep is beperkt tot ${Math.round(st.depth * 1000)} mm diep (${roof.notchFraction === 0.25 ? '1/4' : '1/3'} van de spoor), de zit is daardoor ${Math.round(st.length * 1000)} mm in plaats van de volle ${Math.round((st.s1 - st.s0) * 1000)} mm.`);
  }

  // Rafters along the width: the outer ones flush with the edges.
  const n = Math.max(2, Math.ceil((plan.width - roof.rafterWidth) / roof.rafterSpacing - 1e-9) + 1);
  const spacing = (plan.width - roof.rafterWidth) / (n - 1);
  const xs = Array.from({ length: n }, (_, i) => roof.rafterWidth / 2 + i * spacing);

  return {
    pitch: a / DEG,
    undersideAt,
    length,
    start,
    seats: [back, front],
    xs,
    spacing,
    frontHeight: zf,
    backHeight: zb,
    frontPost: zf - roof.beamHeight,
    backPost: plan.attached ? null : zb - roof.beamHeight,
    ends: { back: { under: undersideAt(start), top: top(start) }, front: { under: undersideAt(plan.depth), top: top(plan.depth) } },
    warnings,
  };
}

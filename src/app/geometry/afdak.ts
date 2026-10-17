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
  /** Where a beam lies on its posts: centred, flush with their front face, or with their back face. */
  beamAlign?: 'midden' | 'voor' | 'achter';
  /**
   * Depth of the notch at the heel, square to the rafter, for the front beam and (on top) the back
   * one; null = automatic: a seat over the whole beam width, no deeper than the allowed part.
   */
  frontNotch?: number | null;
  backNotch?: number | null;
  /** 'tegen': above the beam the rafter runs on to the wall (a nose over the beam). */
  backThrough?: boolean;
  /**
   * Pockets cut into the top of the beam at every rafter, rafter-wide, this deep (plumb, level
   * bottom): the rafter sits that much lower in the beam, so its own notch can stay smaller.
   */
  frontPocket?: number;
  backPocket?: number;
  /**
   * 'tegen': how the rafter is held at the wall beam: screwed, or in a joist hanger (balkdrager)
   * that tilts with the roof ('hellend'), or one with a level seat ('vlak': the rafter's end gets a
   * small level seat cut, `hangerSeat` long).
   */
  backHanger?: 'schroef' | 'hellend' | 'vlak';
  hangerSeat?: number;
  /** Height of the hanger (plumb); null = 3/4 of the rafter. */
  hangerHeight?: number | null;
}

export interface Hanger {
  kind: 'hellend' | 'vlak';
  /** Seat depth along the roof (level for 'vlak'), and the heel the level seat leaves in the rafter. */
  seat: number;
  heel: number;
  /** Bottom of the hanger at the beam face, and its height (plumb). */
  bottom: number;
  height: number;
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
  /**
   * Housed: the notch is deeper than a seat over the whole beam gives, so the rafter is cut over
   * the beam with a plumb cut on the uphill side too, `upPlumb` high.
   */
  housed?: boolean;
  upPlumb?: number;
  /** Against the wall beam with a nose running on over it to the wall (the seat reaches the rafter's end). */
  through?: boolean;
  /** A depth was asked for that is deeper than the allowed part of the rafter. */
  tooDeep?: boolean;
  /** Pocket in the beam at each rafter (plumb depth); the seat lies at `floor` = z − pocket. */
  pocket: number;
  floor: number;
  /** Against the beam in a joist hanger. */
  hanger?: Hanger;
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

/**
 * Seat on a support from s0 to s1 (downhill face), for a rafter of height h at pitch a. The notch is
 * `depth` deep at the heel (the corner at s1), square to the rafter; automatic (null): a seat over
 * the whole width, but no deeper than `fraction` of the rafter. The heel's plumb cut is depth / cos a.
 * A seat of length L cuts L·sin a deep; deeper than the width gives, the rafter is housed over the
 * beam with a second plumb cut on the uphill side.
 */
function seatOn(name: string, s0: number, s1: number, z: number, h: number, a: number, fraction: number, wanted: number | null = null, pocket = 0): Seat {
  const width = s1 - s0;
  const max = fraction * h;
  const full = width * Math.sin(a);
  const depth = wanted === null ? Math.min(full, max) : Math.max(0, wanted);
  const length = Math.min(width, depth / Math.sin(a));
  const housed = depth > full + 1e-9;
  return {
    name,
    s0,
    s1,
    z,
    length,
    plumb: depth / Math.cos(a),
    depth,
    left: h - depth,
    limited: wanted === null && max < full - 1e-9,
    housed,
    upPlumb: housed ? (depth - full) / Math.cos(a) : 0,
    tooDeep: wanted !== null && depth > max + 1e-9,
    pocket,
    floor: z - pocket,
  };
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
  // A beam on a row of posts: centred, or flush with the front or the back face of the posts.
  // The back support of a roof against a building lies against the wall.
  const onPosts = (row: number, width: number): [number, number] => {
    const pd = plan.postDepth;
    if (roof.beamAlign === 'voor') return [row + pd / 2 - width, row + pd / 2];
    if (roof.beamAlign === 'achter') return [row - pd / 2, row - pd / 2 + width];
    return [row - width / 2, row + width / 2];
  };
  const [f0, f1] = onPosts(plan.frontRow, roof.beamWidth);
  const [b0, b1] = plan.backRow === null ? [0, roof.backWidth] : onPosts(plan.backRow, roof.backWidth);
  if (!(roof.backWidth > 0)) throw new RangeError(plan.attached ? 'Vul de breedte van de ligger tegen het gebouw in.' : 'Vul de breedte van de achterligger in.');

  const against = plan.attached && roof.backFix === 'tegen';
  const through = against && !!roof.backThrough;
  const offset = roof.backOffset ?? 0;
  const fPocket = Math.max(0, roof.frontPocket ?? 0);
  const bPocket = against ? 0 : Math.max(0, roof.backPocket ?? 0);
  if (fPocket >= roof.beamHeight) throw new RangeError('De inkeping in de voorligger is dieper dan de ligger hoog is.');
  const frontSeat = (a: number, z = 0) => seatOn('Voorligger', f0, f1, z, h, a, roof.notchFraction, roof.frontNotch ?? null, fPocket);
  const backSeat = (a: number, z = 0) => seatOn(plan.attached ? 'Ligger tegen gebouw' : 'Achterligger', b0, b1, z, h, a, roof.notchFraction, roof.backNotch ?? null, bPocket);
  /**
   * Height difference between the back and the front support tops for pitch a. The underside of the
   * rafter is at each heel (s1) its plumb cut below the top of the support.
   */
  const rise = (a: number) => {
    const fp = frontSeat(a).plumb + fPocket;
    // Against the beam: the rafter's top at the beam face is `offset` above the beam top.
    if (against) return Math.tan(a) * (f1 - b1) - fp + h / Math.cos(a) - offset;
    return Math.tan(a) * (f1 - b1) - fp + backSeat(a).plumb + bPocket;
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
  const front = frontSeat(a, zf);
  const endCut = h / Math.cos(a) - offset; // against the beam: plumb face below its top
  const back: Seat = against
    ? through
      ? // A nose over the beam to the wall: the seat on the beam top reaches the rafter's end.
        { name: 'Ligger tegen gebouw', s0: b0, s1: b1, z: zb, length: b1 - b0, plumb: endCut, depth: endCut * Math.cos(a), left: offset * Math.cos(a), limited: false, against: true, through: true, pocket: 0, floor: zb }
      : { name: 'Ligger tegen gebouw', s0: b0, s1: b1, z: zb, length: 0, plumb: h / Math.cos(a), depth: 0, left: h, limited: false, against: true, pocket: 0, floor: zb }
    : backSeat(a, zb);
  // The underside passes the front heel its plumb cut below the seat (the beam top, or its pocket).
  const undersideAt = (s: number) => front.floor - front.plumb - Math.tan(a) * (s - f1);
  const start = against && !through ? b1 : 0;
  if (against && !through && roof.backHanger && roof.backHanger !== 'schroef') {
    const L = roof.hangerSeat && roof.hangerSeat > 0 ? roof.hangerSeat : 0.07;
    const H = roof.hangerHeight && roof.hangerHeight > 0 ? roof.hangerHeight : 0.75 * h;
    const kind = roof.backHanger;
    // Level seat: from the end's bottom corner level into the rafter, then a heel down to its underside.
    back.hanger = { kind, seat: L, heel: kind === 'vlak' ? L * Math.tan(a) : 0, bottom: undersideAt(b1), height: H };
    const above = undersideAt(b1) + H - zb;
    if (above > 0.001) warnings.push(`Balkdrager: steekt ${Math.round(above * 1000)} mm boven de ligger uit (drager ${Math.round(H * 1000)} mm hoog). Kies een lagere balkdrager of zet de spoor lager.`);
    if (H < 0.6 * h - 1e-9) warnings.push(`Balkdrager: ${Math.round(H * 1000)} mm hoog is minder dan 60% van de spoor (${Math.round(h * 1000)} mm); kies er een die hoger is.`);
  }
  if (through && offset <= 0.005) warnings.push('Ligger tegen gebouw: zet de bovenkant van de spoor boven de ligger (bijvoorbeeld 30 mm), anders is er geen neus die tot de muur doorloopt.');
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
    if (st.tooDeep) warnings.push(`${st.name}: een keep van ${Math.round(st.depth * 1000)} mm is dieper dan ${roof.notchFraction === 0.25 ? '1/4' : '1/3'} van de spoor (${Math.round(roof.notchFraction * h * 1000)} mm); er blijft ${Math.round(st.left * 1000)} mm over. Reken de spoor na of maak de keep minder diep.`);
  }

  // A pocket takes wood out of the beam: a beam that spans between posts keeps at least 3/4.
  if (fPocket > roof.beamHeight / 4 + 1e-9) warnings.push(`Voorligger: een inkeping van ${Math.round(fPocket * 1000)} mm is meer dan 1/4 van de ligger (${Math.round(roof.beamHeight * 1000)} mm); de ligger overspant tussen de staanders, reken hem na.`);
  if (bPocket > 0) {
    const bh = plan.attached ? roof.backBeamHeight : roof.beamHeight;
    if (bh && bPocket >= bh) throw new RangeError('De inkeping in de ligger achter is dieper dan de ligger hoog is.');
    if (bh && !plan.attached && bPocket > bh / 4 + 1e-9) warnings.push(`Achterligger: een inkeping van ${Math.round(bPocket * 1000)} mm is meer dan 1/4 van de ligger; reken hem na.`);
    if (bh && plan.attached && bPocket > bh / 2 + 1e-9) warnings.push(`Ligger tegen gebouw: een inkeping van ${Math.round(bPocket * 1000)} mm is meer dan de helft van de ligger; houd genoeg hout over voor de bevestiging aan de muur.`);
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

/**
 * Outline of a rafter in the side section (x = s, y = height): top edge, front plumb cut, the
 * underside with its notches (heel, seat and, housed, the uphill cut), and the back end. Used for
 * the section, the rafter laid flat to saw from, and the 3D construction.
 */
export function rafterOutline(r: Rafter, depth: number, h: number): { x: number; y: number }[] {
  const a = (r.pitch * Math.PI) / 180;
  const [back, front] = r.seats;
  const zu = r.undersideAt;
  const top = (s: number) => zu(s) + h / Math.cos(a);
  const S0 = r.start;
  const D = depth;
  /** A notch along the underside, walking from the front to the back: heel, seat, and (housed) the uphill cut. */
  const notch = (st: Seat) => [
    { x: st.s1, y: zu(st.s1) },
    { x: st.s1, y: st.floor },
    { x: st.s1 - st.length, y: st.floor },
    ...(st.housed ? [{ x: st.s0, y: zu(st.s0) }] : []),
  ];
  return [
    { x: S0, y: top(S0) },
    { x: D, y: top(D) },
    { x: D, y: zu(D) },
    ...notch(front),
    // Against the beam: no notch; with a nose to the wall the seat on the beam reaches the end.
    ...(back.through ? [{ x: back.s1, y: zu(back.s1) }, { x: back.s1, y: back.z }, { x: S0, y: back.z }] : back.against ? [] : notch(back)),
    // In a hanger with a level seat: a small level cut at the end, with a heel.
    ...(back.hanger?.kind === 'vlak' ? [{ x: S0 + back.hanger.seat, y: zu(S0 + back.hanger.seat) }, { x: S0 + back.hanger.seat, y: zu(S0) }] : []),
    ...(back.through ? [] : [{ x: S0, y: zu(S0) }]),
  ].filter((p, i, arr) => i === 0 || Math.hypot(p.x - arr[i - 1].x, p.y - arr[i - 1].y) > 1e-6);
}

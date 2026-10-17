/**
 * Drawings of an afdak: from above, to set out the posts and footings (centre of every post,
 * spacings, distances from the wall and the diagonals), and the rafter: the side section with
 * the beams and posts, and the rafter laid flat with its end cuts and seat notches, to saw from.
 */
import { Point } from '../geometry/geometry';
import { rafterOutline } from '../geometry/afdak';
import { AfdakOutcome } from '../model/compute-afdak';
import { panelNote, panelTable, SheetMeta, sheetWithPanel, sheetWithViews } from './sheet';
import { Prim, View } from './vector';

const mm = (m: number) => String(Math.round(m * 1000));
const deg = (d: number) => `${d.toFixed(1).replace('.', ',')}°`;
const WOOD = 'rgb(226,204,160)';
const rect = (x0: number, y0: number, x1: number, y1: number): Point[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
const ALIGN = { midden: 'midden', voor: 'voorkant gelijk', achter: 'achterkant gelijk' };
const SIDE_NAMES = { links: 'Links', rechts: 'Rechts', voor: 'Voor', achter: 'Achter' };

/** From above: building at the top, front at the bottom; y = depth − distance from the wall. */
export function afdakPlanView(o: AfdakOutcome): View {
  const { plan, rafters } = o;
  const W = plan.width;
  const D = plan.depth;
  const y = (s: number) => D - s;
  const prims: Prim[] = [];

  if (plan.attached) {
    const x0 = plan.wallOffset !== null ? -plan.wallOffset : -0.3;
    prims.push({ t: 'poly', rings: [rect(x0, D, W + 0.3, D + 0.25)], cls: 'wall' });
    prims.push({ t: 'text', at: { x: (Math.max(x0, -0.3) + W) / 2, y: D + 0.125 }, text: 'gebouw', cls: 'label on-dark', size: 2.4 });
    if (plan.wallOffset !== null && plan.wallOffset > 0.001) {
      prims.push({ t: 'dim', a: { x: x0, y: D + 0.25 }, b: { x: 0, y: D + 0.25 }, off: 6, text: mm(plan.wallOffset) });
    }
  }
  // Roof edge.
  prims.push({ t: 'line', pts: rect(0, 0, W, D), cls: 'roof-line', closed: true });
  // Rafters and beams (thin), walls, footings, posts.
  if (rafters) {
    const rw = o.rafterWidth ?? 0.05;
    for (const x of rafters.xs) prims.push({ t: 'line', pts: rect(x - rw / 2, 0, x + rw / 2, D), cls: 'sym-thin', closed: true });
    for (const st of rafters.seats) prims.push({ t: 'line', pts: rect(0, y(st.s1), W, y(st.s0)), cls: 'sym', closed: true });
  }
  for (const w of plan.walls) prims.push({ t: 'poly', rings: [rect(w.x0, y(w.s1), w.x1, y(w.s0))], cls: 'wall' });
  const pw = plan.postWidth;
  const pd = plan.postDepth;
  for (const p of plan.posts) {
    const c = { x: p.x, y: y(p.s) };
    if (plan.footing) prims.push({ t: 'line', pts: rect(c.x - plan.footing / 2, c.y - plan.footing / 2, c.x + plan.footing / 2, c.y + plan.footing / 2), cls: 'sym-thin', closed: true });
    prims.push({ t: 'poly', rings: [rect(c.x - pw / 2, c.y - pd / 2, c.x + pw / 2, c.y + pd / 2)], cls: 'wall' });
    // Centre cross, past the post so it can be seen and set out.
    const r = Math.max(pw, pd) / 2 + 0.12;
    prims.push({ t: 'line', pts: [{ x: c.x - r, y: c.y }, { x: c.x + r, y: c.y }], cls: 'sym' }, { t: 'line', pts: [{ x: c.x, y: c.y - r }, { x: c.x, y: c.y + r }], cls: 'sym' });
    prims.push({ t: 'text', at: c, text: p.name, cls: 'label', size: 2.3, dx: 3.2, dy: 2.4, anchor: 'start' });
  }
  // Marks on the wall, straight behind the outer front posts.
  for (const m of plan.wallMarks) {
    prims.push({ t: 'line', pts: [{ x: m.x, y: D - 0.1 }, { x: m.x, y: D + 0.1 }], cls: 'sym' });
    prims.push({ t: 'text', at: { x: m.x, y: D }, text: m.label, cls: 'label', size: 2.3, dx: 1.5, dy: -2.4, anchor: 'start' });
  }
  // Diagonals, with their length a third of the way along (so the two labels do not meet in the middle).
  plan.diagonals.forEach((d, i) => {
    const a = { x: d.from.x, y: y(d.from.s) };
    const b = { x: d.to.x, y: y(d.to.s) };
    prims.push({ t: 'line', pts: [a, b], cls: 'sym-thin' });
    const t = i === 0 ? 0.3 : 0.7;
    let angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    if (angle > 90) angle -= 180;
    if (angle < -90) angle += 180;
    prims.push({ t: 'text', at: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, text: `${d.from.label}–${d.to.label} ${mm(d.length)}`, cls: 'dim-text', size: 2.4, angle, dy: 1.8 });
  });

  // Along the front: edge, post centres, edge; and the width.
  const front = plan.posts.filter((p) => p.row === 'voor');
  const xs = [0, ...front.map((p) => p.x), W];
  for (let i = 0; i + 1 < xs.length; i++) if (xs[i + 1] - xs[i] > 0.0005) prims.push({ t: 'dim', a: { x: xs[i], y: 0 }, b: { x: xs[i + 1], y: 0 }, off: -6, text: mm(xs[i + 1] - xs[i]) });
  prims.push({ t: 'dim', a: { x: 0, y: 0 }, b: { x: W, y: 0 }, off: -13, text: mm(W) });
  // Along the right side: front edge, front post centre, back post centre, wall or back edge.
  const ss = [D, plan.frontRow, ...(plan.backRow !== null ? [plan.backRow] : []), 0].map(y).sort((a, b) => a - b);
  for (let i = 0; i + 1 < ss.length; i++) if (ss[i + 1] - ss[i] > 0.0005) prims.push({ t: 'dim', a: { x: W, y: ss[i] }, b: { x: W, y: ss[i + 1] }, off: -6, text: mm(ss[i + 1] - ss[i]) });
  prims.push({ t: 'dim', a: { x: W, y: 0 }, b: { x: W, y: D }, off: -13, text: mm(D) });
  return { prims, title: 'Afdak van bovenaf: hart staanders en diagonalen', scalable: true };
}

/** Side section (back left, front right) with the beams, posts and rafter, and the rafter laid flat. */
/** Layers on the rafters (decking, battens, tiles) in the section's coordinates: x = s, y = height. */
export type AfdakLayer = { name: string; pts: Point[] };

export function afdakRafterView(o: AfdakOutcome, layers: AfdakLayer[] = []): View | null {
  const parts = afdakRafterParts(o, layers);
  if (!parts) return null;
  // On screen: both in one drawing, the rafter under the section.
  const shift = Math.min(0, ...parts.section.prims.flatMap((p) => (p.t === 'poly' ? p.rings.flat().map((q) => q.y) : []))) - 1.2;
  const moved = parts.detail.prims.map((p) => movePrim(p, shift - parts.detailTop));
  return { prims: [...parts.section.prims, ...moved], title: 'Spoor: doorsnede en zaagtekening', scalable: true };
}

function shiftPrim(p: Prim, dx: number): Prim {
  const m = (q: Point) => ({ x: q.x + dx, y: q.y });
  switch (p.t) {
    case 'poly':
      return { ...p, rings: p.rings.map((r) => r.map(m)) };
    case 'line':
      return { ...p, pts: p.pts.map(m) };
    case 'segs':
      return { ...p, segs: p.segs.map(([a, b]) => [m(a), m(b)] as [Point, Point]) };
    case 'text':
      return { ...p, at: m(p.at) };
    case 'dim':
      return { ...p, a: m(p.a), b: m(p.b) };
  }
}

function movePrim(p: Prim, dy: number): Prim {
  const m = (q: Point) => ({ x: q.x, y: q.y + dy });
  switch (p.t) {
    case 'poly':
      return { ...p, rings: p.rings.map((r) => r.map(m)) };
    case 'line':
      return { ...p, pts: p.pts.map(m) };
    case 'segs':
      return { ...p, segs: p.segs.map(([a, b]) => [m(a), m(b)] as [Point, Point]) };
    case 'text':
      return { ...p, at: m(p.at) };
    case 'dim':
      return { ...p, a: m(p.a), b: m(p.b) };
  }
}

/** The section and the rafter detail as separate views (printed at their own scales). */
export function afdakRafterParts(o: AfdakOutcome, layers: AfdakLayer[] = []): { section: View; detail: View; detailTop: number } | null {
  const { plan, rafters: r } = o;
  if (!r) return null;
  const prims: Prim[] = [];
  const D = plan.depth;
  const a = (r.pitch * Math.PI) / 180;
  const h = o.rafterHeight!;
  const [back, front] = r.seats;
  const zu = r.undersideAt;
  const top = (s: number) => zu(s) + h / Math.cos(a);
  // Back end: the wall or back edge, or the face of the beam the rafter is fixed against.
  const S0 = r.start;

  const outline = rafterOutline(r, D, h);

  // --- Section ---
  prims.push({ t: 'line', pts: [{ x: -0.4, y: 0 }, { x: D + 0.4, y: 0 }], cls: 'ground' });
  if (plan.attached) prims.push({ t: 'poly', rings: [rect(-0.25, 0, 0, Math.max(r.backHeight, top(0)) + 0.3)], cls: 'wall' });
  const pd = plan.postDepth;
  const bh = o.beamHeight!;
  const post = (s: number, height: number) => prims.push({ t: 'poly', rings: [rect(s - pd / 2, 0, s + pd / 2, height)], cls: 'f', fill: 'rgb(200,178,138)' });
  post(plan.frontRow, r.frontPost);
  if (plan.backRow !== null && r.backPost !== null) post(plan.backRow, r.backPost);
  prims.push({ t: 'poly', rings: [rect(front.s0, front.z - bh, front.s1, front.z)], cls: 'f', fill: 'rgb(200,178,138)' });
  const backBeam = plan.attached ? (o.backBeamHeight ?? Math.min(bh, 0.15)) : bh;
  prims.push({ t: 'poly', rings: [rect(back.s0, back.z - backBeam, back.s1, back.z)], cls: 'f', fill: 'rgb(200,178,138)' });
  // Pockets in the beams: the level bottom of the cut, seen through the rafter's side.
  for (const st of [front, back]) if (st.pocket > 1e-6) prims.push({ t: 'line', pts: [{ x: st.s0, y: st.floor }, { x: st.s1, y: st.floor }], cls: 'sym-thin' });
  prims.push({ t: 'poly', rings: [outline], cls: 'f', fill: WOOD });
  // A joist hanger: its back plate on the face of the beam and its seat under the rafter.
  if (back.hanger) {
    const hg = back.hanger;
    const seatEnd = hg.kind === 'vlak' ? { x: back.s1 + hg.seat, y: hg.bottom } : { x: back.s1 + hg.seat, y: zu(back.s1 + hg.seat) };
    prims.push({ t: 'line', pts: [{ x: back.s1, y: hg.bottom + hg.height }, { x: back.s1, y: hg.bottom }, seatEnd], cls: 'ground' });
  }
  // The roof build-up on the rafters: decking, counter battens, battens, tiles.
  for (const l of layers) prims.push({ t: 'line', pts: l.pts, cls: l.name === 'Bovenkant pannen' ? 'sym' : 'sym-thin' });
  const tilesTop = layers.find((l) => l.name === 'Bovenkant pannen');
  if (tilesTop) {
    const lo = tilesTop.pts.reduce((m, p) => (p.x > m.x ? p : m), tilesTop.pts[0]);
    prims.push({ t: 'dim', a: { x: D + 0.5, y: 0 }, b: { x: D + 0.5, y: lo.y }, off: -6, text: mm(lo.y) });
  }
  // Heights: front beam, back support, and the posts.
  const xl = -0.4;
  prims.push({ t: 'dim', a: { x: D + 0.2, y: 0 }, b: { x: D + 0.2, y: front.z }, off: -6, text: mm(front.z) });
  prims.push({ t: 'dim', a: { x: xl, y: 0 }, b: { x: xl, y: back.z }, off: 6, text: mm(back.z) });
  prims.push({ t: 'text', at: { x: plan.frontRow, y: r.frontPost / 2 }, text: `staander ${mm(r.frontPost)}`, cls: 'label-sub', size: 2.2, angle: 90 });
  if (plan.backRow !== null && r.backPost !== null) prims.push({ t: 'text', at: { x: plan.backRow, y: r.backPost / 2 }, text: `staander ${mm(r.backPost)}`, cls: 'label-sub', size: 2.2, angle: 90 });
  prims.push({ t: 'text', at: { x: front.s1, y: front.z }, text: deg(r.pitch), cls: 'label-sub', size: 2.4, dx: 3, dy: 3.5, anchor: 'start' });
  // Horizontal: back face to the beams and the front edge.
  const hs = [...new Set([0, back.s1, front.s0, front.s1, D].map((v) => Math.round(v * 1e6) / 1e6))].sort((p, q) => p - q);
  for (let i = 0; i + 1 < hs.length; i++) prims.push({ t: 'dim', a: { x: hs[i], y: 0 }, b: { x: hs[i + 1], y: 0 }, off: -6, text: mm(hs[i + 1] - hs[i]) });

  const section: View = { prims: [...prims], title: 'Doorsnede', scalable: true };
  prims.length = 0;

  // --- Rafter laid flat: u along the rafter from the back end (underside), v up. ---
  const z0 = zu(S0);
  const toUV = (p: Point): Point => ({ x: (p.x - S0) * Math.cos(a) - (p.y - z0) * Math.sin(a), y: (p.x - S0) * Math.sin(a) + (p.y - z0) * Math.cos(a) });
  const base = 0;
  const flat = (p: Point): Point => {
    const q = toUV(p);
    return { x: q.x, y: q.y + base };
  };
  prims.push({ t: 'poly', rings: [outline.map(flat)], cls: 'f', fill: WOOD });
  prims.push({ t: 'text', at: flat({ x: D / 2, y: top(D / 2) }), text: `spoor ${mm(o.rafterWidth!)} × ${mm(h)}, ${r.xs.length} stuks`, cls: 'label', size: 2.6, dy: 12 });
  // Length on both edges (plumb cuts: the top corner lies h·tan a back from the bottom one).
  const bl = flat({ x: S0, y: zu(S0) });
  const br = flat({ x: D, y: zu(D) });
  const tl = flat({ x: S0, y: top(S0) });
  const tr = flat({ x: D, y: top(D) });
  prims.push({ t: 'dim', a: tl, b: tr, off: 7, text: mm(tr.x - tl.x) });
  // Underside chain: back end, back notch, front notch, front end.
  const seatMarks = (st: typeof front) => [st.s1 - st.length, st.s1];
  const marks = [S0, ...(back.through ? [back.s1] : back.against ? [] : seatMarks(back)), ...seatMarks(front), D]
    .map((s) => flat({ x: s, y: zu(s) }).x)
    .filter((v, i, arr) => i === 0 || v - arr[i - 1] > 0.0005);
  for (let i = 0; i + 1 < marks.length; i++) prims.push({ t: 'dim', a: { x: marks[i], y: bl.y }, b: { x: marks[i + 1], y: bl.y }, off: -6, text: mm(marks[i + 1] - marks[i]) });
  prims.push({ t: 'dim', a: bl, b: br, off: -13, text: mm(br.x - bl.x) });
  // Each notch: seat length and plumb cut, and the depth square to the rafter.
  for (const st of [back, front]) {
    if (st.length < 1e-4) continue;
    const c = flat({ x: st.s1 - st.length, y: st.floor });
    const i = flat({ x: st.s1, y: st.floor });
    const b = flat({ x: st.s1, y: zu(st.s1) });
    prims.push({ t: 'line', pts: [c, i, b, ...(st.housed ? [flat({ x: st.s0, y: zu(st.s0) })] : [])], cls: 'sym' });
    // Seat and plumb cut sizes at the notch, and the depth square to the rafter.
    prims.push({ t: 'dim', a: c, b: i, off: 4, text: mm(st.length), ext: false });
    const text = st.through
      ? `${st.name.toLowerCase()}: kops ertegen ${mm(st.plumb)} hoog, neus ${mm(st.left)} dik over ${mm(st.length)} tot de muur`
      : `${st.name.toLowerCase()}: zit ${mm(st.length)}, keep ${mm(st.depth)} diep${st.housed ? ` (ingekeept, loodsneden ${mm(st.plumb)} en ${mm(st.upPlumb ?? 0)})` : ''}, ${mm(st.left)} over${st.pocket > 0 ? `; ligger ${mm(st.pocket)} ingekeept` : ''}`;
    prims.push({ t: 'text', at: { x: i.x, y: base }, text, cls: 'label-sub', size: 2.1, dy: -20 - (st === back ? 0 : 3.4), anchor: 'middle' });
  }
  // A hanger with a level seat: the small level cut at the rafter's end, and its heel.
  if (back.hanger?.kind === 'vlak') {
    const hg = back.hanger;
    const c0 = flat({ x: S0, y: zu(S0) });
    const c1 = flat({ x: S0 + hg.seat, y: zu(S0) });
    const c2 = flat({ x: S0 + hg.seat, y: zu(S0 + hg.seat) });
    prims.push({ t: 'line', pts: [c0, c1, c2], cls: 'sym' });
    prims.push({ t: 'dim', a: c0, b: c1, off: 4, text: mm(hg.seat), ext: false });
    prims.push({ t: 'text', at: { x: c1.x, y: base }, text: `balkdrager: vlakke zit ${mm(hg.seat)}, hiel ${mm(hg.heel)}`, cls: 'label-sub', size: 2.1, dy: -20 - 6.8, anchor: 'start' });
  }
  // End cuts; against the beam the back cut is the face that is screwed to it.
  const backCut = back.through
    ? `loodsnede ${deg(90 - r.pitch)} tegen de muur`
    : back.against
      ? `loodsnede ${deg(90 - r.pitch)}, ${mm(back.plumb)} hoog, ${back.hanger ? 'in de balkdrager' : 'tegen de ligger'}`
      : `loodsnede ${deg(90 - r.pitch)}`;
  prims.push({ t: 'text', at: { x: (tl.x + bl.x) / 2, y: (tl.y + bl.y) / 2 }, text: backCut, cls: 'label-sub', size: 2.1, dx: -2, anchor: 'end' });
  prims.push({ t: 'text', at: { x: (tr.x + br.x) / 2, y: (tr.y + br.y) / 2 }, text: `loodsnede ${deg(90 - r.pitch)}`, cls: 'label-sub', size: 2.1, dx: 2, anchor: 'start' });
  const detail: View = { prims, title: `Zaagtekening spoor ${mm(o.rafterWidth!)} × ${mm(h)}`, scalable: true };
  return { section, detail, detailTop: Math.max(tl.y, tr.y) };
}

/** A4: the plan with a table of the post positions and the set-out measurements. */
export function afdakPlanSheet(o: AfdakOutcome, meta: SheetMeta): string {
  const { plan } = o;
  return sheetWithPanel(afdakPlanView(o), meta, 86, (x, y, w) => {
    let svg = '';
    let yy = y;
    const table = (title: string, rows: string[][], cols?: number[]) => {
      if (!rows.length) return;
      const t = panelTable(x, yy, w, title, rows, cols);
      svg += t.svg;
      yy += t.height + 1;
    };
    const fromWall = plan.attached ? 'uit muur' : 'van achter';
    const off = plan.wallOffset ?? 0;
    table(
      'Staanders (hart)',
      [[`${plan.wallOffset !== null ? 'vanaf hoek gebouw' : 'vanaf links'} →`, 'x', fromWall], ...plan.posts.map((p) => [p.name, mm(p.x + off), mm(p.s)])],
      [16, 18],
    );
    const set: string[][] = [];
    if (plan.spacingFront !== null) set.push(['Hart op hart voor', mm(plan.spacingFront)]);
    if (plan.spacingBack !== null) set.push(['Hart op hart achter', mm(plan.spacingBack)]);
    set.push([plan.attached ? 'Muur tot hart staanders' : 'Hart achter tot hart voor', mm(plan.frontRow - (plan.backRow ?? 0))]);
    for (const m of plan.wallMarks) set.push([`${m.label} op de muur`, `${mm(m.x + off)} ${plan.wallOffset !== null ? 'v. hoek' : 'v. links'}`]);
    for (const d of plan.diagonals) set.push([`Diagonaal ${d.from.label}–${d.to.label}`, mm(d.length)]);
    table('Uitzetten', set, [34]);
    const sizes: string[][] = [['Staander', `${mm(plan.postWidth)} × ${mm(plan.postDepth)}`]];
    if (plan.footing) sizes.push(['Poer', `${mm(plan.footing)} × ${mm(plan.footing)}`]);
    sizes.push(['Afdak', `${mm(plan.width)} × ${mm(plan.depth)}`]);
    for (const wl of plan.walls) sizes.push([`Wand ${SIDE_NAMES[wl.side].toLowerCase()}`, `${mm(Math.max(wl.x1 - wl.x0, wl.s1 - wl.s0))} × ${mm(Math.min(wl.x1 - wl.x0, wl.s1 - wl.s0))}`]);
    table('Maten', sizes, [34]);
    svg += panelNote(
      x,
      yy + 1,
      w,
      plan.attached
        ? 'Zet M1 en M2 uit op de muur, meet de staanders haaks uit de muur, en controleer met de diagonalen: die zijn gelijk als het haaks staat.'
        : 'Zet de hoekstaanders uit en controleer met de diagonalen: die zijn gelijk als het haaks staat.',
    ).svg;
    return svg;
  });
}

/** A4: the rafter section and sawing drawing, with the cuts and heights in a table. */
export function afdakRafterSheet(o: AfdakOutcome, meta: SheetMeta, layers: AfdakLayer[] = []): string | null {
  const parts = afdakRafterParts(o, layers);
  const r = o.rafters;
  if (!parts || !r) return null;
  return sheetWithViews([parts.section, parts.detail], [3, 2], meta, 86, (x, y, w) => {
    let svg = '';
    let yy = y;
    const table = (title: string, rows: string[][], cols?: number[]) => {
      const t = panelTable(x, yy, w, title, rows, cols);
      svg += t.svg;
      yy += t.height + 1;
    };
    table(
      'Sporen',
      [
        ['Aantal', String(r.xs.length)],
        ['Hart op hart', mm(r.spacing)],
        ['Maat', `${mm(o.rafterWidth!)} × ${mm(o.rafterHeight!)}`],
        ['Lengte (beide kanten)', mm(r.length)],
        ['Dakhelling', deg(r.pitch)],
        ['Loodsnede (einden)', `${deg(90 - r.pitch)} op de spoor`],
        ['Zit (vogelbek)', `${deg(r.pitch)} op de spoor`],
        ...(r.seats[0].hanger ? [[`Balkdragers (${r.seats[0].hanger.kind === 'hellend' ? 'kantelbaar' : 'vlakke zit'})`, `${r.xs.length} × ${mm(o.rafterWidth!)} br., ${mm(r.seats[0].hanger.height)} h`]] : []),
      ],
      [34],
    );
    const [back, front] = r.seats;
    const b = (v: string) => (back.against && !back.through ? '–' : v);
    const rows: string[][] = [
      ['', back.through ? 'achter: neus' : back.hanger ? 'achter: drager' : back.against ? 'achter: tegen' : 'achter', 'voor'],
      [back.through ? 'Zit / neus tot de muur' : 'Zit (horizontaal)', b(mm(back.length)), mm(front.length)],
      [back.against ? 'Loodrechte snede (achter: kops)' : 'Loodrechte snede', mm(back.plumb), mm(front.plumb)],
    ];
    if (back.hanger?.kind === 'vlak') rows.push(['Vlakke zit / hiel (drager)', `${mm(back.hanger.seat)} / ${mm(back.hanger.heel)}`, '–']);
    if (back.pocket > 0 || front.pocket > 0) rows.push([`Inkeping ligger (${mm(o.rafterWidth ?? 0)} breed)`, b(back.pocket > 0 ? mm(back.pocket) : '–'), front.pocket > 0 ? mm(front.pocket) : '–']);
    if (back.housed || front.housed) rows.push(['Tweede loodsnede (ingekeept)', back.housed ? mm(back.upPlumb ?? 0) : '–', front.housed ? mm(front.upPlumb ?? 0) : '–']);
    rows.push(
      ['Diepte haaks op spoor', b(mm(back.depth)), mm(front.depth)],
      [back.through ? 'Over (achter: neus dik)' : 'Over boven de keep', b(mm(back.left)), mm(front.left)],
      ['Ligger breed', mm(back.s1 - back.s0), mm(front.s1 - front.s0)],
      ['Ligger op de staander', o.plan.attached ? 'tegen muur' : ALIGN[o.beamAlign], ALIGN[o.beamAlign]],
    );
    table(
      'Kepen',
      rows,
      [20, 16],
    );
    const hrows: string[][] = [
      ['Bovenkant voorligger', mm(r.frontHeight)],
      [o.plan.attached ? 'Bovenkant ligger tegen gebouw' : 'Bovenkant achterligger', mm(r.backHeight)],
      ['Staanders voor (tot onder ligger)', mm(r.frontPost)],
    ];
    if (r.backPost !== null) hrows.push(['Staanders achter', mm(r.backPost)]);
    hrows.push(['Spoor bovenkant voor · achter', `${mm(r.ends.front.top)} · ${mm(r.ends.back.top)}`]);
    const tilesTop = layers.find((l) => l.name === 'Bovenkant pannen');
    if (tilesTop) {
      const byS = [...tilesTop.pts].sort((p, q) => q.x - p.x);
      hrows.push(['Bovenkant pannen voor · achter', `${mm(byS[0].y)} · ${mm(byS[byS.length - 1].y)}`]);
    }
    table('Hoogtes vanaf de vloer', hrows, [30]);
    const fix = back.against
      ? ` Aan de muurkant eindigt de spoor tegen de ligger, bovenkant ${o.backOffset ? `${mm(o.backOffset)} boven` : 'gelijk met'} de ligger: ${
          back.hanger
            ? `in een balkdrager (${back.hanger.kind === 'hellend' ? 'kantelbaar' : 'vlakke zit'}), onderkant drager ${mm(back.hanger.bottom)} vanaf de vloer.`
            : 'schuin schroeven.'
        }`
      : '';
    const note = panelNote(x, yy + 1, w, `Maten langs de onderkant van de spoor, vanaf het achtereind. Keep nooit dieper dan ${o.notch === '4' ? '1/4' : '1/3'} van de spoorhoogte.${fix}`);
    svg += note.svg;
    yy += note.height + 2;
    // What needs attention goes on the sheet too.
    for (const warning of r.warnings) {
      const n = panelNote(x, yy, w, `Let op: ${warning}`);
      svg += n.svg;
      yy += n.height + 1;
    }
    return svg;
  });
}

/** The beams of an afdak, the front one and the back (or wall) one, with their rafter seats. */
function beamsOf(o: AfdakOutcome) {
  const r = o.rafters!;
  const [back, front] = r.seats;
  const bh = o.beamHeight ?? 0;
  const backName = o.plan.attached ? 'Ligger tegen gebouw' : 'Achterligger';
  return [
    { name: 'Voorligger', seat: front, height: bh, row: 'voor' as const },
    { name: backName, seat: back, height: o.plan.attached ? (o.backBeamHeight ?? Math.min(bh, 0.15)) : bh, row: 'achter' as const },
  ];
}

/**
 * A beam from above, its front edge at the bottom: where every rafter comes (and its pocket),
 * measured from the left end of the beam to the left side of the rafter, and the posts under it.
 */
export function afdakBeamView(o: AfdakOutcome, which: 0 | 1): View | null {
  const r = o.rafters;
  if (!r) return null;
  const beam = beamsOf(o)[which];
  const { seat, name } = beam;
  const W = o.plan.width;
  const bw = seat.s1 - seat.s0;
  const rw = o.rafterWidth ?? 0.05;
  const prims: Prim[] = [];
  // y = across the beam, 0 at its front face.
  const y = (s: number) => seat.s1 - s;
  prims.push({ t: 'poly', rings: [rect(0, 0, W, bw)], cls: 'f', fill: 'rgb(200,178,138)' });
  const pocket = seat.pocket > 1e-6;
  const over = Math.max(0.05, bw * 0.4);
  r.xs.forEach((x, i) => {
    const x0 = x - rw / 2;
    const x1 = x + rw / 2;
    if (pocket) prims.push({ t: 'poly', rings: [rect(x0, 0, x1, bw)], cls: 'f', fill: 'rgb(150,120,84)' });
    // The rafter crossing the beam, a little past it on both sides.
    prims.push({ t: 'line', pts: rect(x0, -over, x1, bw + over), cls: 'sym-thin', closed: true });
    prims.push({ t: 'text', at: { x: x0, y: bw + over }, text: mm(x0), cls: 'dim-text', size: 2.3, angle: 90, anchor: 'start', dy: 1.5 });
    prims.push({ t: 'text', at: { x, y: -over }, text: `S${i + 1}`, cls: 'label-sub', size: 2, dy: -2.4 });
  });
  // Posts under this beam (dashed outline), with their centre lines.
  const posts = o.plan.posts.filter((p) => p.row === beam.row);
  const pw = o.plan.postWidth;
  const pd = o.plan.postDepth;
  for (const p of posts) {
    prims.push({ t: 'line', pts: rect(p.x - pw / 2, y(p.s + pd / 2), p.x + pw / 2, y(p.s - pd / 2)), cls: 'roof-line', closed: true });
    prims.push({ t: 'line', pts: [{ x: p.x, y: y(p.s + pd / 2) - 0.06 }, { x: p.x, y: y(p.s - pd / 2) + 0.06 }], cls: 'sym' });
  }
  // Under the beam: post centres and the length.
  const yd = Math.min(0, ...posts.map((p) => y(p.s + pd / 2))) - over;
  const xs = [0, ...posts.map((p) => p.x), W];
  // Clear of the rafter numbers under the beam.
  if (posts.length) for (let i = 0; i + 1 < xs.length; i++) if (xs[i + 1] - xs[i] > 0.0005) prims.push({ t: 'dim', a: { x: xs[i], y: yd }, b: { x: xs[i + 1], y: yd }, off: -8, text: mm(xs[i + 1] - xs[i]) });
  prims.push({ t: 'dim', a: { x: 0, y: yd }, b: { x: W, y: yd }, off: posts.length ? -15 : -8, text: mm(W) });
  // Across: the beam's width.
  prims.push({ t: 'dim', a: { x: W, y: 0 }, b: { x: W, y: bw }, off: -5, text: mm(bw) });
  const what = pocket ? 'inkepingen' : seat.hanger ? 'balkdragers' : seat.against ? 'sporen ertegen' : 'sporen erop';
  return { prims, title: `${name} ${mm(bw)} × ${mm(beam.height)}, van boven: ${what} (maat tot linkerkant spoor)`, scalable: true };
}

/** A pocket in the beam, seen from the front, at a larger scale: its width, depth and the first ones. */
export function afdakPocketView(o: AfdakOutcome, which: 0 | 1): View | null {
  const r = o.rafters;
  if (!r) return null;
  const beam = beamsOf(o)[which];
  const { seat } = beam;
  if (!(seat.pocket > 1e-6)) return null;
  const rw = o.rafterWidth ?? 0.05;
  const h = beam.height;
  const p = seat.pocket;
  // One pocket inside the beam (the outer rafter is flush with the end), with a bit of beam each side.
  const xc = r.xs.length > 2 ? r.xs[1] : r.xs[0];
  const x0 = xc - rw / 2;
  const x1 = xc + rw / 2;
  const a0 = Math.max(0, x0 - 0.1);
  const a1 = Math.min(o.plan.width, x1 + 0.1);
  const outline: Point[] = [{ x: a0, y: 0 }, { x: a1, y: 0 }, { x: a1, y: h }, { x: x1, y: h }, { x: x1, y: h - p }, { x: x0, y: h - p }, { x: x0, y: h }, { x: a0, y: h }];
  const prims: Prim[] = [{ t: 'poly', rings: [outline], cls: 'f', fill: 'rgb(200,178,138)' }];
  prims.push({ t: 'dim', a: { x: x0, y: h }, b: { x: x1, y: h }, off: 5, text: mm(rw) });
  prims.push({ t: 'dim', a: { x: x1, y: h }, b: { x: x1, y: h - p }, off: -5, text: mm(p) });
  prims.push({ t: 'dim', a: { x: a0, y: 0 }, b: { x: a0, y: h }, off: 5, text: mm(h) });
  prims.push({ t: 'text', at: { x: xc, y: 0 }, text: `S${r.xs.indexOf(xc) + 1}, linkerkant op ${mm(x0)} vanaf linkereind`, cls: 'label-sub', size: 2.1, dy: -3 });
  return { prims, title: beam.name, scalable: true };
}

/** A4: both beams from above with every rafter position, the pockets, and a table to mark them out. */
export function afdakBeamSheet(o: AfdakOutcome, meta: SheetMeta): string | null {
  const r = o.rafters;
  if (!r) return null;
  const views: View[] = [];
  const shares: number[] = [];
  for (const i of [0, 1] as const) {
    views.push(afdakBeamView(o, i)!);
    shares.push(2);
  }
  // The pockets side by side in one detail, so it gets a large scale.
  const details = ([0, 1] as const).map((i) => afdakPocketView(o, i)).filter((d): d is View => d !== null);
  if (details.length) {
    const prims: Prim[] = [];
    let x = 0;
    for (const d of details) {
      const xs = d.prims.flatMap((p) => (p.t === 'poly' ? p.rings.flat().map((q) => q.x) : []));
      const min = Math.min(...xs);
      const dx = x - min;
      prims.push(...d.prims.map((p) => shiftPrim(p, dx)));
      prims.push({ t: 'text', at: { x: x + (Math.max(...xs) - min) / 2, y: 0 }, text: d.title ?? '', cls: 'label', size: 2.4, dy: -8 });
      x += Math.max(...xs) - min + 0.25;
    }
    views.push({ prims, title: 'Inkepingen, voorkant van de ligger gezien', scalable: true });
    shares.push(2.4);
  }
  const rw = o.rafterWidth ?? 0.05;
  return sheetWithViews(views, shares, meta, 70, (x, y, w) => {
    let svg = '';
    let yy = y;
    const table = (title: string, rows: string[][], cols?: number[]) => {
      const t = panelTable(x, yy, w, title, rows, cols);
      svg += t.svg;
      yy += t.height + 3;
    };
    table(
      'Sporen op de liggers',
      [['vanaf linkereind', 'linkerkant', 'hart'], ...r.xs.map((c, i) => [`S${i + 1}`, mm(c - rw / 2), mm(c)])],
      [18, 14],
    );
    const posts = o.plan.posts;
    if (posts.length) table('Staanders onder de ligger (hart)', posts.map((p) => [`${p.name} (${p.row})`, mm(p.x)]), [20]);
    const rows: string[][] = [];
    for (const b of beamsOf(o)) {
      const st = b.seat;
      rows.push([`${b.name}`, `${mm(o.plan.width)} lang`]);
      rows.push(['  maat', `${mm(st.s1 - st.s0)} × ${mm(b.height)}`]);
      if (st.pocket > 1e-6) rows.push(['  inkeping per spoor', `${mm(rw)} br. × ${mm(st.pocket)} diep`]);
      else if (st.hanger) {
        rows.push(['  balkdragers', `${r.xs.length} × ${mm(rw)} br.`]);
        rows.push(['  onderkant drager', `${mm(st.hanger.bottom - (st.z - b.height))} boven onderkant ligger`]);
      } else if (st.against) rows.push(['  sporen', 'ertegen, kops']);
      else rows.push(['  sporen', 'erop, met keep']);
    }
    table('Liggers', rows, [28]);
    svg += panelNote(
      x,
      yy,
      w,
      `Meet alle maten vanaf hetzelfde linkereind van de ligger, niet van spoor tot spoor, dan lopen kleine fouten niet op. Sporen ${mm(r.spacing)} hart op hart; de buitenste gelijk met de rand.${
        beamsOf(o).some((b) => b.seat.pocket > 1e-6) ? ' Inkepingen met een vlakke bodem, zo breed als de spoor: zaag de zijkanten in en hak het hout eruit.' : ''
      }`,
    ).svg;
    return svg;
  });
}

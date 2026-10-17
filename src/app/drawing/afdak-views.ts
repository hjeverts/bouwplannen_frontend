/**
 * Drawings of an afdak: from above, to set out the posts and footings (centre of every post,
 * spacings, distances from the wall and the diagonals), and the rafter: the side section with
 * the beams and posts, and the rafter laid flat with its end cuts and seat notches, to saw from.
 */
import { Point } from '../geometry/geometry';
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
export function afdakRafterView(o: AfdakOutcome): View | null {
  const parts = afdakRafterParts(o);
  if (!parts) return null;
  // On screen: both in one drawing, the rafter under the section.
  const shift = Math.min(0, ...parts.section.prims.flatMap((p) => (p.t === 'poly' ? p.rings.flat().map((q) => q.y) : []))) - 1.2;
  const moved = parts.detail.prims.map((p) => movePrim(p, shift - parts.detailTop));
  return { prims: [...parts.section.prims, ...moved], title: 'Spoor: doorsnede en zaagtekening', scalable: true };
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
export function afdakRafterParts(o: AfdakOutcome): { section: View; detail: View; detailTop: number } | null {
  const { plan, rafters: r } = o;
  if (!r) return null;
  const prims: Prim[] = [];
  const D = plan.depth;
  const a = (r.pitch * Math.PI) / 180;
  const h = o.rafterHeight!;
  const [back, front] = r.seats;
  const zu = r.undersideAt;
  const top = (s: number) => zu(s) + h / Math.cos(a);

  // The rafter's outline in the section: top edge, front plumb cut, underside with both notches.
  const outline: Point[] = [
    { x: 0, y: top(0) },
    { x: D, y: top(D) },
    { x: D, y: zu(D) },
    { x: front.s1, y: zu(front.s1) },
    { x: front.s1, y: front.z },
    { x: front.s1 - front.length, y: front.z },
    { x: back.s1, y: zu(back.s1) },
    { x: back.s1, y: back.z },
    { x: back.s1 - back.length, y: back.z },
    { x: 0, y: zu(0) },
  ].filter((p, i, arr) => i === 0 || Math.hypot(p.x - arr[i - 1].x, p.y - arr[i - 1].y) > 1e-6);

  // --- Section ---
  prims.push({ t: 'line', pts: [{ x: -0.4, y: 0 }, { x: D + 0.4, y: 0 }], cls: 'ground' });
  if (plan.attached) prims.push({ t: 'poly', rings: [rect(-0.25, 0, 0, Math.max(r.backHeight, top(0)) + 0.3)], cls: 'wall' });
  const pd = plan.postDepth;
  const bh = o.beamHeight!;
  const post = (s: number, height: number) => prims.push({ t: 'poly', rings: [rect(s - pd / 2, 0, s + pd / 2, height)], cls: 'f', fill: 'rgb(200,178,138)' });
  post(plan.frontRow, r.frontPost);
  if (plan.backRow !== null && r.backPost !== null) post(plan.backRow, r.backPost);
  prims.push({ t: 'poly', rings: [rect(front.s0, front.z - bh, front.s1, front.z)], cls: 'f', fill: 'rgb(200,178,138)' });
  prims.push({ t: 'poly', rings: [rect(back.s0, back.z - (plan.attached ? Math.min(bh, 0.15) : bh), back.s1, back.z)], cls: 'f', fill: 'rgb(200,178,138)' });
  prims.push({ t: 'poly', rings: [outline], cls: 'f', fill: WOOD });
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
  const z0 = zu(0);
  const toUV = (p: Point): Point => ({ x: p.x * Math.cos(a) - (p.y - z0) * Math.sin(a), y: p.x * Math.sin(a) + (p.y - z0) * Math.cos(a) });
  const base = 0;
  const flat = (p: Point): Point => {
    const q = toUV(p);
    return { x: q.x, y: q.y + base };
  };
  prims.push({ t: 'poly', rings: [outline.map(flat)], cls: 'f', fill: WOOD });
  prims.push({ t: 'text', at: flat({ x: D / 2, y: top(D / 2) }), text: `spoor ${mm(o.rafterWidth!)} × ${mm(h)}, ${r.xs.length} stuks`, cls: 'label', size: 2.6, dy: 12 });
  // Length on both edges (plumb cuts: the top corner lies h·tan a back from the bottom one).
  const bl = flat({ x: 0, y: zu(0) });
  const br = flat({ x: D, y: zu(D) });
  const tl = flat({ x: 0, y: top(0) });
  const tr = flat({ x: D, y: top(D) });
  prims.push({ t: 'dim', a: tl, b: tr, off: 7, text: mm(tr.x - tl.x) });
  // Underside chain: back end, back notch, front notch, front end.
  const marks = [0, back.s1 - back.length, back.s1, front.s1 - front.length, front.s1, D]
    .map((s) => flat({ x: s, y: zu(s) }).x)
    .filter((v, i, arr) => i === 0 || v - arr[i - 1] > 0.0005);
  for (let i = 0; i + 1 < marks.length; i++) prims.push({ t: 'dim', a: { x: marks[i], y: bl.y }, b: { x: marks[i + 1], y: bl.y }, off: -6, text: mm(marks[i + 1] - marks[i]) });
  prims.push({ t: 'dim', a: bl, b: br, off: -13, text: mm(br.x - bl.x) });
  // Each notch: seat length and plumb cut, and the depth square to the rafter.
  for (const st of [back, front]) {
    if (st.length < 1e-4) continue;
    const c = flat({ x: st.s1 - st.length, y: st.z });
    const i = flat({ x: st.s1, y: st.z });
    const b = flat({ x: st.s1, y: zu(st.s1) });
    prims.push({ t: 'line', pts: [c, i, b], cls: 'sym' });
    // Seat and plumb cut sizes at the notch, and the depth square to the rafter.
    prims.push({ t: 'dim', a: c, b: i, off: 4, text: mm(st.length), ext: false });
    prims.push({ t: 'text', at: { x: i.x, y: base }, text: `${st.name.toLowerCase()}: zit ${mm(st.length)}, keep ${mm(st.depth)} diep, ${mm(st.left)} over`, cls: 'label-sub', size: 2.1, dy: -20 - (st === back ? 0 : 3.4), anchor: 'middle' });
  }
  // End cuts.
  prims.push({ t: 'text', at: { x: (tl.x + bl.x) / 2, y: (tl.y + bl.y) / 2 }, text: `loodsnede ${deg(90 - r.pitch)}`, cls: 'label-sub', size: 2.1, dx: -2, anchor: 'end' });
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
export function afdakRafterSheet(o: AfdakOutcome, meta: SheetMeta): string | null {
  const parts = afdakRafterParts(o);
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
      ],
      [34],
    );
    const [back, front] = r.seats;
    table(
      'Kepen',
      [
        ['', 'achter', 'voor'],
        ['Zit (horizontaal)', mm(back.length), mm(front.length)],
        ['Loodrechte snede', mm(back.plumb), mm(front.plumb)],
        ['Diepte haaks op spoor', mm(back.depth), mm(front.depth)],
        ['Over boven de keep', mm(back.left), mm(front.left)],
        ['Ligger breed', mm(back.s1 - back.s0), mm(front.s1 - front.s0)],
      ],
      [16, 16],
    );
    const hrows: string[][] = [
      ['Bovenkant voorligger', mm(r.frontHeight)],
      [o.plan.attached ? 'Bovenkant ligger tegen gebouw' : 'Bovenkant achterligger', mm(r.backHeight)],
      ['Staanders voor (tot onder ligger)', mm(r.frontPost)],
    ];
    if (r.backPost !== null) hrows.push(['Staanders achter', mm(r.backPost)]);
    hrows.push(['Spoor bovenkant voor · achter', `${mm(r.ends.front.top)} · ${mm(r.ends.back.top)}`]);
    table('Hoogtes vanaf de vloer', hrows, [30]);
    svg += panelNote(x, yy + 1, w, `Maten langs de onderkant van de spoor, vanaf het achtereind. Keep nooit dieper dan ${o.notch === '4' ? '1/4' : '1/3'} van de spoorhoogte.`).svg;
    return svg;
  });
}

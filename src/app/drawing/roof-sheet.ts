/**
 * Work drawing of a roof truss (spant) on one A4: the section at scale with every measurement
 * needed to build it (span, overhangs, ridge, heights, slope lengths, pitch, the build-up and the
 * batten layout), and tables with the heights per layer, the rafter cuts, the batten layout and
 * the materials.
 */
import { heightOn, roofLine } from '../geometry/buildup';
import { Point } from '../geometry/geometry';
import { DakResult } from '../model/compute';
import { panelTable, SheetMeta, sheetWithPanel } from './sheet';
import { Prim, View } from './vector';

const mm = (m: number) => String(Math.round(m * 1000));
const signed = (m: number) => (Math.round(m * 1000) > 0 ? '+' : '') + mm(m);
const deg = (d: number) => `${d.toFixed(1).replace('.', ',')}°`;
const count = (n: number) => new Intl.NumberFormat('nl-NL').format(n);
const len = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

const TYPE_NAMES = { zadeldak: 'Zadeldak', lessenaarsdak: 'Lessenaarsdak', mansardekap: 'Mansardekap' };
/** The wood of the rafters in the section. */
const WOOD = 'rgb(226,204,160)';

/** The line the rafters are measured on: the top of the rafters with a build-up, else the roof as entered. */
function rafterLine(dak: DakResult): { pts: Point[]; name: string } {
  const bu = dak.buildup;
  const top = bu?.lines.find((l) => l.name === 'Bovenkant spoor / gording');
  if (top) return { pts: top.pts, name: 'bovenkant spoor' };
  return { pts: roofLine(dak.roof), name: 'dakmaat' };
}

/** The line with points added at both walls, so the overhang and the rafter between the walls get their own length. */
function withWalls(pts: Point[], span: number): Point[] {
  const out = [...pts];
  for (const x of [0, span]) {
    if (out.some((p) => Math.abs(p.x - x) < 1e-6) || x < pts[0].x || x > pts[pts.length - 1].x) continue;
    out.push({ x, y: heightOn(pts, x) });
  }
  return out.sort((a, b) => a.x - b.x);
}

/** The section of the roof truss with its dimensions. */
export function roofSectionView(dak: DakResult): View {
  const { roof, buildup: bu, tiles } = dak;
  const prims: Prim[] = [];
  const line = roofLine(roof);
  const span = roof.span;
  const xMin = line[0].x;
  const xMax = line[line.length - 1].x;

  // Floor and walls (outside faces) up to the wall plates; without wall heights short stubs.
  const plateL = roof.plateLeft;
  const plateR = roof.plateRight;
  const under = bu ? bu.lines[0].pts : line;
  const wallTopL = heightOn(under, 0);
  const wallTopR = heightOn(under, span);
  if (roof.fromFloor) {
    prims.push({ t: 'line', pts: [{ x: xMin - 0.3, y: 0 }, { x: xMax + 0.3, y: 0 }], cls: 'ground' });
    prims.push({ t: 'line', pts: [{ x: 0, y: 0 }, { x: 0, y: wallTopL }], cls: 'sym' }, { t: 'line', pts: [{ x: span, y: 0 }, { x: span, y: wallTopR }], cls: 'sym' });
  } else {
    prims.push({ t: 'line', pts: [{ x: 0, y: wallTopL - 0.6 }, { x: 0, y: wallTopL }], cls: 'sym-thin' }, { t: 'line', pts: [{ x: span, y: wallTopR - 0.6 }, { x: span, y: wallTopR }], cls: 'sym-thin' });
  }

  // The rafters (between their underside and top) and the layers on them.
  if (bu) {
    const top = bu.lines.find((l) => l.name === 'Bovenkant spoor / gording') ?? bu.lines[0];
    if (top !== bu.lines[0]) prims.push({ t: 'poly', rings: [[...bu.lines[0].pts, ...[...top.pts].reverse()]], cls: 'f', fill: WOOD });
    else prims.push({ t: 'line', pts: bu.lines[0].pts, cls: 'sym' });
    for (const l of bu.lines.slice(1)) if (l !== top) prims.push({ t: 'line', pts: l.pts, cls: l.name === 'Bovenkant pannen' ? 'sym' : 'sym-thin' });
  } else {
    prims.push({ t: 'line', pts: line, cls: 'ground' });
  }

  // Ridge (and knees): plumb dashed line down to the base.
  const base = roof.fromFloor ? 0 : Math.min(plateL, plateR);
  const peaks = roof.type === 'mansardekap' && roof.knee ? [roof.ridge] : roof.type === 'zadeldak' ? [roof.ridge] : [];
  for (const p of peaks) prims.push({ t: 'line', pts: [p, { x: p.x, y: base }], cls: 'roof-line' });

  // Horizontal: overhangs, walls, ridge, and the totals.
  const yDim = Math.min(base, wallTopL, wallTopR, line[0].y, line[line.length - 1].y);
  const stops = [...new Set([xMin, 0, ...(roof.type === 'zadeldak' ? [roof.ridge.x] : []), ...(roof.knee ? [roof.knee.x, span - roof.knee.x] : []), span, xMax].map((v) => Math.round(v * 1e6) / 1e6))].sort((a, b) => a - b);
  for (let i = 0; i + 1 < stops.length; i++) prims.push({ t: 'dim', a: { x: stops[i], y: yDim }, b: { x: stops[i + 1], y: yDim }, off: -6, text: mm(stops[i + 1] - stops[i]) });
  let row = -13;
  if (stops.length > 3) {
    prims.push({ t: 'dim', a: { x: 0, y: yDim }, b: { x: span, y: yDim }, off: row, text: mm(span) });
    row -= 7;
  }
  if (xMax - xMin > span + 1e-6) prims.push({ t: 'dim', a: { x: xMin, y: yDim }, b: { x: xMax, y: yDim }, off: row, text: mm(xMax - xMin) });

  // Vertical, right of the building: floor (or plate), wall plate and ridge, of the roof as entered.
  const xr = xMax;
  const hs = [...new Set([base, plateR, ...(roof.type === 'lessenaarsdak' ? [plateL] : [roof.ridge.y]), ...(roof.knee ? [roof.knee.y + base] : [])].map((v) => Math.round(v * 1e6) / 1e6))].sort((a, b) => a - b);
  for (let i = 0; i + 1 < hs.length; i++) prims.push({ t: 'dim', a: { x: xr, y: hs[i] }, b: { x: xr, y: hs[i + 1] }, off: -6, text: mm(hs[i + 1] - hs[i]) });
  if (hs.length > 2) prims.push({ t: 'dim', a: { x: xr, y: hs[0] }, b: { x: xr, y: hs[hs.length - 1] }, off: -13, text: mm(hs[hs.length - 1] - hs[0]) });

  // Along the slopes, outside: the rafter lengths (overhang and wall to ridge or knee).
  const rl = rafterLine(dak);
  const along = withWalls(rl.pts, span);
  const outside = bu ? bu.lines[bu.lines.length - 1].pts : line;
  // Offset so the chain clears the layers: their thickness at the drawing's scale is not known
  // here, so the dimension lines go from the outermost line.
  const lift = (p: Point): Point => ({ x: p.x, y: heightOn(outside, p.x) + (p.y - heightOn(rl.pts, p.x)) });
  for (let i = 0; i + 1 < along.length; i++) {
    const a = along[i];
    const b = along[i + 1];
    if (len(a, b) < 0.01) continue;
    prims.push({ t: 'dim', a: lift(a), b: lift(b), off: 6, text: mm(len(a, b)), ext: false });
  }

  // Pitch at each wall plate.
  const pitchAt = (x: number, p: number, anchor: 'start' | 'end') =>
    prims.push({ t: 'text', at: { x, y: heightOn(rl.pts, x) }, text: deg(p), cls: 'label-sub', size: 2.4, anchor, dx: anchor === 'start' ? 2.5 : -2.5, dy: -2.2 });
  pitchAt(0, roof.left.pitch, 'start');
  if (roof.type === 'zadeldak' && roof.right) pitchAt(span, roof.right.pitch, 'end');
  if (roof.type === 'mansardekap' && roof.upper && roof.knee) {
    prims.push({ t: 'text', at: { x: roof.knee.x, y: heightOn(rl.pts, roof.knee.x) }, text: deg(roof.upper.pitch), cls: 'label-sub', size: 2.4, anchor: 'start', dx: 2.5, dy: -2.2 });
  }

  // Battens on one plane (the right one; a lean-to's only one): a tick at every batten and the chain of gauges.
  const battenLine = bu?.lines.find((l) => l.name === 'Bovenkant panlat')?.pts ?? (tiles ? rl.pts : null);
  const plane = tiles?.planes[tiles.planes.length - 1];
  if (battenLine && plane && plane.gauge > 0) {
    const top = battenLine.reduce((best, p) => (p.y > best.y ? p : best), battenLine[0]);
    const end = top === battenLine[battenLine.length - 1] ? battenLine[0] : battenLine[battenLine.length - 1];
    const L = len(top, end);
    const u = { x: (end.x - top.x) / L, y: (end.y - top.y) / L };
    // Outward: away from the inside of the roof.
    const n = u.x > 0 ? { x: -u.y, y: u.x } : { x: u.y, y: -u.x };
    const at = (s: number): Point => ({ x: top.x + u.x * s, y: top.y + u.y * s });
    const marks = [plane.ridgeGap, ...Array.from({ length: plane.spaces }, (_, i) => plane.ridgeGap + (i + 1) * plane.gauge)];
    for (const s of marks) {
      const p = at(s);
      prims.push({ t: 'line', pts: [p, { x: p.x - n.x * 0.05, y: p.y - n.y * 0.05 }], cls: 'sym' });
    }
    // The chain goes on the inside of the plane, under the roof: ridge gap, n × gauge, last gauge.
    const chain: [number, number, string][] = [[0, plane.ridgeGap, mm(plane.ridgeGap)]];
    if (plane.spaces > 0) chain.push([plane.ridgeGap, plane.ridgeGap + plane.spaces * plane.gauge, `${plane.spaces} × ${mm(plane.gauge)}`]);
    chain.push([plane.ridgeGap + plane.spaces * plane.gauge, L, mm(L - plane.ridgeGap - plane.spaces * plane.gauge)]);
    const inward = u.x > 0 ? -1 : 1; // dimension offset is to the left of a→b
    const drop = (p: Point): Point => {
      const z = heightOn(under, p.x);
      return { x: p.x, y: z - (heightOn(battenLine, p.x) - p.y) };
    };
    for (const [s0, s1, text] of chain) if (s1 - s0 > 0.001) prims.push({ t: 'dim', a: drop(at(s0)), b: drop(at(s1)), off: 5 * inward, text, ext: false });
    prims.push({ t: 'text', at: drop(at(L * 0.55)), text: 'panlatten', cls: 'label-sub', size: 2.1, dy: -9 * (u.y < 0 ? 1 : -1) });
  }
  return { prims, title: `Doorsnede spant (${rl.name === 'bovenkant spoor' ? 'spoorlengtes op de bovenkant' : 'maten van het dak'})`, scalable: true };
}

/** The A4 work drawing: section and tables. */
export function roofSheet(dak: DakResult, meta: SheetMeta): string {
  const roofLength = dak.length;
  const view = roofSectionView(dak);
  return sheetWithPanel(view, meta, 92, (x, y, w) => {
    let svg = '';
    let yy = y;
    const table = (title: string, rows: string[][], cols?: number[]) => {
      if (rows.length <= (rows[0]?.[0] === '' ? 1 : 0)) return;
      const t = panelTable(x, yy, w, title, rows, cols);
      svg += t.svg;
      yy += t.height + 1;
    };
    const { roof, buildup: bu, tiles } = dak;

    // The roof.
    const sides = roof.type === 'zadeldak' && roof.right ? [['links', roof.left, roof.overhangLeft], ['rechts', roof.right, roof.overhangRight]] as const : null;
    const rows: string[][] = [['Soort', TYPE_NAMES[roof.type]], ['Overspanning', mm(roof.span)]];
    if (roof.type === 'lessenaarsdak') rows.push(['Hoogteverschil', mm(roof.left.rise)]);
    else rows.push([roof.fromFloor ? 'Nok vanaf vloer' : 'Nok boven muurplaat', mm(roof.ridge.y)]);
    if (roof.fromFloor) rows.push(['Muurplaat links · rechts', `${mm(roof.plateLeft)} · ${mm(roof.plateRight)}`]);
    if (sides) {
      rows.push(['Helling links · rechts', `${deg(sides[0][1].pitch)} · ${deg(sides[1][1].pitch)}`]);
      rows.push(['Overstek links · rechts', `${mm(sides[0][2])} · ${mm(sides[1][2])}`]);
    } else {
      rows.push(['Helling', deg(roof.left.pitch)], ['Overstek links · rechts', `${mm(roof.overhangLeft)} · ${mm(roof.overhangRight)}`]);
      if (roof.upper) rows.push(['Helling bovendak', deg(roof.upper.pitch)]);
    }
    if (roofLength !== null) rows.push(['Daklengte', mm(roofLength)]);
    if (dak.purlinLength !== null) rows.push(['Gordingen, nok, latten', mm(dak.purlinLength)]);
    table('Dak', rows);

    // Rafters: lengths and cuts.
    const rl = rafterLine(dak);
    const pts = withWalls(rl.pts, roof.span);
    // Per rafter: from the wall to the ridge, and from the end of the overhang to the ridge.
    const spoor: string[][] = [['', 'muur–nok', 'met overstek']];
    const on = (x: number): Point => ({ x, y: heightOn(pts, x) });
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (roof.type === 'zadeldak') {
      const ridge = pts.reduce((best, p) => (p.y > best.y ? p : best), pts[0]);
      spoor.push(['Spoor links', mm(len(on(0), ridge)), mm(len(first, ridge))]);
      spoor.push(['Spoor rechts', mm(len(ridge, on(roof.span))), mm(len(ridge, last))]);
    } else if (roof.type === 'lessenaarsdak') {
      spoor[0][1] = 'muur–muur';
      spoor.push(['Spoor', mm(len(on(0), on(roof.span))), mm(len(first, last))]);
    } else if (roof.knee) {
      // Mansard: the lower rafter from the wall to the knee, the upper one from the knee to the ridge.
      spoor[0][1] = 'muur–knik';
      const ridge = pts.reduce((best, p) => (p.y > best.y ? p : best), pts[0]);
      const kneeL = pts.filter((p) => p.x > 1e-6 && p.x < ridge.x - 1e-6).pop()!;
      const kneeR = pts.filter((p) => p.x > ridge.x + 1e-6 && p.x < roof.span - 1e-6)[0];
      spoor.push(['Onderdak links', mm(len(on(0), kneeL)), mm(len(first, kneeL))]);
      spoor.push(['Onderdak rechts', mm(len(kneeR, on(roof.span))), mm(len(kneeR, last))]);
      spoor.push(['Bovendak (knik–nok)', mm(len(kneeL, ridge)), '']);
    }
    const rafterTop = bu?.lines.find((l) => l.name === 'Bovenkant spoor / gording');
    const rafterH = bu && rafterTop ? rafterTop.offset - bu.lines[0].offset : null;
    // Plumb cut (loodsnede) and the seat cut on the wall plate (vogelbek), as angles to the rafter.
    const cut: string[][] = [];
    const plumbLength = (p: number) => (rafterH ? [[`  loodsnede lang`, mm(rafterH / Math.cos((p * Math.PI) / 180))]] : []);
    if (roof.type === 'mansardekap' && roof.upper) {
      const lo = roof.left.pitch;
      const up = roof.upper.pitch;
      cut.push(['Onderdak: vogelbek', `${deg(lo)} op de spoor`], ['Onderdak: snede bij de knik', `${deg(90 - lo)} op de spoor`], ...plumbLength(lo));
      cut.push(['Bovendak: loodsnede nok', `${deg(90 - up)} op de spoor`], ...plumbLength(up));
    } else {
      const pitches = roof.type === 'zadeldak' && roof.right ? [roof.left.pitch, roof.right.pitch] : [roof.left.pitch];
      [...new Set(pitches.map((p) => Math.round(p * 10) / 10))].forEach((p, i, all) => {
        const name = all.length > 1 ? (i === 0 ? ' links' : ' rechts') : '';
        cut.push([`Loodsnede${name} (${roof.type === 'lessenaarsdak' ? 'einden' : 'nok, eind'})`, `${deg(90 - p)} op de spoor`]);
        cut.push([`Vogelbek${name} (op muurplaat)`, `${deg(p)} op de spoor`], ...plumbLength(p));
      });
    }
    table(`Sporen (${rl.name})`, spoor.length > 1 ? spoor : [], [18, 22]);
    table('Zaagsneden', cut, [36]);

    // Heights per point.
    if (bu) {
      const iUnder = 0;
      const iRafter = bu.lines.findIndex((l) => l.name === 'Bovenkant spoor / gording');
      const iTop = bu.lines.length - 1;
      const head = ['bovenkant →', 'onderk.', ...(iRafter > 0 ? ['spoor'] : []), 'pan'];
      const hrows = [head, ...bu.points.map((p) => [p.label, signed(p.z[iUnder]), ...(iRafter > 0 ? [signed(p.z[iRafter])] : []), signed(p.z[iTop])])];
      table(`Hoogtes (opbouw ${mm(bu.total)})`, hrows, [14, 14, 14]);
    }

    // Batten layout and materials.
    if (tiles && tiles.planes.length) {
      const names = tiles.planes.map((p) => p.label.replace('Dakvlak ', '').replace('Dakvlak', 'vlak'));
      const lat: string[][] = [['', ...names]];
      lat.push(['Latafstand', ...tiles.planes.map((p) => mm(p.gauge))]);
      lat.push(['Bovenste lat tot nok', ...tiles.planes.map((p) => mm(p.ridgeGap))]);
      lat.push(['Laatste latafstand', ...tiles.planes.map((p) => mm(p.eavesGap))]);
      lat.push(['Panlatten + gootlat', ...tiles.planes.map((p) => `${p.battens} + 1`)]);
      lat.push(['Rijen pannen', ...tiles.planes.map((p) => String(p.rows))]);
      table('Latverdeling (langs de spoor)', lat);
      const mat: string[][] = [];
      if (tiles.tiles !== null) mat.push(['Pannen', `${count(tiles.tiles)}${tiles.normalPerRow !== null ? ` (${tiles.normalPerRow} per rij)` : ''}`]);
      if (tiles.vergeTiles) mat.push(['Gevelpannen', count(tiles.vergeTiles)]);
      if (tiles.battenLength !== null) mat.push(['Panlatten', `${(tiles.battenLength).toFixed(1).replace('.', ',')} m`]);
      if (!tiles.counter) mat.push(['Tengels', 'geen, latten op de sporen']);
      else if (tiles.counterBattens !== null && tiles.counterLength !== null) mat.push(['Tengels', `${tiles.counterBattens} st · ${tiles.counterLength.toFixed(1).replace('.', ',')} m`]);
      if (tiles.weight !== null) mat.push(['Gewicht pannen', `${count(Math.round(tiles.weight))} kg`]);
      table('Materiaal', mat, [40]);
    }
    return svg;
  });
}

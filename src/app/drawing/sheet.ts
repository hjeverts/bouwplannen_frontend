/**
 * A4 drawing sheets (landscape, in millimetres) with a title block: one view on a page, or an
 * overview with the 3D view, the floor plan and the four elevations at one common scale.
 */
import { drawingStyle, fit, measure, Placement, renderPrims, SCALES, View } from './vector';

export const A4 = { w: 297, h: 210 };
const MARGIN = 8;
const STRIP = 13;
const CELL_TITLE = 6;

export interface SheetMeta {
  project: string;
  /** What is drawn, e.g. "Plattegrond begane grond". */
  subject: string;
  date?: Date;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function titleBlock(meta: SheetMeta, scale: string): string {
  const y = A4.h - MARGIN - STRIP;
  const x0 = MARGIN;
  const x1 = A4.w - MARGIN;
  const date = (meta.date ?? new Date()).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' });
  const cols = [x0, x0 + 120, x0 + 175, x0 + 220, x1];
  const cell = (i: number, label: string, value: string, size = 3.6) =>
    `<text class="bp-muted" x="${cols[i] + 2}" y="${y + 4}" font-size="2">${esc(label)}</text>` +
    `<text class="${i === 0 ? 'bp-title' : 'bp-label'}" x="${cols[i] + 2}" y="${y + 10}" font-size="${size}">${esc(value)}</text>`;
  return (
    `<rect class="bp-frame" x="${x0}" y="${y}" width="${x1 - x0}" height="${STRIP}"/>` +
    cols.slice(1, -1).map((c) => `<path class="bp-frame-thin" d="M${c} ${y}V${y + STRIP}"/>`).join('') +
    cell(0, 'Project', `${meta.project} · ${meta.subject}`, 4.6) +
    cell(1, 'Schaal (A4)', scale) +
    cell(2, 'Datum', date, 3) +
    cell(3, 'Maten', 'in mm, getekend met Bouwplannen', 2.6)
  );
}

function svgPage(body: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" class="bp bp-sheet" width="${A4.w}mm" height="${A4.h}mm" viewBox="0 0 ${A4.w} ${A4.h}">` +
    `<style>${drawingStyle(1)}</style>` +
    `<rect x="0" y="0" width="${A4.w}" height="${A4.h}" fill="#fff"/>` +
    `<rect class="bp-frame" x="${MARGIN}" y="${MARGIN}" width="${A4.w - 2 * MARGIN}" height="${A4.h - 2 * MARGIN}"/>` +
    body +
    `</svg>`
  );
}

interface Cell {
  x: number;
  y: number;
  w: number;
  h: number;
}

function placeIn(view: View, cell: Cell, scale: number | null): { pl: Placement; denominator: number | null } {
  const inner = { x: cell.x + 3, y: cell.y + CELL_TITLE + 1, w: cell.w - 6, h: cell.h - CELL_TITLE - 4 };
  if (scale === null) {
    const pl = fit(view, inner.w, inner.h, 1);
    return { pl: { ...pl, ox: pl.ox + inner.x, oy: pl.oy + inner.y }, denominator: null };
  }
  const s = 1000 / scale;
  const b = measure(view, { scale: s, k: 1, ox: 0, oy: 0 });
  return {
    pl: { scale: s, k: 1, ox: inner.x + (inner.w - (b.maxX - b.minX)) / 2 - b.minX, oy: inner.y + (inner.h - (b.maxY - b.minY)) / 2 - b.minY },
    denominator: scale,
  };
}

/** Largest standard scale at which every view fits its cell. */
function commonScale(views: View[], cell: Cell): number {
  const w = cell.w - 6;
  const h = cell.h - CELL_TITLE - 4;
  for (const n of SCALES) {
    const ok = views.every((v) => {
      const b = measure(v, { scale: 1000 / n, k: 1, ox: 0, oy: 0 });
      return b.maxX - b.minX <= w && b.maxY - b.minY <= h;
    });
    if (ok) return n;
  }
  return SCALES[SCALES.length - 1];
}

function cellTitle(cell: Cell, title: string, denominator: number | null): string {
  const scale = denominator ? `  1:${denominator}` : '';
  return `<text class="bp-title" x="${cell.x + 3}" y="${cell.y + 4.6}" font-size="4">${esc(title)}<tspan class="bp-muted" font-size="3">${esc(scale)}</tspan></text>`;
}

/** One view on a full A4 page, at the largest standard scale that fits (3D: fitted, no scale). */
export function singleSheet(view: View, meta: SheetMeta): string {
  const cell: Cell = { x: MARGIN, y: MARGIN, w: A4.w - 2 * MARGIN, h: A4.h - 2 * MARGIN - STRIP };
  const denominator = view.scalable === false ? null : commonScale([view], cell);
  const { pl } = placeIn(view, cell, denominator);
  const body = cellTitle(cell, view.title ?? meta.subject, denominator) + renderPrims(view, pl) + titleBlock(meta, denominator ? `1:${denominator}` : 'niet op schaal');
  return svgPage(body);
}

/**
 * Overview on one A4: 3D view and plan on the left, the four elevations on the right,
 * all drawings except the 3D view at the same scale.
 */
export function overviewSheet(views: { view3d: View; plan: View | null; elevations: View[] }, meta: SheetMeta): string {
  const areaW = A4.w - 2 * MARGIN;
  const areaH = A4.h - 2 * MARGIN - STRIP;
  const colW = areaW / 3;
  const rowH = areaH / 2;
  const cells: Cell[] = [0, 1, 2, 3, 4, 5].map((i) => ({ x: MARGIN + (i % 3) * colW, y: MARGIN + Math.floor(i / 3) * rowH, w: colW, h: rowH }));
  // Layout: [3D][voor][rechts] / [plan][achter][links]
  const [c3d, cA, cB, cPlan, cC, cD] = cells;
  const scaled = [...views.elevations, ...(views.plan ? [views.plan] : [])];
  const denominator = commonScale(scaled, cA);
  let body = '';
  // Thin grid lines between the cells.
  for (let i = 1; i < 3; i++) body += `<path class="bp-frame-thin" d="M${MARGIN + i * colW} ${MARGIN}V${MARGIN + areaH}"/>`;
  body += `<path class="bp-frame-thin" d="M${MARGIN} ${MARGIN + rowH}H${MARGIN + areaW}"/>`;

  const put = (view: View | null | undefined, cell: Cell, scale: number | null) => {
    if (!view) return;
    const { pl, denominator: d } = placeIn(view, cell, scale);
    body += cellTitle(cell, view.title ?? '', d) + renderPrims(view, pl);
  };
  put(views.view3d, c3d, null);
  put(views.plan, cPlan, denominator);
  [cA, cB, cC, cD].forEach((c, i) => put(views.elevations[i], c, denominator));
  body += titleBlock(meta, `1:${denominator} (3D niet op schaal)`);
  return svgPage(body);
}

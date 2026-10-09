/**
 * Polygon union, difference and intersection that do not fail on measured input.
 *
 * polygon-clipping can give up on nearly coinciding edges (floating-point noise from rotated rooms).
 * Snapping the coordinates to a fine grid fixes almost all such cases; when it still fails we try a
 * coarser grid, and in the end fall back to something reasonable instead of throwing.
 */
import polygonClipping, { MultiPolygon, Polygon } from 'polygon-clipping';

type Geom = Polygon | MultiPolygon;

const GRIDS = [1e-6, 1e-5, 1e-4];

function isMulti(g: Geom): g is MultiPolygon {
  return Array.isArray(g[0]?.[0]?.[0]);
}

function snap(g: Geom, grid: number): MultiPolygon {
  const multi: MultiPolygon = isMulti(g) ? g : [g as Polygon];
  const r = (v: number) => Math.round(v / grid) * grid;
  return multi
    .map((poly) =>
      poly
        .map((ring) => {
          const out: [number, number][] = [];
          for (const [x, y] of ring) {
            const p: [number, number] = [r(x), r(y)];
            const last = out[out.length - 1];
            if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
          }
          if (out.length && (out[0][0] !== out[out.length - 1][0] || out[0][1] !== out[out.length - 1][1])) out.push([out[0][0], out[0][1]]);
          return out;
        })
        .filter((ring) => ring.length >= 4),
    )
    .filter((poly) => poly.length > 0);
}

function attempt(op: (grid: number) => MultiPolygon, fallback: () => MultiPolygon): MultiPolygon {
  for (const grid of GRIDS) {
    try {
      return op(grid);
    } catch {
      // try a coarser grid
    }
  }
  return fallback();
}

export function union(...geoms: Geom[]): MultiPolygon {
  if (geoms.length === 0) return [];
  return attempt(
    (grid) => {
      const [first, ...rest] = geoms.map((g) => snap(g, grid));
      return polygonClipping.union(first, ...rest);
    },
    () => {
      // One at a time, leaving out a piece that cannot be merged.
      let acc: MultiPolygon = snap(geoms[0], 1e-4);
      for (const g of geoms.slice(1)) {
        try {
          acc = polygonClipping.union(acc, snap(g, 1e-4));
        } catch {
          // skip this piece
        }
      }
      return acc;
    },
  );
}

export function difference(subject: Geom, ...clips: Geom[]): MultiPolygon {
  if (clips.length === 0) return snap(subject, 1e-6);
  return attempt(
    (grid) => polygonClipping.difference(snap(subject, grid), ...clips.map((c) => snap(c, grid))),
    () => snap(subject, 1e-4),
  );
}

export function intersection(a: Geom, ...others: Geom[]): MultiPolygon {
  return attempt(
    (grid) => polygonClipping.intersection(snap(a, grid), ...others.map((c) => snap(c, grid))),
    () => [],
  );
}

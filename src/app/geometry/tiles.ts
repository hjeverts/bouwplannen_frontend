/**
 * Roof tiles on a roof: the battens (panlatten) per roof plane, the counter battens (tengels) and
 * the number of tiles, from the tile's batten gauge (latafstand) and cover width (dekkende breedte).
 *
 * Along each plane, measured on the rafter from the ridge (lessenaarsdak: the high end) down to the
 * end of the rafter at the eaves:
 *   top batten at `ridgeGap` from the ridge, then equal gauges, then the last gauge `eavesGap`
 *   from the lowest batten to the end of the rafter, where the eaves batten (gootlat) is.
 * The gauge is the largest that fits, within [gaugeMin, gauge]. A tile with one fixed gauge cannot
 * always fill the plane exactly: then the last gauge differs from the one asked for, and that
 * difference is reported (to be taken up in the overhang).
 */
import { RoofResult } from './geometry';

export interface TileSpec {
  /** Tile size, for the overlaps (optional). */
  width: number | null;
  length: number | null;
  /** Batten gauge (latafstand): the maximum, or the only one for a tile with a fixed gauge. */
  gauge: number;
  /** Smallest gauge for a tile that can slide (verschuifpan); null = fixed gauge. */
  gaugeMin: number | null;
  /** Cover width (dekkende breedte). */
  cover: number;
  /** From the ridge (top of the rafter) to the top batten, along the slope. */
  ridgeGap: number;
  /** Last gauge: from the lowest batten to the end of the rafter at the eaves. */
  eavesGap: number;
  /** Counter battens, centre to centre (usually on every rafter). */
  counterSpacing: number;
  /** Cover width of the verge tiles (gevelpannen) at the start and the end of the ridge; null = none. */
  vergeStart: number | null;
  vergeEnd: number | null;
  /** Lowest pitch the tile is made for. */
  minPitch: number | null;
  /** kg per tile. */
  weight: number | null;
}

export interface PlaneTiles {
  label: string;
  pitch: number;
  /** Along the slope, ridge to the end of the rafter (with the overhang). */
  slope: number;
  /** Gauge used, equal over the plane. */
  gauge: number;
  /** Number of gauges between the top and the lowest batten. */
  spaces: number;
  ridgeGap: number;
  /** Last gauge as it comes out; `eavesDiff` = that minus the one asked for. */
  eavesGap: number;
  eavesDiff: number;
  /** Battens that carry a row of tiles (top to lowest), and the rows. */
  battens: number;
  rows: number;
  /** Counter battens on this plane (when the roof length is known). */
  counterBattens: number | null;
}

export interface TileResult {
  planes: PlaneTiles[];
  /** Along the ridge: roof length plus the gable overhangs; null when the roof length is not entered. */
  width: number | null;
  /** Per row: normal tiles and verge tiles. */
  normalPerRow: number | null;
  vergePerRow: number;
  /** Width the tiles cover in a row, and that minus `width` (positive = they reach further). */
  covered: number | null;
  widthDiff: number | null;
  tiles: number | null;
  vergeTiles: number | null;
  /** Battens including the eaves batten of each plane, in metres; per plane as a count. */
  battenLength: number | null;
  counterBattens: number | null;
  counterLength: number | null;
  /** Nominal tiles per m² (1 / gauge × cover). */
  perM2: number;
  /** Tiles' weight, kg, and per m² of roof. */
  weight: number | null;
  /** Overlap along the slope (length − gauge) and sideways (width − cover). */
  headLap: number | null;
  sideLap: number | null;
  warnings: string[];
}

const EPS = 1e-9;
/** A last gauge more than this off the one asked for is reported as a warning. */
const TOLERANCE = 0.005;
/** A row this much short of the roof length needs no extra tile (taken up at the verge). */
const ROW_SLACK = 0.01;

const mm = (m: number) => `${Math.round(m * 1000)} mm`;

/** Battens and rows on one plane of `slope` metres. */
export function dividePlane(slope: number, spec: Pick<TileSpec, 'gauge' | 'gaugeMin' | 'ridgeGap' | 'eavesGap'>): Omit<PlaneTiles, 'label' | 'pitch' | 'counterBattens'> {
  const max = spec.gauge;
  const min = Math.min(spec.gaugeMin ?? max, max);
  const span = slope - spec.ridgeGap - spec.eavesGap;
  if (span < -EPS) {
    // Too short for even one row with this ridge and eaves distance: one batten under the ridge.
    return { slope, gauge: 0, spaces: 0, ridgeGap: spec.ridgeGap, eavesGap: slope - spec.ridgeGap, eavesDiff: slope - spec.ridgeGap - spec.eavesGap, battens: 1, rows: 1 };
  }
  // Fewest gauges that are not longer than the maximum: the largest gauge that fits.
  let spaces = Math.max(0, Math.ceil(span / max - EPS));
  let gauge = spaces > 0 ? span / spaces : max;
  if (gauge < min - EPS) {
    // No gauge in the range fills the plane exactly: the last gauge gives. Either one gauge fewer at
    // the largest gauge (last gauge longer), or one more at the smallest (shorter): the one closest
    // to the last gauge asked for.
    const fewer = Math.floor(span / max + EPS);
    const longer = span - fewer * max;
    const shorter = span - (fewer + 1) * min;
    [spaces, gauge] = Math.abs(longer) <= Math.abs(shorter) ? [fewer, max] : [fewer + 1, min];
  }
  const eavesGap = slope - spec.ridgeGap - spaces * gauge;
  return { slope, gauge, spaces, ridgeGap: spec.ridgeGap, eavesGap, eavesDiff: eavesGap - spec.eavesGap, battens: spaces + 1, rows: spaces + 1 };
}

/** Planes of a roof section to lay tiles on: both sides of a gable roof, the one slope of a lean-to. */
function planesOf(roof: RoofResult): { label: string; slope: number; pitch: number }[] {
  if (roof.type === 'lessenaarsdak') return [{ label: 'Dakvlak', slope: roof.left.rafterWithOverhang, pitch: roof.left.pitch }];
  if (roof.type === 'zadeldak' && roof.right) {
    return [
      { label: 'Dakvlak links', slope: roof.left.rafterWithOverhang, pitch: roof.left.pitch },
      { label: 'Dakvlak rechts', slope: roof.right.rafterWithOverhang, pitch: roof.right.pitch },
    ];
  }
  return [];
}

/**
 * Tiles, battens and counter battens of a roof. `width`: length along the ridge including the gable
 * overhangs (purlin length), null when unknown.
 */
export function computeTiles(roof: RoofResult, width: number | null, spec: TileSpec): TileResult {
  const warnings: string[] = [];
  const planes = planesOf(roof).map((p) => {
    const d = dividePlane(p.slope, spec);
    if (spec.minPitch !== null && p.pitch < spec.minPitch - EPS) {
      warnings.push(`${p.label}: de helling (${p.pitch.toFixed(1).replace('.', ',')}°) is flauwer dan het minimum van deze pan (${String(spec.minPitch).replace('.', ',')}°).`);
    }
    if (d.gauge === 0) {
      warnings.push(`${p.label}: het dakvlak (${mm(p.slope)}) is korter dan de afstand bij de nok plus de laatste latafstand.`);
    } else if (Math.abs(d.eavesDiff) > TOLERANCE) {
      // Taken up in the eaves overhang: along the slope by eavesDiff, level by eavesDiff·cos(pitch).
      const level = Math.abs(d.eavesDiff) * Math.cos((p.pitch * Math.PI) / 180);
      warnings.push(
        `${p.label}: met latafstand ${mm(d.gauge)} wordt de laatste latafstand ${mm(d.eavesGap)} in plaats van ${mm(spec.eavesGap)}. ` +
          `Maak de overstek ${mm(level)} ${d.eavesDiff > 0 ? 'korter' : 'langer'} (waterpas gemeten) of schuif de bovenste lat.`,
      );
    }
    const counterBattens = width === null ? null : Math.floor(width / spec.counterSpacing + EPS) + 1;
    return { label: p.label, pitch: p.pitch, ...d, counterBattens };
  });

  let normalPerRow: number | null = null;
  let covered: number | null = null;
  const verges = [spec.vergeStart, spec.vergeEnd].filter((v): v is number => v !== null && v > 0);
  const vergeWidth = verges.reduce((s, v) => s + v, 0);
  if (width !== null) {
    normalPerRow = Math.max(0, Math.ceil((width - vergeWidth - ROW_SLACK) / spec.cover - EPS));
    covered = vergeWidth + normalPerRow * spec.cover;
  }
  const rows = planes.reduce((s, p) => s + p.rows, 0);
  const tiles = normalPerRow === null ? null : rows * normalPerRow;
  const vergeTiles = normalPerRow === null ? null : rows * verges.length;
  // Every plane also has its eaves batten (gootlat).
  const battenCount = planes.reduce((s, p) => s + p.battens + 1, 0);
  const counterBattens = planes.every((p) => p.counterBattens !== null) ? planes.reduce((s, p) => s + (p.counterBattens ?? 0), 0) : null;
  const counterLength = width === null ? null : planes.reduce((s, p) => s + (p.counterBattens ?? 0) * p.slope, 0);
  if (planes.length && width !== null && covered !== null && covered - width > spec.cover / 2) {
    const n = normalPerRow ?? 0;
    warnings.push(
      `Een rij van ${n} pannen reikt ${mm(covered - width)} verder dan het dak lang is; met ${n - 1} kom je ${mm(width - covered + spec.cover)} tekort. ` +
        'Pas de overstek bij de kopgevels daarop aan, of zaag de laatste pan op maat.',
    );
  }
  if (!planes.length) warnings.push('Pannen tellen kan voor een zadeldak en een lessenaarsdak, nog niet voor een mansardekap.');
  return {
    planes,
    width,
    normalPerRow,
    vergePerRow: verges.length,
    covered,
    widthDiff: covered === null || width === null ? null : covered - width,
    tiles,
    vergeTiles,
    battenLength: width === null ? null : battenCount * width,
    counterBattens,
    counterLength,
    perM2: 1 / (spec.gauge * spec.cover),
    weight: tiles === null || spec.weight === null ? null : (tiles + (vergeTiles ?? 0)) * spec.weight,
    headLap: spec.length === null ? null : spec.length - spec.gauge,
    sideLap: spec.width === null ? null : spec.width - spec.cover,
    warnings,
  };
}

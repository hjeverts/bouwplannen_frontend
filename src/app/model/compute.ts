import {
  cornerAngle,
  mansardSection,
  CornerResult,
  GeometryError,
  polygonFromAngles,
  polygonFromDiagonals,
  PolygonAnalysis,
  roofSection,
  RoofResult,
  solveTriangle,
  Triangle,
  TraverseResult,
} from '../geometry/geometry';
import { analyzeRoom, OpeningInput, RoomResult } from '../geometry/room';
import { BuildupResult, computeBuildup } from '../geometry/buildup';
import { computeTiles, TileResult } from '../geometry/tiles';
import { parseAngle, parseLength } from '../geometry/units';
import { BuildupEntry, DakItem, TileEntry, DriehoekItem, HoekItem, MatenItem, VormItem } from './models';

/**
 * Outcome of computing an item:
 * - incomplete: not everything needed is filled in yet (say what is missing, no red error)
 * - error: the input is filled in but wrong (unreadable or geometrically impossible)
 * - ok: the result
 */
export type Outcome<T> = { status: 'incomplete'; message: string } | { status: 'error'; message: string } | { status: 'ok'; value: T };

const incomplete = (message: string) => ({ status: 'incomplete' as const, message });
const error = (message: string) => ({ status: 'error' as const, message });

class InputError extends Error {}

function len(text: string, label: string): number | null {
  const v = parseLength(text);
  if (v !== null && Number.isNaN(v)) throw new InputError(`${label}: "${text}" is geen maat. Gebruik bijvoorbeeld 3,456 of 345 cm.`);
  return v;
}

function ang(text: string, label: string): number | null {
  const v = parseAngle(text);
  if (v !== null && Number.isNaN(v)) throw new InputError(`${label}: "${text}" is geen hoek. Gebruik bijvoorbeeld 37,5.`);
  return v;
}

function guard<T>(fn: () => Outcome<T>): Outcome<T> {
  try {
    return fn();
  } catch (e) {
    if (e instanceof GeometryError || e instanceof InputError) return error(e.message);
    throw e;
  }
}

export function computeHoek(item: HoekItem): Outcome<CornerResult> {
  return guard(() => {
    const a = len(item.a, 'Maat a');
    const b = len(item.b, 'Maat b');
    const c = len(item.c, 'Maat c');
    if (a === null || b === null || c === null) return incomplete('Vul de drie maten in.');
    return { status: 'ok', value: cornerAngle(a, b, c) };
  });
}

export function computeDriehoek(item: DriehoekItem): Outcome<Triangle[]> {
  return guard(() => {
    const input = {
      a: len(item.a, 'Zijde a'),
      b: len(item.b, 'Zijde b'),
      c: len(item.c, 'Zijde c'),
      A: ang(item.A, 'Hoek A'),
      B: ang(item.B, 'Hoek B'),
      C: ang(item.C, 'Hoek C'),
    };
    const filled = Object.values(input).filter((v) => v !== null).length;
    if (filled < 3) return incomplete(`Vul nog ${3 - filled} waarde${filled === 2 ? '' : 'n'} in (minstens één zijde).`);
    return { status: 'ok', value: solveTriangle(input) };
  });
}

export interface VormResult {
  shape: PolygonAnalysis | TraverseResult;
  /** Walls, volume and openings; null until heights are filled in. */
  room: RoomResult | null;
  /** Why there is no room result yet (incomplete heights) or what is wrong with it (error). */
  roomMessage: string | null;
  roomError: boolean;
  /** Doors and windows as entered, also when there is no room result (no heights, or heights from the roof). */
  openings: OpeningInput[];
}

export function computeVorm(item: VormItem): Outcome<VormResult> {
  return guard(() => {
    const n = item.sides.length;
    let shape: PolygonAnalysis | TraverseResult;
    if (item.method === 'diagonalen') {
      const sides = item.sides.map((s, i) => len(s, `Zijde ${i + 1}`));
      const diagonals = item.diagonals.map((d, i) => len(d, `Diagonaal 1–${i + 3}`));
      const missing = sides.filter((v) => v === null).length + diagonals.filter((v) => v === null).length;
      if (missing > 0) return incomplete(`Nog ${missing} ${missing === 1 ? 'maat' : 'maten'} in te vullen.`);
      shape = polygonFromDiagonals(sides as number[], diagonals as number[], item.flips);
    } else {
      const sides = item.sides.map((s, i) => len(s, `Zijde ${i + 1}`));
      const angles = item.angles.map((a, i) => ang(a, `Hoek ${i + 2}`));
      const missing = sides.slice(0, n - 1).filter((v) => v === null).length + angles.filter((v) => v === null).length;
      if (missing > 0) return incomplete(`Nog ${missing} waarde${missing === 1 ? '' : 'n'} in te vullen. De laatste zijde is een controlemaat en mag leeg blijven.`);
      shape = polygonFromAngles(sides, angles as number[]);
    }
    let openings: OpeningInput[] = [];
    try {
      openings = parseOpenings(item);
    } catch {
      // Reported by computeRoom as the room message.
    }
    return { status: 'ok', value: { shape, ...computeRoom(item, shape), openings } };
  });
}

/** Doors and windows that are filled in far enough to use. Throws InputError on an unreadable value. */
function parseOpenings(item: VormItem): OpeningInput[] {
  const openings: OpeningInput[] = [];
  item.openings.forEach((o, i) => {
    const label = o.name || `Opening ${i + 1}`;
    const width = len(o.width, `${label}: breedte`);
    const height = len(o.height, `${label}: hoogte`);
    if (width === null || height === null) return; // not filled in yet
    const wall = o.wall === undefined || o.wall === '' ? null : Number(o.wall);
    openings.push({
      name: o.name,
      wall: wall !== null && Number.isInteger(wall) ? wall : null,
      offset: len(o.offset ?? '', `${label}: afstand vanaf de hoek`),
      width,
      height,
      sill: len(o.sill ?? '', `${label}: borstwering`),
      type: o.type || null,
      swing: o.swing || null,
      hinge: o.hinge || null,
    });
  });
  return openings;
}

/** Room part of a shape. Errors here do not hide the floor plan, so they are returned, not thrown. */
function computeRoom(item: VormItem, shape: PolygonAnalysis): Pick<VormResult, 'room' | 'roomMessage' | 'roomError'> {
  try {
    let heights: number[];
    if (item.heightMode === 'kap') {
      parseOpenings(item); // report unreadable values here already
      return {
        room: null,
        roomMessage: 'De wanden volgen de kap. Hoogtes, inhoud en wandoppervlak staan in de plattegrond waarin deze ruimte onder een kap ligt.',
        roomError: false,
      };
    }
    if (item.heightMode === 'per-hoek') {
      const values = shape.points.map((_, i) => len(item.heights?.[i] ?? '', `Hoogte bij hoekpunt ${i + 1}`));
      const missing = values.filter((v) => v === null).length;
      if (missing === values.length) return { room: null, roomMessage: null, roomError: false };
      if (missing > 0) return { room: null, roomMessage: `Nog ${missing} hoogte${missing === 1 ? '' : 's'} in te vullen.`, roomError: false };
      heights = values as number[];
    } else {
      const h = len(item.height, 'Wandhoogte');
      if (h === null) return { room: null, roomMessage: null, roomError: false };
      heights = [h];
    }
    return { room: analyzeRoom(shape, heights, parseOpenings(item)), roomMessage: null, roomError: false };
  } catch (e) {
    if (e instanceof GeometryError || e instanceof InputError) return { room: null, roomMessage: e.message, roomError: true };
    throw e;
  }
}

export interface DakResult {
  roof: RoofResult;
  /** Length of purlins, ridge and eaves: roof length plus the overhangs at the gable ends. */
  purlinLength: number | null;
  /** Roof surface per slope, including both overhangs, when the roof length is known. */
  surfaceLeft: number | null;
  surfaceRight: number | null;
  /** Tiles, battens and counter battens; null when no tile data is entered. */
  tiles: TileResult | null;
  /** Why the tiles cannot be worked out yet (missing or wrong value); null when they can, or none entered. */
  tilesMessage: string | null;
  /** Heights of the roof layers; null when no layer is entered. */
  buildup: BuildupResult | null;
  buildupMessage: string | null;
}

export function computeDak(item: DakItem): Outcome<DakResult> {
  const r = computeSection(item);
  if (r.status !== 'ok') return r as Outcome<DakResult>;
  let buildup: BuildupResult | null = null;
  let buildupMessage: string | null = null;
  try {
    buildup = buildupOf(item.buildup, r.value.roof);
  } catch (e) {
    if (!(e instanceof GeometryError || e instanceof InputError)) throw e;
    buildupMessage = e.message;
  }
  let tiles: TileResult | null = null;
  let tilesMessage: string | null = null;
  try {
    tiles = tilesOf(item.tiles, r.value, buildup?.battenSlopes);
  } catch (e) {
    if (!(e instanceof GeometryError || e instanceof InputError)) throw e;
    tilesMessage = e.message;
  }
  return { status: 'ok', value: { ...r.value, tiles, tilesMessage, buildup, buildupMessage } };
}

/** Heights of the layers; null when no thickness is entered. */
function buildupOf(entry: BuildupEntry | undefined, roof: RoofResult): BuildupResult | null {
  if (!entry) return null;
  const t = (text: string, label: string) => {
    const v = len(text ?? '', label);
    if (v !== null && v < 0) throw new InputError(`${label} kan niet negatief zijn.`);
    return v ?? 0;
  };
  const spec = {
    reference: entry.reference === 'onder' ? ('onder' as const) : ('boven' as const),
    rafter: t(entry.rafter, 'Hoogte spar / gording'),
    deck: t(entry.deck, 'Dikte dakbeschot'),
    counter: t(entry.counter, 'Dikte tengel'),
    batten: t(entry.batten, 'Dikte panlat'),
    tile: t(entry.tile, 'Dikte pan'),
  };
  if (spec.rafter + spec.deck + spec.counter + spec.batten + spec.tile <= 0) return null;
  return computeBuildup(roof, spec);
}

const NUMBER_RE = /^\s*(\d+(?:[.,]\d+)?)\s*(kg)?\s*$/i;

/** Tiles from the entered tile data; null when nothing is entered. Throws on a missing or wrong value. */
function tilesOf(entry: TileEntry | undefined, dak: Omit<DakResult, 'tiles' | 'tilesMessage' | 'buildup' | 'buildupMessage'>, slopes?: number[]): TileResult | null {
  if (!entry || Object.values(entry).every((v) => !String(v ?? '').trim())) return null;
  const positive = (text: string, label: string) => {
    const v = len(text, label);
    if (v !== null && v <= 0) throw new InputError(`${label} moet groter zijn dan 0.`);
    return v;
  };
  const gauge = positive(entry.gauge, 'Latafstand');
  const cover = positive(entry.cover, 'Dekkende breedte');
  const eavesGap = len(entry.eavesGap, 'Laatste latafstand');
  const missing = [gauge === null && 'de latafstand', cover === null && 'de dekkende breedte', eavesGap === null && 'de laatste latafstand (onderste lat tot het einde van de spar)'].filter(Boolean);
  if (missing.length) throw new InputError(`Vul voor de pannen nog ${missing.join(', ')} in.`);
  const gaugeMin = positive(entry.gaugeMin, 'Kleinste latafstand');
  if (gaugeMin !== null && gaugeMin > gauge!) throw new InputError('De kleinste latafstand is groter dan de latafstand.');
  const weightText = entry.weight?.trim() ?? '';
  const w = NUMBER_RE.exec(weightText);
  if (weightText && !w) throw new InputError(`Gewicht per pan: "${weightText}" is geen getal. Gebruik bijvoorbeeld 2,46.`);
  const minPitch = ang(entry.minPitch ?? '', 'Minimale dakhelling');
  return computeTiles(dak.roof, dak.purlinLength, {
    width: positive(entry.width, 'Breedte pan'),
    length: positive(entry.length, 'Lengte pan'),
    gauge: gauge!,
    gaugeMin,
    cover: cover!,
    ridgeGap: len(entry.ridgeGap, 'Afstand bovenste lat tot nok') ?? 0.035,
    eavesGap: eavesGap!,
    counterSpacing: positive(entry.counterSpacing, 'Tengelafstand') ?? 0.6,
    vergeStart: positive(entry.vergeStart, 'Gevelpan links / voor'),
    vergeEnd: positive(entry.vergeEnd, 'Gevelpan rechts / achter'),
    minPitch,
    weight: w ? Number(w[1].replace(',', '.')) : null,
  }, slopes);
}

function computeSection(item: DakItem): Outcome<Omit<DakResult, 'tiles' | 'tilesMessage' | 'buildup' | 'buildupMessage'>> {
  return guard(() => {
    const mansard = item.roofType === 'mansardekap';
    const span = len(item.span, 'Overspanning');
    const rise = len(item.rise, mansard ? 'Hoogte bovendak' : 'Nokhoogte');
    const pitch = ang(item.pitch, mansard ? 'Helling bovendak' : 'Dakhelling');
    const rafter = len(item.rafter, mansard ? 'Lengte bovendak' : 'Sparlengte');
    const overhang = len(item.overhang, 'Overstek goot');
    const overhangRight = len(item.overhangRight ?? '', 'Overstek goot rechts');
    const length = len(item.length, 'Daklengte');
    const gableOverhang = len(item.gableOverhang ?? '', 'Overstek kopgevel') ?? 0;
    const gableOverhangEnd = len(item.gableOverhangEnd ?? '', 'Overstek andere kopgevel') ?? gableOverhang;
    if (gableOverhang < 0 || gableOverhangEnd < 0) return error('De overstek bij de kopgevels kan niet negatief zijn.');
    if (span === null) return incomplete('Vul de overspanning in.');
    const purlinLength = length === null ? null : length + gableOverhang + gableOverhangEnd;

    if (mansard) {
      const lower = {
        run: len(item.lowerRun ?? '', 'Inzet knik'),
        rise: len(item.lowerRise ?? '', 'Knikhoogte'),
        pitch: ang(item.lowerPitch ?? '', 'Helling onderdak'),
        length: len(item.lowerRafter ?? '', 'Lengte onderdak'),
      };
      const lowerGiven = Object.values(lower).filter((v) => v !== null).length;
      if (lowerGiven < 2) return incomplete(`Vul voor het onderdak nog ${2 - lowerGiven} waarde${lowerGiven === 1 ? '' : 'n'} in.`);
      if ([rise, pitch, rafter].every((v) => v === null)) return incomplete('Vul voor het bovendak de hoogte, helling of lengte in.');
      const roof = mansardSection({ span, lower, upper: { rise, pitch, length: rafter }, overhang, overhangRight });
      const perSide = (s: { rafterWithOverhang: number }) => (purlinLength === null ? null : (s.rafterWithOverhang + roof.upper!.rafter) * purlinLength);
      return { status: 'ok', value: { roof, purlinLength, surfaceLeft: perSide(roof.left), surfaceRight: perSide(roof.right!) } };
    }

    const isGable = item.roofType === 'zadeldak';
    const values = {
      rise,
      pitch,
      rafter,
      pitchRight: isGable ? ang(item.pitchRight ?? '', 'Dakhelling rechts') : null,
      rafterRight: isGable ? len(item.rafterRight ?? '', 'Spar rechts') : null,
      ridgeOffset: isGable ? len(item.ridgeOffset, 'Afstand tot nok') : null,
    };
    const wallLeft = len(item.wallLeft ?? '', 'Muurhoogte links');
    const wallRight = len(item.wallRight ?? '', 'Muurhoogte rechts');
    const given = Object.values(values).filter((v) => v !== null).length;
    const wallsDiffer = wallLeft !== null && wallRight !== null && Math.abs(wallLeft - wallRight) > 1e-9;
    if (given === 0 && !(item.roofType === 'lessenaarsdak' && wallsDiffer)) {
      return incomplete(isGable ? 'Vul twee waarden in, bijvoorbeeld de dakhelling links en rechts.' : 'Vul hoogteverschil, dakhelling of sparlengte in.');
    }
    if (isGable && given === 1 && wallsDiffer && values.ridgeOffset === null) {
      return incomplete('De muren verschillen in hoogte: vul nog een tweede waarde in, zoals de helling aan de andere kant.');
    }
    const roof = roofSection({ type: item.roofType as 'zadeldak' | 'lessenaarsdak', span, wallLeft, wallRight, overhang, overhangRight, ...values });
    return {
      status: 'ok',
      value: {
        roof,
        purlinLength,
        surfaceLeft: purlinLength === null ? null : roof.left.rafterWithOverhang * purlinLength,
        surfaceRight: purlinLength === null || !roof.right ? null : roof.right.rafterWithOverhang * purlinLength,
      },
    };
  });
}

export interface MatenResult {
  values: (number | null)[];
  total: number;
}

export function computeMaten(item: MatenItem): Outcome<MatenResult> {
  return guard(() => {
    const values = item.entries.map((e, i) => len(e.value, e.label || `Maat ${i + 1}`));
    return { status: 'ok', value: { values, total: values.reduce<number>((s, v) => s + (v ?? 0), 0) } };
  });
}

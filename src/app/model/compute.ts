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
import { parseAngle, parseLength } from '../geometry/units';
import { DakItem, DriehoekItem, HoekItem, MatenItem, VormItem } from './models';

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
    return { status: 'ok', value: { shape, ...computeRoom(item, shape) } };
  });
}

/** Room part of a shape. Errors here do not hide the floor plan, so they are returned, not thrown. */
function computeRoom(item: VormItem, shape: PolygonAnalysis): Pick<VormResult, 'room' | 'roomMessage' | 'roomError'> {
  try {
    let heights: number[];
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
    return { room: analyzeRoom(shape, heights, openings), roomMessage: null, roomError: false };
  } catch (e) {
    if (e instanceof GeometryError || e instanceof InputError) return { room: null, roomMessage: e.message, roomError: true };
    throw e;
  }
}

export interface DakResult {
  roof: RoofResult;
  /** Length of purlins, ridge and eaves: roof length plus the overhang at both gable ends. */
  purlinLength: number | null;
  /** Roof surface per slope, including both overhangs, when the roof length is known. */
  surfaceLeft: number | null;
  surfaceRight: number | null;
}

export function computeDak(item: DakItem): Outcome<DakResult> {
  return guard(() => {
    const mansard = item.roofType === 'mansardekap';
    const span = len(item.span, 'Overspanning');
    const rise = len(item.rise, mansard ? 'Hoogte bovendak' : 'Nokhoogte');
    const pitch = ang(item.pitch, mansard ? 'Helling bovendak' : 'Dakhelling');
    const rafter = len(item.rafter, mansard ? 'Lengte bovendak' : 'Sparlengte');
    const overhang = len(item.overhang, 'Overstek goot');
    const length = len(item.length, 'Daklengte');
    const gableOverhang = len(item.gableOverhang ?? '', 'Overstek kopgevels') ?? 0;
    if (gableOverhang < 0) return error('De overstek bij de kopgevels kan niet negatief zijn.');
    if (span === null) return incomplete('Vul de overspanning in.');
    const purlinLength = length === null ? null : length + 2 * gableOverhang;

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
      const roof = mansardSection({ span, lower, upper: { rise, pitch, length: rafter }, overhang });
      const perSide = purlinLength === null ? null : (roof.left.rafterWithOverhang + roof.upper!.rafter) * purlinLength;
      return { status: 'ok', value: { roof, purlinLength, surfaceLeft: perSide, surfaceRight: perSide } };
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
    const roof = roofSection({ type: item.roofType as 'zadeldak' | 'lessenaarsdak', span, wallLeft, wallRight, overhang, ...values });
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

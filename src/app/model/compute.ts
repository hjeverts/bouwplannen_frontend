import {
  cornerAngle,
  CornerResult,
  GeometryError,
  Opening,
  polygonFromAngles,
  polygonFromDiagonals,
  PolygonAnalysis,
  roofSection,
  RoofResult,
  roomTotals,
  RoomTotals,
  solveTriangle,
  Triangle,
  TraverseResult,
} from '../geometry/geometry';
import { parseAngle, parseLength } from '../geometry/units';
import { DakItem, DriehoekItem, HoekItem, Item, MatenItem, VormItem } from './models';

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
  room: RoomTotals;
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
    const height = len(item.height, 'Hoogte');
    const openings: Opening[] = [];
    item.openings.forEach((o, i) => {
      const w = len(o.width, `Opening ${i + 1} breedte`);
      const h = len(o.height, `Opening ${i + 1} hoogte`);
      if (w !== null && h !== null) openings.push({ width: w, height: h });
    });
    return { status: 'ok', value: { shape, room: roomTotals(shape, height, openings) } };
  });
}

export interface DakResult {
  roof: RoofResult;
  /** Roof surface per side incl. overhang, when the roof length is known. */
  surfaceLeft: number | null;
  surfaceRight: number | null;
}

export function computeDak(item: DakItem): Outcome<DakResult> {
  return guard(() => {
    const span = len(item.span, 'Overspanning');
    const rise = len(item.rise, 'Nokhoogte');
    const pitch = ang(item.pitch, 'Dakhelling');
    const rafter = len(item.rafter, 'Sparlengte');
    const ridgeOffset = item.roofType === 'zadeldak' ? len(item.ridgeOffset, 'Afstand tot nok') : null;
    const overhang = len(item.overhang, 'Overstek');
    const length = len(item.length, 'Daklengte');
    if (span === null) return incomplete('Vul de overspanning in.');
    const given = [rise, pitch, rafter].filter((v) => v !== null).length;
    if (given === 0) return incomplete('Vul nokhoogte, dakhelling of sparlengte in.');
    const roof = roofSection({ type: item.roofType, span, rise, pitch, rafter, ridgeOffset, overhang });
    return {
      status: 'ok',
      value: {
        roof,
        surfaceLeft: length === null ? null : roof.left.rafterWithOverhang * length,
        surfaceRight: length === null || !roof.right ? null : roof.right.rafterWithOverhang * length,
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

export function computeItem(item: Item): Outcome<unknown> {
  switch (item.kind) {
    case 'hoek':
      return computeHoek(item);
    case 'driehoek':
      return computeDriehoek(item);
    case 'vorm':
      return computeVorm(item);
    case 'dak':
      return computeDak(item);
    case 'maten':
      return computeMaten(item);
  }
}

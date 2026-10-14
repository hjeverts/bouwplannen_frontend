/**
 * Parsing and formatting of what people type on site.
 * Lengths: a number without a unit is in the project's unit (metres unless the project says cm or
 * mm); "3,456 m", "345,6 cm" and "3456 mm" are always converted. Internally everything is metres.
 * Areas and volumes are always shown in m² and m³.
 */
import { signal } from '@angular/core';

export type LengthUnit = 'm' | 'cm' | 'mm';

/** Metres per unit. */
export const UNIT_FACTOR: Record<LengthUnit, number> = { m: 1, cm: 0.01, mm: 0.001 };

/**
 * Unit for numbers typed without a unit, and for showing lengths: that of the open project.
 * A signal, so results shown on screen follow a change of unit.
 */
export const lengthUnit = signal<LengthUnit>('m');

/** Run `fn` with another unit (export of a project that is not open, tests). */
export function withLengthUnit<T>(unit: LengthUnit, fn: () => T): T {
  const before = lengthUnit();
  lengthUnit.set(unit);
  try {
    return fn();
  } finally {
    lengthUnit.set(before);
  }
}

const LENGTH_RE = /^\s*(-?\d+(?:[.,]\d+)?)\s*(mm|cm|m)?\s*$/i;
const ANGLE_RE = /^\s*(-?\d+(?:[.,]\d+)?)\s*°?\s*$/;

/** Returns metres, null for an empty field, NaN for something that is not a length. */
export function parseLength(text: string | null | undefined): number | null {
  if (text === null || text === undefined || text.trim() === '') return null;
  const m = LENGTH_RE.exec(text);
  if (!m) return NaN;
  const value = Number(m[1].replace(',', '.'));
  const unit = (m[2]?.toLowerCase() as LengthUnit | undefined) ?? lengthUnit();
  return value * UNIT_FACTOR[unit];
}

/** The unit typed with a length ("345 cm" → 'cm'), or null when it has none. */
export function unitOf(text: string | null | undefined): LengthUnit | null {
  const m = LENGTH_RE.exec(text ?? '');
  return (m?.[2]?.toLowerCase() as LengthUnit | undefined) ?? null;
}

/** Returns degrees, null for an empty field, NaN for something that is not an angle. */
export function parseAngle(text: string | null | undefined): number | null {
  if (text === null || text === undefined || text.trim() === '') return null;
  const m = ANGLE_RE.exec(text);
  return m ? Number(m[1].replace(',', '.')) : NaN;
}

const nl = (digits: number) =>
  new Intl.NumberFormat('nl-NL', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/**
 * A length in the project's unit: "3,456 m", "345,6 cm" or "3456 mm". `digits` is the number of
 * decimals in metres; in cm and mm it shrinks accordingly.
 */
export function formatLength(m: number | null | undefined, digits = 3): string {
  if (m === null || m === undefined || !Number.isFinite(m)) return '–';
  return `${formatInUnit(m, digits)} ${lengthUnit()}`;
}

/** The number of a length in the project's unit, without the unit (for a field or a range). */
export function formatInUnit(m: number, digits = 3): string {
  const unit = lengthUnit();
  const d = Math.max(0, digits - (unit === 'cm' ? 2 : unit === 'mm' ? 3 : 0));
  // No thousands separator: "3456 mm", not "3.456 mm" (which reads as metres).
  return new Intl.NumberFormat('nl-NL', { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: false }).format(m / UNIT_FACTOR[unit]);
}

/**
 * A length as a value to type into a field in the given unit, without the unit: metres with three
 * decimals ("3,456"), cm and mm without trailing zeros ("345,6", "3456").
 */
export function lengthInput(m: number, unit: LengthUnit = lengthUnit()): string {
  const v = m / UNIT_FACTOR[unit];
  const f =
    unit === 'm'
      ? new Intl.NumberFormat('nl-NL', { minimumFractionDigits: 3, maximumFractionDigits: 4, useGrouping: false })
      : new Intl.NumberFormat('nl-NL', { minimumFractionDigits: 0, maximumFractionDigits: unit === 'cm' ? 2 : 1, useGrouping: false });
  return f.format(v);
}

export function formatMm(m: number | null | undefined): string {
  if (m === null || m === undefined || !Number.isFinite(m)) return '–';
  // No "-0 mm" for a difference under half a millimetre.
  const v = Math.round(m * 1000);
  return `${nl(0).format(v === 0 ? 0 : v)} mm`;
}

export function formatAngle(deg: number | null | undefined, digits = 1): string {
  return deg === null || deg === undefined || !Number.isFinite(deg) ? '–' : `${nl(digits).format(deg)}°`;
}

export function formatArea(m2: number | null | undefined, digits = 2): string {
  return m2 === null || m2 === undefined || !Number.isFinite(m2) ? '–' : `${nl(digits).format(m2)} m²`;
}

export function formatVolume(m3: number | null | undefined, digits = 2): string {
  return m3 === null || m3 === undefined || !Number.isFinite(m3) ? '–' : `${nl(digits).format(m3)} m³`;
}

export function formatPercent(p: number | null | undefined, digits = 1): string {
  return p === null || p === undefined || !Number.isFinite(p) ? '–' : `${nl(digits).format(p)}%`;
}

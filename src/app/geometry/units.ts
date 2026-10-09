/**
 * Parsing and formatting of what people type on site.
 * Lengths: "3,456" / "3.456" / "3,456 m" are metres, "345,6 cm" and "3456 mm" are converted.
 */

const LENGTH_RE = /^\s*(-?\d+(?:[.,]\d+)?)\s*(mm|cm|m)?\s*$/i;
const ANGLE_RE = /^\s*(-?\d+(?:[.,]\d+)?)\s*°?\s*$/;

/** Returns metres, null for an empty field, NaN for something that is not a length. */
export function parseLength(text: string | null | undefined): number | null {
  if (text === null || text === undefined || text.trim() === '') return null;
  const m = LENGTH_RE.exec(text);
  if (!m) return NaN;
  const value = Number(m[1].replace(',', '.'));
  switch ((m[2] ?? 'm').toLowerCase()) {
    case 'mm':
      return value / 1000;
    case 'cm':
      return value / 100;
    default:
      return value;
  }
}

/** Returns degrees, null for an empty field, NaN for something that is not an angle. */
export function parseAngle(text: string | null | undefined): number | null {
  if (text === null || text === undefined || text.trim() === '') return null;
  const m = ANGLE_RE.exec(text);
  return m ? Number(m[1].replace(',', '.')) : NaN;
}

const nl = (digits: number) =>
  new Intl.NumberFormat('nl-NL', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export function formatLength(m: number | null | undefined, digits = 3): string {
  return m === null || m === undefined || !Number.isFinite(m) ? '–' : `${nl(digits).format(m)} m`;
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

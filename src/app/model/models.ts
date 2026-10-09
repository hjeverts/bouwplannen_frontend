/**
 * Data model. Measurements are stored exactly as typed (strings), so "3,456" stays "3,456"
 * and nothing is lost to rounding. Results are always recomputed from these values.
 */

export type ItemKind = 'hoek' | 'driehoek' | 'vorm' | 'dak' | 'maten';

interface BaseItem {
  id: string;
  kind: ItemKind;
  name: string;
  notes: string;
  updated: string;
}

/** Corner by the three-point method. */
export interface HoekItem extends BaseItem {
  kind: 'hoek';
  a: string;
  b: string;
  c: string;
}

export interface DriehoekItem extends BaseItem {
  kind: 'driehoek';
  a: string;
  b: string;
  c: string;
  A: string;
  B: string;
  C: string;
  /** Which solution to show when the input allows two triangles. */
  solution: number;
}

export interface OpeningEntry {
  name: string;
  width: string;
  height: string;
  /** Wall index as text ('0' = wall 1–2); empty = not placed. Optional: older items lack it. */
  wall?: string;
  /** Distance from the wall's first corner to the near edge of the opening. */
  offset?: string;
  /** Height of the bottom edge above the floor ('0' for a door). */
  sill?: string;
}

/** Any flat shape: floor plan, gable wall, plate. */
export interface VormItem extends BaseItem {
  kind: 'vorm';
  method: 'diagonalen' | 'hoeken';
  sides: string[];
  /** Diagonals from corner 1 to corner 3, 4, ... (method 'diagonalen'). */
  diagonals: string[];
  /** Corner falls back on the other side of the previous diagonal (index = corner index). */
  flips: boolean[];
  /** Interior angles at corner 2 .. n-1 (method 'hoeken'). */
  angles: string[];
  /** Wall height, for rooms. */
  height: string;
  /** 'gelijk': one height for the room; 'per-hoek': a height at every corner (sloped ceiling, ridge). */
  heightMode?: 'gelijk' | 'per-hoek';
  heights?: string[];
  openings: OpeningEntry[];
}

export interface DakItem extends BaseItem {
  kind: 'dak';
  roofType: 'zadeldak' | 'lessenaarsdak' | 'mansardekap';
  span: string;
  /** Rise, pitch and rafter; for a mansard roof these describe the upper part (knee to ridge). */
  rise: string;
  pitch: string;
  rafter: string;
  /** Mansard roof, steep lower part (optional: older saved items do not have them). */
  lowerRun?: string;
  lowerRise?: string;
  lowerPitch?: string;
  lowerRafter?: string;
  ridgeOffset: string;
  /** Zadeldak: right-hand slope (rise/pitch/rafter above describe the left one). Optional for older items. */
  pitchRight?: string;
  rafterRight?: string;
  /** Wall-plate heights from the floor, when the walls differ. */
  wallLeft?: string;
  wallRight?: string;
  /** Horizontal overhang at the eaves (lengthens the rafters). */
  overhang: string;
  /** Overhang past each gable end (lengthens purlins, ridge and the roof surface). */
  gableOverhang?: string;
  /** Length of the roof along the ridge, for roof surface. */
  length: string;
}

export interface MaatEntry {
  label: string;
  value: string;
}

/** Free list of labelled measurements. */
export interface MatenItem extends BaseItem {
  kind: 'maten';
  entries: MaatEntry[];
}

export type Item = HoekItem | DriehoekItem | VormItem | DakItem | MatenItem;

export interface Project {
  id: string;
  name: string;
  created: string;
  updated: string;
  items: Item[];
}

export const KIND_LABELS: Record<ItemKind, string> = {
  hoek: 'Hoek',
  driehoek: 'Driehoek',
  vorm: 'Vorm',
  dak: 'Dak & spant',
  maten: 'Losse maten',
};

export const KIND_HINTS: Record<ItemKind, string> = {
  hoek: 'Hoek bepalen met drie maten vanaf de hoek',
  driehoek: 'Driehoek uit drie bekende waarden',
  vorm: 'Plattegrond, gevel of plaat uit zijden en diagonalen of hoeken',
  dak: 'Dakhelling, sparlengte en gevelvlak',
  maten: 'Lijst met gemeten maten en labels',
};

export function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }
}

export function createItem(kind: ItemKind, name?: string): Item {
  const base = { id: newId(), name: name ?? KIND_LABELS[kind], notes: '', updated: new Date().toISOString() };
  switch (kind) {
    case 'hoek':
      return { ...base, kind, a: '', b: '', c: '' };
    case 'driehoek':
      return { ...base, kind, a: '', b: '', c: '', A: '', B: '', C: '', solution: 0 };
    case 'vorm':
      return {
        ...base,
        kind,
        method: 'diagonalen',
        sides: ['', '', '', ''],
        diagonals: [''],
        flips: [false, false, false, false],
        angles: ['', ''],
        height: '',
        heightMode: 'gelijk',
        heights: ['', '', '', ''],
        openings: [],
      };
    case 'dak':
      return {
        ...base,
        kind,
        roofType: 'zadeldak',
        span: '',
        rise: '',
        pitch: '',
        rafter: '',
        lowerRun: '',
        lowerRise: '',
        lowerPitch: '',
        lowerRafter: '',
        ridgeOffset: '',
        pitchRight: '',
        rafterRight: '',
        wallLeft: '',
        wallRight: '',
        overhang: '',
        gableOverhang: '',
        length: '',
      };
    case 'maten':
      return { ...base, kind, entries: [{ label: '', value: '' }] };
  }
}

/** Resize the per-corner arrays of a shape when the number of corners changes. */
export function resizeVorm(item: VormItem, corners: number): VormItem {
  const n = Math.max(3, Math.min(24, Math.round(corners)));
  const fit = <T>(arr: T[], len: number, fill: T): T[] =>
    arr.length >= len ? arr.slice(0, len) : [...arr, ...Array(len - arr.length).fill(fill)];
  return {
    ...item,
    sides: fit(item.sides, n, ''),
    diagonals: fit(item.diagonals, n - 3, ''),
    flips: fit(item.flips, n, false),
    angles: fit(item.angles, n - 2, ''),
    heights: fit(item.heights ?? [], n, ''),
  };
}

/**
 * Data model. Measurements are stored exactly as typed (strings), so "3,456" stays "3,456"
 * and nothing is lost to rounding. Results are always recomputed from these values.
 */

export type ItemKind = 'hoek' | 'driehoek' | 'vorm' | 'dak' | 'maten' | 'plattegrond';

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
  /** Kind: hinged door, roller door (opens upwards), sliding glass door or window. Empty: from the name. */
  type?: '' | 'deur' | 'roldeur' | 'schuif' | 'raam';
  /** Hinged door: opens into this room or to the other side (outside or the neighbouring room). */
  swing?: '' | 'binnen' | 'buiten';
  /** Hinged door: hinges left or right, seen from the side the door opens towards (DIN). */
  hinge?: '' | 'links' | 'rechts';
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

/** A room (a Vorm item) placed in a floor plan. */
export interface PlanRoomEntry {
  roomId: string;
  /** The corners were numbered clockwise: mirror the shape so it lies the right way round. */
  mirror?: boolean;
  /** Placed against this room (another Vorm item in the plan); absent for the first room. */
  to?: string;
  /** Own wall and the other room's wall, as index text ('0' = wall 1–2). */
  wall?: string;
  toWall?: string;
  /** Thickness of the wall in between. */
  thickness?: string;
  /** Shift along the other room's wall, from its first corner. */
  offset?: string;
}

/** A stairwell or other hole in the floor, measured in a room from one of its walls. */
export interface VoidEntry {
  name: string;
  roomId: string;
  /** Wall index as text ('0' = wall 1–2). */
  wall: string;
  /** Along the wall from its first corner, and from the wall into the room. */
  offset: string;
  distance: string;
  /** Along the wall and into the room. */
  width: string;
  length: string;
}

/** A dormer (dakkapel) on a roof plane. */
export interface DormerEntry {
  name: string;
  /** Roof plane index as text. */
  plane: string;
  /** Along the ridge from the outside of the building (left, or front for a ridge front to back). */
  offset: string;
  width: string;
  /** Height of the front face, from the roof to the top. */
  frontHeight: string;
  /** Horizontal distance from the wall plate to the front face. */
  setback: string;
  windowWidth: string;
  windowHeight: string;
}

/** A roof window (dakraam) in a roof plane. */
export interface RoofWindowEntry {
  name: string;
  plane: string;
  offset: string;
  /** Along the slope from the wall plate (or knee) to the window. */
  up: string;
  width: string;
  /** Along the slope. */
  length: string;
}

/** A roof (Dak & spant item) on a floor, over some or all of its rooms. */
export interface RoofEntry {
  roofId: string;
  /** Rooms (Vorm ids) under this roof; empty = the whole floor. */
  rooms: string[];
  ridge: 'x' | 'y';
  flip: boolean;
  plateHeight: string;
  dormers: DormerEntry[];
  windows: RoofWindowEntry[];
}

/** Roofs of a floor plan; older items have a single roofId. */
export function roofEntries(item: PlattegrondItem): RoofEntry[] {
  if (item.roofs) return item.roofs;
  if (!item.roofId) return [];
  return [{ roofId: item.roofId, rooms: [], ridge: item.ridge, flip: item.roofFlip, plateHeight: item.plateHeight, dormers: [], windows: [] }];
}

/** One floor of a building: rooms placed against each other, outer walls, roof and the floor below. */
export interface PlattegrondItem extends BaseItem {
  kind: 'plattegrond';
  rooms: PlanRoomEntry[];
  outerWall: string;
  /** Measured outside: width of the front and depth, to check against the rooms. */
  measuredWidth: string;
  measuredDepth: string;
  /** Quarter turns of the plan: which side is the front. */
  turn: number;
  /** Roof (Dak item) on this floor; '' = none. */
  roofId: string;
  /** Ridge parallel to the front ('x') or front to back ('y'). */
  ridge: 'x' | 'y';
  roofFlip: boolean;
  /** Wall-plate height above this floor, for roofs entered without wall heights. Empty: highest room. */
  plateHeight: string;
  /** Floor this one stands on ('' = ground floor). */
  below: string;
  floorThickness: string;
  /** Shift of the outside walls relative to the floor below (right and back). */
  shiftX: string;
  shiftY: string;
  /** Stairwells in this floor (optional: older items lack it). */
  voids?: VoidEntry[];
  /** Roofs on this floor; replaces roofId/ridge/roofFlip/plateHeight when present. */
  roofs?: RoofEntry[];
  /** Thickness of flat roofs (rooms without a roof or a floor above). */
  flatThickness?: string;
}

export type Item = HoekItem | DriehoekItem | VormItem | DakItem | MatenItem | PlattegrondItem;

export interface Project {
  id: string;
  name: string;
  created: string;
  updated: string;
  /** Group on the server whose members share this project. Empty: only on this device. */
  groupId?: string;
  items: Item[];
}

export const KIND_LABELS: Record<ItemKind, string> = {
  hoek: 'Hoek',
  driehoek: 'Driehoek',
  vorm: 'Vorm',
  dak: 'Dak & spant',
  maten: 'Losse maten',
  plattegrond: 'Plattegrond',
};

export const KIND_HINTS: Record<ItemKind, string> = {
  hoek: 'Hoek bepalen met drie maten vanaf de hoek',
  driehoek: 'Driehoek uit drie bekende waarden',
  vorm: 'Ruimte, gevel of plaat uit zijden en diagonalen of hoeken',
  dak: 'Dakhelling, sparlengte en gevelvlak',
  maten: 'Lijst met gemeten maten en labels',
  plattegrond: 'Ruimtes samenvoegen tot een verdieping, met muren, buitenmaat, kap en aanzichten',
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
    case 'plattegrond':
      return {
        ...base,
        kind,
        rooms: [],
        outerWall: '0,300',
        measuredWidth: '',
        measuredDepth: '',
        turn: 0,
        roofId: '',
        ridge: 'x',
        roofFlip: false,
        plateHeight: '',
        below: '',
        floorThickness: '0,300',
        shiftX: '',
        shiftY: '',
      };
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

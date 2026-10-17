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
  heightMode?: 'gelijk' | 'per-hoek' | 'kap';
  heights?: string[];
  openings: OpeningEntry[];
}

/** Roof tile data from the manufacturer's sheet, and how the battens go on. All lengths as typed. */
export interface TileEntry {
  /** Tile width and length (b × l). */
  width: string;
  length: string;
  /** Batten gauge (latafstand); `gaugeMin` only for a tile that can slide (verschuifpan). */
  gauge: string;
  gaugeMin: string;
  /** Cover width (dekkende breedte). */
  cover: string;
  /** From the ridge to the top batten, along the slope (30–40 mm on most sheets). */
  ridgeGap: string;
  /** Last gauge: lowest batten to the end of the rafter at the eaves. */
  eavesGap: string;
  /** Counter battens, centre to centre. */
  counterSpacing: string;
  /** Cover width of the verge tiles (gevelpannen); empty = none. */
  vergeStart: string;
  vergeEnd: string;
  /** Lowest pitch, degrees. */
  minPitch: string;
  /** kg per tile. */
  weight: string;
}

/** Layers of the roof, thicknesses square to the slope. */
export interface BuildupEntry {
  /** 'boven' (default): the roof as entered is the top of the tiles; 'onder': the underside of the construction. */
  reference: 'boven' | 'onder';
  rafter: string;
  deck: string;
  counter: string;
  batten: string;
  tile: string;
  /** Rafter width and centre-to-centre spacing (for the 3D construction of a roof that is not an afdak). */
  rafterWidth?: string;
  rafterSpacing?: string;
}

export function emptyBuildup(): BuildupEntry {
  return { reference: 'boven', rafter: '', deck: '', counter: '', batten: '', tile: '' };
}

export function emptyTiles(): TileEntry {
  return { width: '', length: '', gauge: '', gaugeMin: '', cover: '', ridgeGap: '', eavesGap: '', counterSpacing: '', vergeStart: '', vergeEnd: '', minPitch: '', weight: '' };
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
  /** Horizontal overhang at the eaves (lengthens the rafters): left side, and the right unless `overhangRight` is filled in. */
  overhang: string;
  /** Overhang at the right eaves when it differs ('0' = none); empty = same as `overhang`. */
  overhangRight?: string;
  /** Overhang past the gable end at the start of the ridge (left, or front), and at its end unless `gableOverhangEnd` is filled in. */
  gableOverhang?: string;
  /** Overhang past the other gable end ('0' = none); empty = same as `gableOverhang`. */
  gableOverhangEnd?: string;
  /** Roof tiles: battens, counter battens and the number of tiles (optional). */
  tiles?: TileEntry;
  /** Roof build-up: thicknesses of the layers, and whether the roof as entered is their top or underside. */
  buildup?: BuildupEntry;
  /** Lessenaarsdak as an afdak on posts: the afdak then gives the section (span, pitch, heights, overhangs). */
  afdakOn?: boolean;
  afdak?: AfdakEntry;
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

/** A chosen material: type ('' = not chosen) and colour ('#rrggbb'; '' = the material's own colour). */
export interface FinishEntry {
  type: string;
  colour: string;
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
  /** Lies inside the other room (a toilet in a garage); `thickness` is then its own wall. */
  inside?: boolean;
  /** Inside: from the other room's wall to this room's wall (0 = it uses that wall). */
  distance?: string;
  /** Cladding of this room's outside walls, instead of the floor's (an extension in wood). */
  cladding?: FinishEntry;
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
  /** Roof covering (pannen, golfplaat …) and its colour. */
  covering?: FinishEntry;
  /** Cladding of the dormers on this roof. */
  dormerCladding?: FinishEntry;
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
  /**
   * Height of the top of this floor above the floor below. Empty: the highest room under it plus
   * the floor thickness.
   */
  floorHeight?: string;
  /** A floor without walls inside the floor below: loft (vliering), mezzanine (entresol). */
  open?: boolean;
  /** Stairwells in this floor (optional: older items lack it). */
  voids?: VoidEntry[];
  /** Roofs on this floor; replaces roofId/ridge/roofFlip/plateHeight when present. */
  roofs?: RoofEntry[];
  /** Thickness of flat roofs (rooms without a roof or a floor above). */
  flatThickness?: string;
  /** Cladding of the outside walls (metselwerk, rabat …) and its colour. */
  cladding?: FinishEntry;
  /** Colour of the window frames and doors ('#rrggbb'; '' = default). */
  frameColour?: string;
}

export type AfdakSide = 'links' | 'rechts' | 'voor' | 'achter';

/**
 * A lean-to roof on posts (afdak, overkapping, carport), part of a Dak & spant item: free-standing
 * or against a building at the back. Seen from above: width left to right along the building,
 * depth from the building (or the back) to the front.
 */
export interface AfdakEntry {
  width: string;
  depth: string;
  /**
   * What width and depth measure: 'constructie' = the posts (outside to outside, wall to the
   * outside of the front posts), the overhangs come on top; 'totaal' (or absent) = the roof edge to edge.
   */
  sizeOf?: 'constructie' | 'totaal';
  /** Against a building at the back: no posts there, set out from the wall. */
  attached: boolean;
  /** Along the wall from the corner of the building to the left edge of the roof (optional). */
  wallOffset: string;
  /** Post size: along the width and along the depth (empty = square). */
  postWidth: string;
  postDepth: string;
  /** Number of posts at the front, and at the back when free-standing. */
  postsFront: string;
  postsBack: string;
  /** Roof edge past the outside of the posts: at the sides, front and back. */
  overhangSide: string;
  overhangFront: string;
  overhangBack: string;
  /** Footing (poer) size, square; empty = not drawn. */
  footing: string;
  /** Closed sides, on the post lines. */
  walls: AfdakSide[];
  wallThickness: string;
  /** Roof: rafters (sporen) on the beams (optional). */
  roof?: AfdakRoofEntry;
}

/** Rafters of an afdak. Two of pitch, front height and back height; the third follows. */
export interface AfdakRoofEntry {
  pitch: string;
  /** Top of the front beam, and of the back support, above the floor. */
  frontHeight: string;
  backHeight: string;
  /** Front beam on the posts: width (front to back; empty = post depth) and height. */
  beamWidth: string;
  beamHeight: string;
  /** Back support: the beam against the building, or on the back posts (width front to back). */
  backWidth: string;
  rafterWidth: string;
  rafterHeight: string;
  rafterSpacing: string;
  /** Deepest notch: '3' = 1/3 of the rafter height, '4' = 1/4. */
  notch: '3' | '4';
  /** Against a building: rafters on top of the beam ('op', default) or against it, screwed ('tegen'). */
  backFix?: 'op' | 'tegen';
  /** 'tegen': top of the rafter above the top of the beam (0 = flush, negative = lower). */
  backOffset?: string;
  /** 'tegen': height of that beam (to check the rafter end stays on it). */
  backBeamHeight?: string;
  /** Beam on its posts: centred (default), flush with the front or the back of the posts. */
  beamAlign?: 'midden' | 'voor' | 'achter';
  /** Depth of the notch at the heel, square to the rafter (empty = automatic): front beam, and back beam when on top. */
  frontNotch?: string;
  backNotch?: string;
  /** Top of the tiles at the wall (or the back edge), instead of the back height: worked back through the build-up. */
  tileTop?: string;
  /** Pockets in the beams at every rafter, plumb depth (empty = none). */
  frontPocket?: string;
  backPocket?: string;
  /** 'tegen': above the beam the rafter runs on to the wall, for the top batten. */
  backThrough?: boolean;
}

export function emptyAfdakRoof(): AfdakRoofEntry {
  return { pitch: '', frontHeight: '', backHeight: '', beamWidth: '', beamHeight: '', backWidth: '', rafterWidth: '', rafterHeight: '', rafterSpacing: '', notch: '3' };
}

export function emptyAfdak(): AfdakEntry {
  return {
    width: '',
    depth: '',
    sizeOf: 'constructie',
    attached: true,
    wallOffset: '',
    postWidth: '0,150',
    postDepth: '',
    postsFront: '3',
    postsBack: '3',
    overhangSide: '0',
    overhangFront: '0',
    overhangBack: '0',
    footing: '',
    walls: [],
    wallThickness: '0,100',
  };
}

export type Item = HoekItem | DriehoekItem | VormItem | DakItem | MatenItem | PlattegrondItem;

/**
 * Items as stored, brought up to date: an afdak used to be an item of its own ('afdak'); it is now
 * a lean-to Dak & spant with the afdak switched on.
 */
export function migrateItems(items: unknown[]): Item[] {
  return items.map((raw) => {
    const i = raw as Record<string, unknown>;
    if (i?.['kind'] !== 'afdak') return raw as Item;
    const { id, name, notes, updated, kind: _kind, ...afdak } = i as unknown as BaseItem & AfdakEntry & { kind: string };
    void _kind;
    const dak = createItem('dak') as DakItem;
    return { ...dak, id, name, notes: notes ?? '', updated, roofType: 'lessenaarsdak', afdakOn: true, afdak: { ...emptyAfdak(), ...afdak } };
  });
}

export function migrateProject<T extends { items: unknown[] }>(p: T): T {
  return p.items.some((i) => (i as { kind?: string })?.kind === 'afdak') ? { ...p, items: migrateItems(p.items) } : p;
}

export interface Project {
  id: string;
  name: string;
  created: string;
  updated: string;
  /** Group on the server whose members share this project. Empty: only on this device. */
  groupId?: string;
  /** Project settings; absent in older projects. */
  settings?: ProjectSettings;
  items: Item[];
}

export interface ProjectSettings {
  /** Unit of lengths typed without a unit (default metres). Areas and volumes stay m² and m³. */
  unit?: 'm' | 'cm' | 'mm';
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
  dak: 'Dakhelling, spoorlengte en gevelvlak',
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

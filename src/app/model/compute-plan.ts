import { heightUnder, Level, LevelInput, stackLevels } from '../geometry/building';
import { buildFloorPlan, FloorPlan, PlanOpeningInput, PlanRoofInput, PlanRoomInput, PlanVoidInput, roofSeenFrom } from '../geometry/floorplan';
import { GeometryError, Point } from '../geometry/geometry';
import { formatLength, lengthUnit, parseLength } from '../geometry/units';
import { computeDak, computeVorm, Outcome } from './compute';
import { DakItem, Item, PlattegrondItem, roofEntries, VormItem } from './models';

export interface PlattegrondResult {
  plan: FloorPlan;
  /** Rooms whose shape is not complete yet, with the reason. */
  incompleteRooms: { name: string; reason: string }[];
  /** Per roof entry: wall-plate height used (from this floor), whether it was assumed, and problems. */
  roofInfo: { name: string; plateHeight: number | null; assumed: boolean; fromFloor: boolean; problem: string | null }[];
  /** Thickness of flat roofs used. */
  flatThickness: number;
  /** First roof's plate height (most floors have one roof). */
  plateHeight: number | null;
  plateHeightAssumed: boolean;
  roofProblem: string | null;
  /** Rooms without a height: assumed for the drawings. */
  assumedHeight: string[];
}

const DEFAULT_HEIGHT = 2.6;

function lengthOr(text: string | undefined, label: string, fallback: number | null): number | null {
  const v = parseLength(text ?? '');
  if (v === null) return fallback;
  if (Number.isNaN(v)) throw new GeometryError(`${label}: "${text}" is geen maat. Gebruik bijvoorbeeld 0,300 of 30 cm.`);
  return v;
}

export function computePlattegrond(item: PlattegrondItem, items: Item[], seen: Set<string> = new Set()): Outcome<PlattegrondResult> {
  try {
    if (item.rooms.length === 0) return { status: 'incomplete', message: 'Voeg ruimtes toe. Meet elke ruimte eerst als Vorm, met hoogte en deuren en ramen.' };
    const vorms = new Map(items.filter((i): i is VormItem => i.kind === 'vorm').map((i) => [i.id, i]));
    const incompleteRooms: PlattegrondResult['incompleteRooms'] = [];
    const assumedHeight: string[] = [];
    const rooms: PlanRoomInput[] = [];
    for (const entry of item.rooms) {
      const vorm = vorms.get(entry.roomId);
      if (!vorm) {
        incompleteRooms.push({ name: 'Onbekende ruimte', reason: 'Deze ruimte bestaat niet meer in het project.' });
        continue;
      }
      const r = computeVorm(vorm);
      if (r.status !== 'ok') {
        incompleteRooms.push({ name: vorm.name, reason: r.message });
        continue;
      }
      const { shape, room } = r.value;
      let heights: number[];
      const openings: PlanOpeningInput[] = [];
      // No height entered: under a roof the walls follow it (an attic), otherwise a height is assumed.
      const noHeight = !room && vorm.heightMode !== 'kap' && !r.value.roomError;
      const followRoof: boolean | 'auto' = vorm.heightMode === 'kap' ? true : noHeight ? 'auto' : false;
      if (followRoof) {
        // Heights come from the roof in the floor plan; until then a placeholder.
        heights = shape.points.map(() => DEFAULT_HEIGHT);
        for (const o of r.value.openings) {
          if (o.wall === null) continue;
          openings.push({ name: o.name, wall: o.wall, offset: o.offset ?? 0, width: o.width, height: o.height, sill: o.sill ?? 0, type: o.type, swing: o.swing, hinge: o.hinge });
        }
      } else if (room) {
        heights = room.walls.map((w) => w.heightFrom);
        for (const w of room.walls) {
          for (const o of w.openings) {
            openings.push({ name: o.name, wall: w.index, offset: o.offset ?? 0, width: o.width, height: o.height, sill: o.sill ?? 0, type: o.type, swing: o.swing, hinge: o.hinge });
          }
        }
      } else {
        heights = shape.points.map(() => DEFAULT_HEIGHT);
        assumedHeight.push(vorm.name);
      }
      const label = `${vorm.name}`;
      const wall = entry.wall === undefined || entry.wall === '' ? NaN : Number(entry.wall);
      const toWall = entry.toWall === undefined || entry.toWall === '' ? NaN : Number(entry.toWall);
      const link =
        rooms.length === 0 && item.rooms.indexOf(entry) === 0
          ? null
          : entry.to
            ? {
                to: entry.to,
                wall: Number.isInteger(wall) ? wall : -1,
                toWall: Number.isInteger(toWall) ? toWall : -1,
                thickness: lengthOr(entry.thickness, `${label}: muurdikte`, 0.1)!,
                offset: lengthOr(entry.offset, `${label}: verschuiving`, 0)!,
                inside: !!entry.inside,
                distance: entry.inside ? lengthOr(entry.distance, `${label}: afstand uit de wand`, 0)! : 0,
              }
            : null;
      rooms.push({ id: vorm.id, name: vorm.name, points: shape.points, heights, openings, volume: followRoof ? null : (room?.volume ?? null), mirror: !!entry.mirror, link, followRoof });
    }
    if (rooms.length === 0) {
      return { status: 'incomplete', message: `Nog geen complete ruimte: ${incompleteRooms.map((r) => `${r.name} (${r.reason})`).join('; ')}` };
    }
    // The first complete room is the starting point, even when an earlier one is not complete yet.
    rooms[0] = { ...rooms[0], link: null };

    const outerWall = item.open ? 0 : lengthOr(item.outerWall, 'Buitenmuur', null);
    if (outerWall === null) return { status: 'incomplete', message: 'Vul de dikte van de buitenmuur in.' };
    // A loft has no walls, so its rooms need no height.
    if (item.open) assumedHeight.length = 0;

    const roofs: PlanRoofInput[] = [];
    const roofInfo: PlattegrondResult['roofInfo'] = [];
    for (const [ri, entry] of roofEntries(item).entries()) {
      const dak = items.find((i): i is DakItem => i.kind === 'dak' && i.id === entry.roofId);
      const r = dak ? computeDak(dak) : null;
      const name = dak?.name ?? `Kap ${ri + 1}`;
      if (!entry.roofId) {
        roofInfo.push({ name, plateHeight: null, assumed: false, fromFloor: false, problem: null });
        continue;
      }
      if (!dak || !r) {
        roofInfo.push({ name, plateHeight: null, assumed: false, fromFloor: false, problem: 'De gekozen kap bestaat niet meer.' });
        continue;
      }
      if (r.status !== 'ok') {
        roofInfo.push({ name, plateHeight: null, assumed: false, fromFloor: false, problem: `Kap "${dak.name}": ${r.message}` });
        continue;
      }
      const section = r.value.roof;
      const covered = entry.rooms.length ? rooms.filter((x) => entry.rooms.includes(x.id)) : rooms;
      let plateHeight = lengthOr(entry.plateHeight, `${name}: hoogte muurplaat`, null);
      let assumed = false;
      if (plateHeight === null) {
        // Rooms whose walls follow the roof (an attic) have no height of their own: the plate is then on the floor.
        const measured = (covered.length ? covered : rooms).filter((x) => !x.followRoof);
        plateHeight = measured.length ? Math.max(...measured.flatMap((x) => x.heights)) : 0;
        assumed = true;
      }
      if (section.fromFloor) plateHeight = section.plateLeft;
      roofInfo.push({ name, plateHeight, assumed: assumed && !section.fromFloor, fromFloor: section.fromFloor, problem: null });
      const num = (t: string, label: string) => lengthOr(t, `${name}, ${label}`, null);
      roofs.push({
        key: String(ri),
        name,
        section,
        ridge: entry.ridge,
        flip: entry.flip,
        plateHeight,
        overhang: lengthOr(dak.overhang, 'Overstek goot', 0) ?? 0,
        gableOverhang: lengthOr(dak.gableOverhang, 'Overstek kopgevels', 0) ?? 0,
        length: lengthOr(dak.length, 'Daklengte', null),
        rooms: entry.rooms,
        dormers: entry.dormers.flatMap((d, i) => {
          const label = d.name || `dakkapel ${i + 1}`;
          const width = num(d.width, `${label}: breedte`);
          const frontHeight = num(d.frontHeight, `${label}: hoogte voorkant`);
          if (width === null || frontHeight === null || d.plane === '') return [];
          return [
            {
              name: label,
              plane: Number(d.plane),
              offset: num(d.offset, `${label}: afstand`) ?? 0,
              width,
              frontHeight,
              setback: num(d.setback, `${label}: terugligging`) ?? 0,
              windowWidth: num(d.windowWidth, `${label}: breedte raam`),
              windowHeight: num(d.windowHeight, `${label}: hoogte raam`),
            },
          ];
        }),
        windows: entry.windows.flatMap((w, i) => {
          const label = w.name || `dakraam ${i + 1}`;
          const width = num(w.width, `${label}: breedte`);
          const length = num(w.length, `${label}: lengte`);
          if (width === null || length === null || w.plane === '') return [];
          return [{ name: label, plane: Number(w.plane), offset: num(w.offset, `${label}: afstand`) ?? 0, up: num(w.up, `${label}: vanaf de muurplaat`) ?? 0, width, length }];
        }),
      });
    }

    const voids: PlanVoidInput[] = [];
    for (const [i, v] of (item.voids ?? []).entries()) {
      const label = v.name || `Trapgat ${i + 1}`;
      const width = lengthOr(v.width, `${label}: breedte`, null);
      const length = lengthOr(v.length, `${label}: lengte`, null);
      if (width === null || length === null || !v.roomId || v.wall === '') continue; // not filled in yet
      voids.push({
        name: label,
        room: v.roomId,
        wall: Number(v.wall),
        offset: lengthOr(v.offset, `${label}: afstand langs de wand`, 0)!,
        distance: lengthOr(v.distance, `${label}: afstand uit de wand`, 0)!,
        width,
        length,
      });
    }

    const planInput = {
      open: !!item.open,
      rooms,
      voids,
      outerWall,
      measuredWidth: lengthOr(item.measuredWidth, 'Buitenmaat voorgevel', null),
      measuredDepth: lengthOr(item.measuredDepth, 'Buitenmaat diepte', null),
      turn: item.turn,
      roofs,
      flatThickness: lengthOr(item.flatThickness, 'Dikte plat dak', 0.3) ?? 0.3,
    };
    let plan = buildFloorPlan(planInput);
    // An attic floor without a roof of its own lies inside the roof of the floor below: its rooms
    // that follow the roof take that roof, seen from this floor's height and position.
    const loose = plan.rooms.some((r) => rooms.find((x) => x.id === r.id)?.followRoof && !r.followsRoof);
    if (loose && item.below && !seen.has(item.id)) {
      const belowItem = items.find((i): i is PlattegrondItem => i.kind === 'plattegrond' && i.id === item.below);
      const below = belowItem ? computePlattegrond(belowItem, items, new Set([...seen, item.id])) : null;
      if (below?.status === 'ok' && below.value.plan.roofs.length) {
        const inset = item.open ? below.value.plan.outerWall : 0;
        const shift = { x: lengthOr(item.shiftX, 'Verschuiving', null) ?? inset, y: lengthOr(item.shiftY, 'Verschuiving', null) ?? inset };
        const thickness = lengthOr(item.floorThickness, 'Vloerdikte', 0.3) ?? 0.3;
        const dz = lengthOr(item.floorHeight, 'Hoogte vloer', null) ?? heightUnder(below.value.plan, { x: 0, y: 0 }, plan, shift) + thickness;
        plan = buildFloorPlan({ ...planInput, roofsAround: below.value.plan.roofs.map((r) => roofSeenFrom(r, shift, dz)) });
      }
    }
    // Values that are almost certainly typing errors (49 instead of 0,49): say so instead of drawing a 50 m high house.
    const odd = (text: string | undefined, label: string, max: number) => {
      const v = parseLength(text ?? '');
      if (v === null || Number.isNaN(v) || v <= max) return;
      const guess = v >= 100 ? v / 1000 : v / 100;
      plan.warnings.push(
        `${label} is ${formatLength(v)}: dat lijkt een typfout. Bedoel je ${formatLength(guess)}? Een maat zonder eenheid is in ${{ m: 'meters', cm: 'centimeters', mm: 'millimeters' }[lengthUnit()]} (eenheid van het project).`,
      );
    };
    if (item.below) {
      odd(item.floorThickness, 'Vloerdikte', 1.5);
      odd(item.floorHeight, 'Hoogte vloer', 15);
    }
    if (!item.open) odd(item.outerWall, 'Buitenmuur', 1.5);
    odd(item.flatThickness, 'Dikte plat dak', 1.5);
    for (const entry of item.rooms) odd(entry.thickness, `${vorms.get(entry.roomId)?.name ?? 'Ruimte'}: muurdikte`, 1.5);
    // Rooms without a height that are not under any roof: the drawing assumes a height.
    if (!item.open) for (const x of rooms) if (x.followRoof === 'auto' && !plan.rooms.find((pr) => pr.id === x.id)?.followsRoof) assumedHeight.push(x.name);
    const first = roofInfo.find((x) => !x.problem && x.plateHeight !== null) ?? null;
    const roofProblem = roofInfo.map((x) => x.problem).filter(Boolean).join(' ') || null;
    return {
      status: 'ok',
      value: { plan, incompleteRooms, roofInfo, flatThickness: plan.flatThickness, plateHeight: first?.plateHeight ?? null, plateHeightAssumed: first?.assumed ?? false, roofProblem, assumedHeight },
    };
  } catch (e) {
    if (e instanceof GeometryError) return { status: 'error', message: e.message };
    throw e;
  }
}

/** Floors that stand on (or carry) this one, stacked, for the 3D view and the elevations. */
export function computeBuilding(item: PlattegrondItem, items: Item[]): Level[] {
  const plans = items.filter((i): i is PlattegrondItem => i.kind === 'plattegrond');
  const inputs: LevelInput[] = [];
  for (const p of plans) {
    const r = computePlattegrond(p, items);
    if (r.status !== 'ok' || r.value.plan.rooms.length === 0) continue;
    let thickness = 0.3;
    let dx: number | null = null;
    let dy: number | null = null;
    let floorHeight: number | null = null;
    try {
      thickness = lengthOr(p.floorThickness, 'Vloerdikte', 0.3) ?? 0.3;
      dx = lengthOr(p.shiftX, 'Verschuiving', null);
      dy = lengthOr(p.shiftY, 'Verschuiving', null);
      floorHeight = p.below ? lengthOr(p.floorHeight, 'Hoogte vloer', null) : null;
    } catch {
      // Unreadable values are reported in that floor's own editor.
    }
    inputs.push({ id: p.id, name: p.name, plan: r.value.plan, below: p.below || null, floorThickness: thickness, dx: dx ?? NaN, dy: dy ?? NaN, floorHeight, open: !!p.open });
  }
  // Without a shift, a floor lines up with the outside of the walls of the floor below; a loft
  // (no walls) with the inside of those walls.
  for (const l of inputs) {
    const below = inputs.find((b) => b.id === l.below);
    const inset = l.open && below ? below.plan.outerWall : 0;
    if (Number.isNaN(l.dx)) l.dx = inset;
    if (Number.isNaN(l.dy)) l.dy = inset;
  }
  return stackLevels(inputs, item.id);
}

/** Stairwells of the floors directly above, in this floor's plan coordinates. */
export function voidsFromAbove(levels: Level[], levelId: string): { name: string; points: { x: number; y: number }[] }[] {
  const level = levels.find((l) => l.id === levelId);
  if (!level) return [];
  const above = levels.filter((l) => l.number === level.number + 1 && l.base > level.base);
  return above.flatMap((a) =>
    a.plan.voids.map((v) => ({
      name: v.name,
      points: v.points.map((p) => ({ x: p.x + a.offset.x - level.offset.x, y: p.y + a.offset.y - level.offset.y })),
    })),
  );
}

/**
 * Context for the plan of a floor: for a loft the rooms of the floor it lies in (thin lines), for
 * any floor the lofts lying in it (dashed, with their height). In this floor's plan coordinates.
 */
export function planContext(levels: Level[], levelId: string): { under: Point[][]; lofts: { name: string; height: number; rings: Point[][] }[] } {
  const level = levels.find((l) => l.id === levelId);
  if (!level) return { under: [], lofts: [] };
  const shift = (from: Level) => (p: Point) => ({ x: p.x + from.offset.x - level.offset.x, y: p.y + from.offset.y - level.offset.y });
  const host = level.open ? levels.find((l) => l.id === level.below) : undefined;
  const under = host ? host.plan.rooms.map((r) => r.points.map(shift(host))) : [];
  const lofts = levels
    .filter((l) => l.open && l.below === level.id)
    .map((l) => ({ name: l.name, height: l.base - level.base, rings: l.plan.rooms.map((r) => r.points.map(shift(l))) }));
  return { under, lofts };
}

/** Floors that may be chosen as "below" this one: no loops. */
export function possibleBelow(item: PlattegrondItem, items: Item[]): PlattegrondItem[] {
  const plans = items.filter((i): i is PlattegrondItem => i.kind === 'plattegrond');
  const byId = new Map(plans.map((p) => [p.id, p]));
  const standsOn = (p: PlattegrondItem, target: string): boolean => {
    const seen = new Set<string>();
    let cur: PlattegrondItem | undefined = p;
    while (cur && !seen.has(cur.id)) {
      if (cur.id === target) return true;
      seen.add(cur.id);
      cur = cur.below ? byId.get(cur.below) : undefined;
    }
    return false;
  };
  return plans.filter((p) => p.id !== item.id && !standsOn(p, item.id));
}

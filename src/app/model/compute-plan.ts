import { Level, LevelInput, stackLevels } from '../geometry/building';
import { buildFloorPlan, FloorPlan, PlanOpeningInput, PlanRoofInput, PlanRoomInput, PlanVoidInput } from '../geometry/floorplan';
import { GeometryError } from '../geometry/geometry';
import { parseLength } from '../geometry/units';
import { computeDak, computeVorm, Outcome } from './compute';
import { DakItem, Item, PlattegrondItem, VormItem } from './models';

export interface PlattegrondResult {
  plan: FloorPlan;
  /** Rooms whose shape is not complete yet, with the reason. */
  incompleteRooms: { name: string; reason: string }[];
  /** Height of the wall plates used for the roof (from this floor). */
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

export function computePlattegrond(item: PlattegrondItem, items: Item[]): Outcome<PlattegrondResult> {
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
      if (room) {
        heights = room.walls.map((w) => w.heightFrom);
        for (const w of room.walls) {
          for (const o of w.openings) {
            openings.push({ name: o.name, wall: w.index, offset: o.offset ?? 0, width: o.width, height: o.height, sill: o.sill ?? 0 });
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
              }
            : null;
      rooms.push({ id: vorm.id, name: vorm.name, points: shape.points, heights, openings, volume: room?.volume ?? null, mirror: !!entry.mirror, link });
    }
    if (rooms.length === 0) {
      return { status: 'incomplete', message: `Nog geen complete ruimte: ${incompleteRooms.map((r) => `${r.name} (${r.reason})`).join('; ')}` };
    }
    // The first complete room is the starting point, even when an earlier one is not complete yet.
    rooms[0] = { ...rooms[0], link: null };

    const outerWall = lengthOr(item.outerWall, 'Buitenmuur', null);
    if (outerWall === null) return { status: 'incomplete', message: 'Vul de dikte van de buitenmuur in.' };

    let roof: PlanRoofInput | null = null;
    let roofProblem: string | null = null;
    let plateHeight: number | null = null;
    let plateHeightAssumed = false;
    if (item.roofId) {
      const dak = items.find((i): i is DakItem => i.kind === 'dak' && i.id === item.roofId);
      const r = dak ? computeDak(dak) : null;
      if (!dak) roofProblem = 'De gekozen kap bestaat niet meer.';
      else if (r!.status !== 'ok') roofProblem = `Kap "${dak.name}": ${r!.message}`;
      else {
        const section = r!.value.roof;
        plateHeight = lengthOr(item.plateHeight, 'Hoogte muurplaat', null);
        if (plateHeight === null) {
          plateHeight = Math.max(...rooms.flatMap((x) => x.heights));
          plateHeightAssumed = true;
        }
        if (section.fromFloor) plateHeight = section.plateLeft;
        roof = {
          section,
          ridge: item.ridge,
          flip: item.roofFlip,
          plateHeight: plateHeight,
          overhang: lengthOr(dak.overhang, 'Overstek goot', 0) ?? 0,
          gableOverhang: lengthOr(dak.gableOverhang, 'Overstek kopgevels', 0) ?? 0,
          length: lengthOr(dak.length, 'Daklengte', null),
        };
      }
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

    const plan = buildFloorPlan({
      rooms,
      voids,
      outerWall,
      measuredWidth: lengthOr(item.measuredWidth, 'Buitenmaat voorgevel', null),
      measuredDepth: lengthOr(item.measuredDepth, 'Buitenmaat diepte', null),
      turn: item.turn,
      roof,
    });
    return { status: 'ok', value: { plan, incompleteRooms, plateHeight, plateHeightAssumed, roofProblem, assumedHeight } };
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
    let dx = 0;
    let dy = 0;
    try {
      thickness = lengthOr(p.floorThickness, 'Vloerdikte', 0.3) ?? 0.3;
      dx = lengthOr(p.shiftX, 'Verschuiving', 0) ?? 0;
      dy = lengthOr(p.shiftY, 'Verschuiving', 0) ?? 0;
    } catch {
      // Unreadable values are reported in that floor's own editor.
    }
    inputs.push({ id: p.id, name: p.name, plan: r.value.plan, below: p.below || null, floorThickness: thickness, dx, dy });
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

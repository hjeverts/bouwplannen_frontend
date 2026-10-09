import { Level, LevelInput, stackLevels } from '../geometry/building';
import { buildFloorPlan, FloorPlan, PlanOpeningInput, PlanRoofInput, PlanRoomInput, PlanVoidInput } from '../geometry/floorplan';
import { GeometryError } from '../geometry/geometry';
import { parseLength } from '../geometry/units';
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
        plateHeight = Math.max(...(covered.length ? covered : rooms).flatMap((x) => x.heights));
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

    const plan = buildFloorPlan({
      rooms,
      voids,
      outerWall,
      measuredWidth: lengthOr(item.measuredWidth, 'Buitenmaat voorgevel', null),
      measuredDepth: lengthOr(item.measuredDepth, 'Buitenmaat diepte', null),
      turn: item.turn,
      roofs,
      flatThickness: lengthOr(item.flatThickness, 'Dikte plat dak', 0.3) ?? 0.3,
    });
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

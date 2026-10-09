import { describe, expect, it } from 'vitest';
import { buildFloorPlan, grow, hingeEnd, openingStyle, PlanInput, PlanRoomInput, pointInPolygon, signedArea } from './floorplan';
import { mansardSection, Point, roofSection } from './geometry';

const rect = (w: number, d: number): Point[] => [
  { x: 0, y: 0 },
  { x: w, y: 0 },
  { x: w, y: d },
  { x: 0, y: d },
];

function room(id: string, points: Point[], extra: Partial<PlanRoomInput> = {}): PlanRoomInput {
  return { id, name: id, points, heights: points.map(() => 2.6), openings: [], volume: null, mirror: false, link: null, ...extra };
}

function plan(rooms: PlanRoomInput[], extra: Partial<PlanInput> = {}): PlanInput {
  return { rooms, outerWall: 0.3, measuredWidth: null, measuredDepth: null, turn: 0, roof: null, ...extra };
}

const close = (a: number, b: number, mm = 0.5) => expect(Math.abs(a - b)).toBeLessThan(mm / 1000);

describe('grow', () => {
  it('offsets a rectangle outward with square corners, either orientation', () => {
    for (const pts of [rect(4, 3), [...rect(4, 3)].reverse()]) {
      const g = grow(pts, 0.3);
      expect(Math.abs(signedArea(g))).toBeCloseTo(4.6 * 3.6, 9);
      expect(g.map((p) => Math.round(p.x * 10) / 10).sort()).toEqual([-0.3, -0.3, 4.3, 4.3]);
    }
  });

  it('handles an inward corner (L shape)', () => {
    const L = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 2 },
      { x: 2, y: 2 },
      { x: 2, y: 4 },
      { x: 0, y: 4 },
    ];
    const g = grow(L, 0.1);
    // Inner corner (2,2) moves to (2.1, 2.1).
    expect(g[3].x).toBeCloseTo(2.1, 9);
    expect(g[3].y).toBeCloseTo(2.1, 9);
  });
});

describe('buildFloorPlan', () => {
  // Living room 5 x 4, kitchen 3 x 4 to its right, 100 mm wall in between, front walls in line.
  const living = room('woon', rect(5, 4));
  const kitchen = room('keuken', rect(3, 4), { link: { to: 'woon', wall: 3, toWall: 1, thickness: 0.1, offset: 0 } });

  it('places a room against the wall of another with the wall thickness in between', () => {
    const fp = buildFloorPlan(plan([living, kitchen]));
    expect(fp.unplaced).toEqual([]);
    const [w, k] = fp.rooms;
    // Living room starts inside the outer wall.
    close(w.points[0].x, 0.3);
    close(w.points[0].y, 0.3);
    // Kitchen corner 1 at 5 + 0.1 to the right of the living room, front in line.
    const kx = Math.min(...k.points.map((p) => p.x));
    const ky = Math.min(...k.points.map((p) => p.y));
    close(kx - 0.3, 5.1);
    close(ky, 0.3);
    close(fp.width.computed, 0.3 + 5 + 0.1 + 3 + 0.3);
    close(fp.depth.computed, 4.6);
    close(fp.netArea, 32);
    close(fp.grossArea, 8.7 * 4.6);
    close(fp.partitionLength, 4);
    expect(fp.footprint.length).toBe(1);
    expect(fp.footprint[0].length).toBe(1); // no holes
    expect(fp.footprint[0][0].length).toBe(4); // a plain rectangle
    expect(fp.warnings).toEqual([]);
  });

  it('reports the shift corner and moves along the wall with the offset', () => {
    const shifted = { ...kitchen, link: { ...kitchen.link!, offset: 0.5 } };
    const fp = buildFloorPlan(plan([living, shifted]));
    const k = fp.rooms[1];
    close(Math.min(...k.points.map((p) => p.y)) - Math.min(...fp.rooms[0].points.map((p) => p.y)), 0.5);
    // Kitchen wall 4–1 runs from corner 4 (back) to corner 1 (front); corner 1 is nearest the living room's corner 2.
    expect(k.shiftCorner).toBe(0);
    // Now the outline is stepped: 8 corners.
    expect(fp.footprint[0][0].length).toBe(8);
  });

  it('checks the measured outside dimensions', () => {
    const fp = buildFloorPlan(plan([living, kitchen], { measuredWidth: 8.71, measuredDepth: 4.58 }));
    close(fp.width.diff!, 0.01);
    close(fp.width.impliedWall!, 0.305);
    close(fp.depth.diff!, -0.02);
    close(fp.depth.impliedWall!, 0.29);
  });

  it('works for clockwise-numbered rooms that are mirrored', () => {
    // Same kitchen measured clockwise: corners 1 front-left, 2 back-left, 3 back-right, 4 front-right.
    const cw = [
      { x: 0, y: 0 },
      { x: 0, y: 4 },
      { x: 3, y: 4 },
      { x: 3, y: 0 },
    ];
    // In local coordinates the shape builder always walks counter-clockwise, so the kitchen as
    // computed is mirrored; "mirror" puts it back. Wall 1–2 is its left wall.
    const local = cw.map((p) => ({ x: p.y, y: p.x })); // what the shape builder would give (side 1 along x)
    const k = room('keuken', local, { mirror: true, link: { to: 'woon', wall: 0, toWall: 1, thickness: 0.1, offset: 0 } });
    const fp = buildFloorPlan(plan([living, k]));
    const pts = fp.rooms[1].points;
    close(Math.min(...pts.map((p) => p.x)) - 0.3, 5.1);
    close(Math.max(...pts.map((p) => p.x)) - 0.3, 8.1);
    close(fp.rooms[1].area, 12);
    expect(fp.warnings).toEqual([]);
  });

  it('turns the whole plan in quarter turns', () => {
    const fp = buildFloorPlan(plan([living, kitchen], { turn: 1 }));
    close(fp.width.computed, 4.6);
    close(fp.depth.computed, 8.7);
  });

  it('puts a door in the wall between two rooms on both sides', () => {
    const withDoor = { ...living, openings: [{ name: 'deur', wall: 1, offset: 1, width: 0.9, height: 2.1, sill: 0 }] };
    const fp = buildFloorPlan(plan([withDoor, kitchen]));
    const own = fp.rooms[0].walls[1].openings;
    expect(own).toHaveLength(1);
    const inherited = fp.rooms[1].walls[3].openings;
    expect(inherited).toHaveLength(1);
    expect(inherited[0].own).toBe(false);
    // Kitchen wall 4–1 runs back to front: door from 1,0 to 1,9 m from the front is 4 − 1,9 = 2,1 m from corner 4.
    close(inherited[0].offset, 2.1);
    expect(fp.openings).toHaveLength(1);
    expect(fp.openings[0].exterior).toBe(false);
    close(fp.openings[0].thickness, 0.1);
    // Net wall area of the kitchen counts the door too.
    const kitchenGross = 2 * (3 + 4) * 2.6;
    close(fp.rooms[1].netWallArea, kitchenGross - 0.9 * 2.1);
  });

  it('marks a window in an outer wall as exterior with the outer wall thickness', () => {
    const withWindow = { ...living, openings: [{ name: 'raam', wall: 0, offset: 1, width: 1.2, height: 1, sill: 0.9 }] };
    const fp = buildFloorPlan(plan([withWindow, kitchen]));
    expect(fp.openings[0]).toMatchObject({ door: false, exterior: true, thickness: 0.3 });
  });

  it('explains rooms that cannot be placed', () => {
    const lost = room('zolder', rect(2, 2));
    const orphan = room('berging', rect(2, 2), { link: { to: 'weg', wall: 0, toWall: 0, thickness: 0.1, offset: 0 } });
    const fp = buildFloorPlan(plan([living, lost, orphan]));
    expect(fp.rooms).toHaveLength(1);
    expect(fp.unplaced.map((u) => u.name)).toEqual(['zolder', 'berging']);
  });

  it('places rooms whose link points to a room later in the list', () => {
    const hall = room('hal', rect(2, 4), { link: { to: 'keuken', wall: 3, toWall: 1, thickness: 0.1, offset: 0 } });
    const fp = buildFloorPlan(plan([living, hall, kitchen]));
    expect(fp.unplaced).toEqual([]);
    close(fp.width.computed, 0.3 + 5 + 0.1 + 3 + 0.1 + 2 + 0.3);
  });

  it('warns when rooms overlap', () => {
    const bad = { ...kitchen, link: { ...kitchen.link!, thickness: -0.5 } };
    expect(buildFloorPlan(plan([living, bad])).unplaced[0].reason).toMatch(/negatief/);
    // Two rooms placed against the same wall at the same spot.
    const twin = room('bijkeuken', rect(2, 2), { link: { to: 'woon', wall: 3, toWall: 1, thickness: 0.1, offset: 1 } });
    const fp = buildFloorPlan(plan([living, kitchen, twin]));
    expect(fp.warnings.some((w) => /overlappen/.test(w))).toBe(true);
    const touching = { ...kitchen, link: { ...kitchen.link!, thickness: 0 } };
    expect(buildFloorPlan(plan([living, touching])).warnings[0]).toMatch(/zonder muur/);
  });

  it('places a gable roof across the building, centred, with overhangs', () => {
    const section = roofSection({ type: 'zadeldak', span: 4.6, pitch: 45, overhang: 0.3 });
    const fp = buildFloorPlan(
      plan([living, kitchen], { roof: { section, ridge: 'x', flip: false, plateHeight: 2.8, overhang: 0.3, gableOverhang: 0.2, length: 8.7 } }),
    );
    const roof = fp.roof!;
    close(roof.spanDiff, 0);
    close(roof.lengthDiff!, 0);
    close(roof.from, -0.2);
    close(roof.to, 8.9);
    close(roof.ridgeHeight, 2.8 + 2.3);
    close(roof.heightAt(0), 2.8);
    close(roof.heightAt(2.3), 5.1);
    close(roof.heightAt(4.6), 2.8);
    // Eaves extend 0.3 outward following the 45° slope.
    close(roof.eaves[0].c, -0.3);
    close(roof.eaves[0].z, 2.5);
    expect(fp.warnings).toEqual([]);
  });

  it('flips an off-centre roof and warns when the span does not fit', () => {
    const section = roofSection({ type: 'zadeldak', span: 4, wallLeft: 3, wallRight: 2.4, pitch: 45, pitchRight: 30 });
    const fp = buildFloorPlan(
      plan([living, kitchen], { roof: { section, ridge: 'x', flip: true, plateHeight: 0, overhang: 0, gableOverhang: 0, length: null } }),
    );
    const roof = fp.roof!;
    // Flipped: the high (3 m) wall is at the back (large y).
    close(roof.profile[0].z, 2.4);
    close(roof.profile[roof.profile.length - 1].z, 3);
    expect(fp.warnings[0]).toMatch(/overspanning van de kap/);
  });

  it('builds the underside of a mansard roof and a lean-to', () => {
    const mansard = mansardSection({ span: 4.6, lower: { run: 0.6, rise: 2 }, upper: { pitch: 25 } });
    const fp = buildFloorPlan(
      plan([living, kitchen], { roof: { section: mansard, ridge: 'y', flip: false, plateHeight: 2.6, overhang: 0, gableOverhang: 0, length: null } }),
    );
    expect(fp.roof!.profile).toHaveLength(5);
    close(fp.roof!.profile[1].z, 4.6);
    const lean = roofSection({ type: 'lessenaarsdak', span: 4.6, wallLeft: 2.4, wallRight: 3.2 });
    const fp2 = buildFloorPlan(
      plan([living, kitchen], { roof: { section: lean, ridge: 'x', flip: false, plateHeight: 0, overhang: 0, gableOverhang: 0, length: null } }),
    );
    expect(fp2.roof!.profile.map((p) => p.z)).toEqual([2.4, 3.2]);
  });

  it('builds a courtyard as a hole in the outline', () => {
    // Four rooms around an open middle.
    const a = room('a', rect(6, 2));
    const b = room('b', rect(2, 2), { link: { to: 'a', wall: 0, toWall: 2, thickness: 0.1, offset: 0 } });
    const c = room('c', rect(6, 2), { link: { to: 'b', wall: 0, toWall: 2, thickness: 0.1, offset: 0 } });
    const d = room('d', rect(2, 2), { link: { to: 'a', wall: 0, toWall: 2, thickness: 0.1, offset: 4 } });
    const fp = buildFloorPlan(plan([a, b, c, d]));
    expect(fp.unplaced).toEqual([]);
    expect(fp.footprint).toHaveLength(1);
    expect(fp.footprint[0].length).toBe(2); // outer ring + courtyard
  });
});

describe('stairwells', () => {
  const living = room('woon', rect(5, 4));

  it('places a hole from a wall of a room', () => {
    const fp = buildFloorPlan(plan([living], { voids: [{ name: 'trapgat', room: 'woon', wall: 1, offset: 0.5, distance: 0.2, width: 2.4, length: 0.9 }] }));
    const v = fp.voids[0];
    expect(v.area).toBeCloseTo(2.16, 9);
    // Wall 2–3 is the right wall (x = 5), running back; inward is to the left (−x).
    const xs = v.points.map((p) => p.x - 0.3);
    const ys = v.points.map((p) => p.y - 0.3);
    close(Math.max(...xs), 4.8);
    close(Math.min(...xs), 3.9);
    close(Math.min(...ys), 0.5);
    close(Math.max(...ys), 2.9);
    close(fp.voidArea, 2.16);
    expect(fp.warnings).toEqual([]);
  });

  it('warns when the hole does not fit the room', () => {
    const fp = buildFloorPlan(plan([living], { voids: [{ name: 'vide', room: 'woon', wall: 0, offset: 4, distance: 0, width: 2, length: 1 }] }));
    expect(fp.warnings[0]).toMatch(/vide valt \(deels\) buiten woon/);
    const lost = buildFloorPlan(plan([living], { voids: [{ name: 'x', room: 'weg', wall: 0, offset: 0, distance: 0, width: 1, length: 1 }] }));
    expect(lost.voids).toHaveLength(0);
    expect(lost.warnings[0]).toMatch(/kies de ruimte/);
  });
});

describe('doors', () => {
  it('guesses the kind of opening from its name, or takes the chosen kind', () => {
    expect(openingStyle('voordeur', 0)).toBe('deur');
    expect(openingStyle('roldeur garage', 0)).toBe('roldeur');
    expect(openingStyle('Sectionaaldeur', 0)).toBe('roldeur');
    expect(openingStyle('schuifpui', 0)).toBe('schuif');
    expect(openingStyle('raam', 0.9)).toBe('raam');
    expect(openingStyle('', 0)).toBe('deur');
    expect(openingStyle('', 0.9)).toBe('raam');
    expect(openingStyle('deur', 0, 'roldeur')).toBe('roldeur');
  });

  it('puts the hinges DIN-left or DIN-right, seen from the side the door opens to', () => {
    // Door in a wall along x from a (0,0) to b (1,0); it opens towards +y.
    const a = { x: 0, y: 0 };
    const b = { x: 1, y: 0 };
    // Standing at +y facing the door (looking towards −y): your left hand is +x, so b.
    expect(hingeEnd(a, b, { x: 0, y: 1 }, 'links')).toBe('b');
    expect(hingeEnd(a, b, { x: 0, y: 1 }, 'rechts')).toBe('a');
    // Opening the other way round swaps them.
    expect(hingeEnd(a, b, { x: 0, y: -1 }, 'links')).toBe('a');
    expect(hingeEnd(a, b, { x: 0, y: -1 }, null)).toBe('a');
  });

  it('carries kind, swing and hinge to the plan', () => {
    const r = room('hal', rect(3, 4), {
      openings: [
        { name: 'voordeur', wall: 0, offset: 1, width: 1, height: 2.3, sill: 0, swing: 'buiten', hinge: 'rechts' },
        { name: 'garage', wall: 2, offset: 0.5, width: 2.4, height: 2.2, sill: 0, type: 'roldeur' },
      ],
    });
    const fp = buildFloorPlan(plan([r]));
    const [front, garage] = fp.openings;
    expect(front).toMatchObject({ style: 'deur', door: true, swing: 'buiten' });
    // Front wall runs along +x with the room at +y; opening outwards (−y), DIN-right: seen from outside the right hand is +x.
    const hinge = front.hingeAt === 'a' ? front.a : front.b;
    close(hinge.x, 0.3 + 2);
    expect(garage).toMatchObject({ style: 'roldeur', door: true });
  });
});

describe('pointInPolygon', () => {
  it('respects a margin', () => {
    const sq = rect(2, 2);
    expect(pointInPolygon({ x: 1, y: 1 }, sq)).toBe(true);
    expect(pointInPolygon({ x: 0.001, y: 1 }, sq, -0.005)).toBe(false);
    expect(pointInPolygon({ x: 3, y: 1 }, sq)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { cutawayFaces, exteriorFaces, faceNormal, project, stackLevels, viewDirection } from '../geometry/building';
import { computeBuilding, computePlattegrond, voidsFromAbove } from '../model/compute-plan';
import { exampleHouse } from '../model/examples';
import { PlattegrondItem } from '../model/models';
import { projectToCsv } from '../model/export';
import { cutawayView, elevationView, exteriorView, planView } from './house-views';
import { overviewSheet, singleSheet } from './sheet';
import { fit, fitStandard, measure, renderFitted, renderPrims, View } from './vector';

const house = exampleHouse();
const ground = house.items[0] as PlattegrondItem;
const upper = house.items[1] as PlattegrondItem;

function planOf(item: PlattegrondItem) {
  const r = computePlattegrond(item, house.items);
  if (r.status !== 'ok') throw new Error(r.message);
  return r.value;
}

describe('example house', () => {
  it('builds both floors without problems and matches the measured outside', () => {
    const g = planOf(ground);
    expect(g.plan.unplaced).toEqual([]);
    expect(g.incompleteRooms).toEqual([]);
    expect(g.plan.warnings).toEqual([]);
    expect(g.plan.width.computed).toBeCloseTo(8.8, 6);
    expect(g.plan.width.diff).toBeCloseTo(0.01, 6); // measured 8,810: 10 mm more
    expect(g.plan.depth.diff).toBeCloseTo(0, 6);
    expect(g.plan.netArea).toBeCloseTo(37 + 3.1 * 3.7 + 3.1 * 3.6, 6);
    // Doors between the hall and the other rooms show up on both sides.
    const doors = g.plan.openings.filter((o) => o.door && !o.exterior);
    expect(doors.map((d) => d.name).sort()).toEqual(['deur keuken', 'deur woonkamer']);
    const living = g.plan.rooms.find((r) => r.name === 'Woonkamer')!;
    expect(living.walls.flatMap((w) => w.openings).some((o) => !o.own && o.name === 'deur woonkamer')).toBe(true);
    // The sliding door is glass, not a swinging door.
    expect(g.plan.openings.find((o) => o.name === 'schuifpui')!.door).toBe(false);

    const u = planOf(upper);
    expect(u.plan.unplaced).toEqual([]);
    expect(u.plan.roof!.ridgeHeight).toBeCloseTo(2.5 + 4, 6); // plate at the highest room, 45° over 8 m
    expect(u.plateHeightAssumed).toBe(true);
    expect(u.plan.roof!.spanDiff).toBeCloseTo(0, 6);
  });

  it('stacks the floors with the floor thickness in between', () => {
    const levels = computeBuilding(upper, house.items);
    expect(levels.map((l) => l.name)).toEqual(['Begane grond', 'Verdieping']);
    expect(levels[1].base).toBeCloseTo(2.6 + 0.3, 6);
    expect(levels[0].above?.id).toBe(upper.id);
    // From the ground floor the same building is found.
    expect(computeBuilding(ground, house.items).map((l) => l.id)).toEqual(levels.map((l) => l.id));
  });

  it('exports a CSV row set for the floor plan', () => {
    const csv = projectToCsv(house);
    expect(csv).toContain('Begane grond;Plattegrond;Netto vloeroppervlak;');
    expect(csv).toContain('Verschil met gemeten breedte;10 mm');
  });
});

describe('3D model', () => {
  const levels = computeBuilding(upper, house.items);

  it('has facades on every side of both floors, roof planes and windows on the facades', () => {
    const faces = exteriorFaces(levels);
    const facades = faces.filter((f) => f.kind === 'facade');
    expect(facades.length).toBe(8); // rectangular house, two floors
    expect(faces.filter((f) => f.kind === 'roof')).toHaveLength(2);
    const decals = facades.flatMap((f) => f.decals);
    const exterior = levels.flatMap((l) => l.plan.openings.filter((o) => o.exterior));
    expect(decals).toHaveLength(exterior.length);
    // Gable walls of the upper floor reach the ridge.
    const top = Math.max(...facades.flatMap((f) => f.pts.map((p) => p.z)));
    expect(top).toBeCloseTo(2.9 + 6.5, 6);
    // Facade normals point outwards: away from the middle of the building.
    for (const f of facades) {
      const c = f.pts.reduce((s, p) => ({ x: s.x + p.x / f.pts.length, y: s.y + p.y / f.pts.length }), { x: 0, y: 0 });
      expect((c.x - 4.4) * f.normal.x + (c.y - 4) * f.normal.y).toBeGreaterThan(0);
    }
  });

  it('shows only faces turned to the camera, back to front', () => {
    const faces = exteriorFaces(levels);
    const front = project(faces, { azimuth: 0, elevation: 0 });
    // Seen straight from the front: two front facades (and their windows), the front roof plane.
    expect(front.filter((f) => f.kind === 'facade')).toHaveLength(2);
    expect(front.filter((f) => f.kind === 'roof')).toHaveLength(1);
    const dir = viewDirection({ azimuth: 0, elevation: 0 });
    expect(dir.y).toBeCloseTo(-1, 9);
    // Roof planes come after the walls they overhang.
    const kinds = front.map((f) => f.kind);
    expect(kinds.lastIndexOf('facade')).toBeLessThan(kinds.indexOf('roof'));
  });

  it('builds a cut-away of one floor with holes for the doors', () => {
    const faces = cutawayFaces(levels[0], 2.4);
    const inner = faces.filter((f) => f.kind === 'inner');
    expect(inner).toHaveLength(12);
    expect(inner.reduce((s, f) => s + f.holes.length, 0)).toBeGreaterThanOrEqual(7);
    expect(faces.find((f) => f.kind === 'cap')!.holes).toHaveLength(3);
  });

  it('computes normals with Newell', () => {
    const n = faceNormal([
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 1, z: 0 },
    ]);
    expect(n.z).toBeCloseTo(1, 9);
  });

  it('ignores floors that would stand on themselves', () => {
    const plan = planOf(ground).plan;
    const loop = stackLevels(
      [
        { id: 'a', name: 'a', plan, below: 'b', floorThickness: 0.3, dx: 0, dy: 0 },
        { id: 'b', name: 'b', plan, below: 'a', floorThickness: 0.3, dx: 0, dy: 0 },
      ],
      'a',
    );
    expect(loop.length).toBeLessThanOrEqual(2);
  });
});

describe('stairwell in the example', () => {
  it('lies in the landing, above the hall of the ground floor', () => {
    const u = planOf(upper);
    expect(u.plan.voids).toHaveLength(1);
    expect(u.plan.voidArea).toBeCloseTo(2.4 * 0.95, 9);
    expect(u.plan.warnings).toEqual([]);
    const levels = computeBuilding(upper, house.items);
    const below = voidsFromAbove(levels, ground.id);
    expect(below).toHaveLength(1);
    const hall = planOf(ground).plan.rooms.find((r) => r.name === 'Hal')!;
    const xs = hall.points.map((p) => p.x);
    const ys = hall.points.map((p) => p.y);
    for (const p of below[0].points) {
      expect(p.x).toBeGreaterThanOrEqual(Math.min(...xs) - 1e-6);
      expect(p.x).toBeLessThanOrEqual(Math.max(...xs) + 1e-6);
      expect(p.y).toBeGreaterThanOrEqual(Math.min(...ys) - 1e-6);
      expect(p.y).toBeLessThanOrEqual(Math.max(...ys) + 1e-6);
    }
    // Drawn crossed on the upper floor, dashed with an arrow below, and as a hole in the 3D floor.
    expect(planView(u.plan).prims.filter((p) => p.t === 'poly' && p.cls === 'void')).toHaveLength(1);
    const lower = planView(planOf(ground).plan, { fromAbove: below });
    expect(lower.prims.some((p) => p.t === 'text' && p.text === 'trapgat ↑')).toBe(true);
    const floors = cutawayFaces(levels[1], 2.4).filter((f) => f.kind === 'floor');
    expect(floors.reduce((n, f) => n + f.holes.length, 0)).toBe(1);
  });
});

describe('drawings', () => {
  const levels = computeBuilding(upper, house.items);
  const g = planOf(ground).plan;

  it('dimensions the plan along the front and side', () => {
    const v = planView(g);
    const dims = v.prims.filter((p) => p.t === 'dim').map((p) => (p as { text: string }).text);
    expect(dims).toContain('8800');
    expect(dims).toContain('8000');
    // Chain along the front: outer wall, living room, partition, hall, outer wall.
    for (const t of ['300', '5000', '100', '3100']) expect(dims).toContain(t);
    expect(v.prims.some((p) => p.t === 'text' && p.text === 'Woonkamer')).toBe(true);
  });

  it('dimensions an elevation with floor levels, eaves and ridge', () => {
    const v = elevationView(levels, 'voor');
    const texts = v.prims.flatMap((p) => (p.t === 'dim' || p.t === 'text' ? [p.text] : []));
    expect(texts).toContain('8800'); // width of the walls
    expect(texts).toContain('9200'); // roof with the gable overhang
    expect(texts).toContain('9400'); // ridge
    expect(texts).toContain('+2900'); // upper floor
    expect(texts).toContain('+5400'); // wall plate
    expect(texts).toContain('Begane grond'); // chain per floor
    const side = elevationView(levels, 'rechts');
    expect(side.prims.some((p) => p.t === 'dim' && p.text === '8000')).toBe(true);
  });

  it('renders SVG for the screen with escaped names', () => {
    const v: View = { prims: [{ t: 'text', at: { x: 0, y: 0 }, text: 'Hal <&>', cls: 'label' }, { t: 'line', pts: [{ x: 0, y: 0 }, { x: 4, y: 3 }], cls: 'sym' }] };
    const svg = renderFitted(v, 400, 300);
    expect(svg).toContain('Hal &lt;&amp;&gt;');
    expect(svg).toContain('class="bp-label"');
    expect(svg.startsWith('<svg')).toBe(true);
  });

  it('fits a view inside the box including its dimensions', () => {
    const v = planView(g);
    const pl = fit(v, 500, 400, 4);
    const b = measure(v, pl);
    expect(b.minX).toBeGreaterThan(-0.5);
    expect(b.maxX).toBeLessThan(500.5);
    expect(b.minY).toBeGreaterThan(-0.5);
    expect(b.maxY).toBeLessThan(400.5);
  });

  it('picks a standard scale for print', () => {
    const v = planView(g);
    const { denominator, placement } = fitStandard(v, 281, 166);
    expect(denominator).toBe(100);
    expect(placement.scale).toBe(10); // 10 mm per metre
    expect(renderPrims(v, placement)).toContain('8800');
  });

  it('puts one view or the overview on an A4 sheet at scale', () => {
    const meta = { project: 'Voorbeeld', subject: 'Begane grond', date: new Date(2026, 9, 9) };
    const one = singleSheet(planView(g), meta);
    expect(one).toContain('width="297mm"');
    expect(one).toContain('1:100');
    expect(one).toContain('9 oktober 2026');
    const views = {
      view3d: exteriorView(levels, { azimuth: -35, elevation: 25 }, '3D'),
      plan: planView(g, { roomDims: false, title: 'Plattegrond' }),
      elevations: (['voor', 'rechts', 'achter', 'links'] as const).map((s) => elevationView(levels, s, { chains: false })),
    };
    const all = overviewSheet(views, meta);
    for (const t of ['Voorgevel', 'Rechterzijgevel', 'Achtergevel', 'Linkerzijgevel', '3D', 'Plattegrond']) expect(all).toContain(t);
    expect(all).toContain('1:200 (3D niet op schaal)');
    const inside = cutawayView(levels[0], { azimuth: -30, elevation: 40 });
    expect(inside.prims.some((p) => p.t === 'text' && p.text === 'Hal')).toBe(true);
  });
});

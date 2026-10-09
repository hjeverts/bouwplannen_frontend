import { describe, expect, it } from 'vitest';
import { cutawayFaces, exteriorFaces, faceNormal, project, stackLevels, viewDirection } from '../geometry/building';
import { buildFloorPlan, PlanRoomInput } from '../geometry/floorplan';
import { roofSection } from '../geometry/geometry';
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
    expect(g.plan.depth.computed).toBeCloseTo(0.3 + 7.4 + 0.3 + 3 + 0.3, 6); // house, old back wall, extension
    expect(g.plan.netArea).toBeCloseTo(37 + 3.1 * 3.7 + 3.1 * 3.6 + 15, 6);
    // The extension has its own lean-to, the rest of the ground floor carries the upper floor.
    expect(g.plan.roofs).toHaveLength(1);
    const ext = g.plan.rooms.find((r) => r.name === 'Uitbouw')!;
    expect(g.plan.roomRoof[ext.index]).toBe(0);
    expect(g.plan.roomRoof.filter((x) => x === null)).toHaveLength(3);
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
    expect(u.plan.roof!.planes.map((p) => p.label)).toEqual(['voor', 'achter']);
    expect(u.plan.roof!.dormers).toHaveLength(1);
    expect(u.plan.roof!.windows).toHaveLength(1);
  });

  it('still reads floor plans saved with a single roof', () => {
    const old: PlattegrondItem = { ...upper, roofs: undefined, roofId: 'vw-kap', ridge: 'x', roofFlip: false, plateHeight: '' };
    const r = computePlattegrond(old, house.items);
    expect(r.status).toBe('ok');
    if (r.status === 'ok') {
      expect(r.value.plan.roofs).toHaveLength(1);
      expect(r.value.plan.roof!.ridgeHeight).toBeCloseTo(6.5, 6);
      expect(r.value.plan.roof!.dormers).toHaveLength(0);
    }
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
    // Upper floor: four sides. Ground floor: outline of house plus extension, and the old back wall
    // rising above the lean-to.
    expect(facades.filter((f) => f.level === 1)).toHaveLength(4);
    expect(facades.filter((f) => f.level === 0).length).toBeGreaterThanOrEqual(6);
    expect(faces.filter((f) => f.kind === 'roof')).toHaveLength(3); // gable roof + lean-to
    expect(faces.filter((f) => f.kind === 'dormer')).toHaveLength(3); // front and two cheeks
    const decals = facades.flatMap((f) => f.decals);
    const exterior = levels.flatMap((l) => l.plan.openings.filter((o) => o.exterior));
    expect(decals).toHaveLength(exterior.length);
    // Roof window on the front plane, window in the dormer.
    expect(faces.filter((f) => f.kind === 'roof').flatMap((f) => f.decals).map((d) => d.name)).toEqual(['dakraam']);
    expect(faces.filter((f) => f.kind === 'dormer').flatMap((f) => f.decals)).toHaveLength(1);
    // Gable walls of the upper floor reach the ridge.
    const top = Math.max(...facades.flatMap((f) => f.pts.map((p) => p.z)));
    expect(top).toBeCloseTo(2.9 + 6.5, 6);
    // Facade normals of the upper floor point outwards: away from the middle of the house.
    for (const f of facades.filter((x) => x.level === 1)) {
      const c = f.pts.reduce((s, p) => ({ x: s.x + p.x / f.pts.length, y: s.y + p.y / f.pts.length }), { x: 0, y: 0 });
      expect((c.x - 4.4) * f.normal.x + (c.y - 4) * f.normal.y).toBeGreaterThan(0);
    }

  });

  it('shows only faces turned to the camera, back to front', () => {
    const faces = exteriorFaces(levels);
    const front = project(faces, { azimuth: 0, elevation: 0 });
    // Seen straight from the front: front facades of both floors, the front roof plane (and the
    // lean-to behind, hidden by the house but not culled: it faces up).
    expect(front.filter((f) => f.kind === 'facade' && f.level === 1)).toHaveLength(1);
    expect(front.filter((f) => f.kind === 'roof').length).toBeGreaterThanOrEqual(1);
    const dir = viewDirection({ azimuth: 0, elevation: 0 });
    expect(dir.y).toBeCloseTo(-1, 9);
    // Roof planes come after the walls they overhang.
    const kinds = front.map((f) => f.kind);
    expect(kinds.lastIndexOf('facade')).toBeLessThan(kinds.indexOf('roof'));
  });

  it('builds a cut-away of one floor with holes for the doors', () => {
    const faces = cutawayFaces(levels[0], 2.4);
    const inner = faces.filter((f) => f.kind === 'inner');
    expect(inner).toHaveLength(16); // four rooms
    expect(inner.reduce((s, f) => s + f.holes.length, 0)).toBeGreaterThanOrEqual(7);
    expect(faces.find((f) => f.kind === 'cap')!.holes).toHaveLength(4);
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

describe('extensions, dormers and roof windows', () => {
  const rect = (w: number, d: number) => [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: d },
    { x: 0, y: d },
  ];
  const room = (id: string, w: number, d: number, h: number, link: PlanRoomInput['link'] = null): PlanRoomInput => ({
    id,
    name: id,
    points: rect(w, d),
    heights: [h, h, h, h],
    openings: [],
    volume: null,
    mirror: false,
    link,
  });
  // A tall barn (4 m) with a low extension (2,6 m) behind it, flat roofs.
  const barn = room('schuur', 6, 5, 4);
  const ext = room('aanbouw', 3, 2, 2.6, { to: 'schuur', wall: 0, toWall: 2, thickness: 0.3, offset: 0 });
  const level = (plan: ReturnType<typeof buildFloorPlan>) => stackLevels([{ id: 'a', name: 'a', plan, below: null, floorThickness: 0, dx: 0, dy: 0 }], 'a');

  it('gives each room its own flat roof and a wall rising above the lower one', () => {
    const plan = buildFloorPlan({ rooms: [barn, ext], outerWall: 0.3, measuredWidth: null, measuredDepth: null, turn: 0, flatThickness: 0.2 });
    const faces = exteriorFaces(level(plan));
    const flats = faces.filter((f) => f.kind === 'flat');
    expect(flats.map((f) => +f.pts[0].z.toFixed(3)).sort()).toEqual([2.8, 4.2]);
    // The barn's back wall above the extension faces backwards, from 2,8 to 4,2.
    const step = faces.find((f) => f.kind === 'facade' && f.normal.y > 0.99 && Math.min(...f.pts.map((p) => p.z)) > 2.7);
    expect(step).toBeDefined();
    expect(Math.min(...step!.pts.map((p) => p.z))).toBeCloseTo(2.8, 6);
    expect(Math.max(...step!.pts.map((p) => p.z))).toBeCloseTo(4.2, 6);
    // Facades: the outline jumps from 4,2 to 2,8 where the extension starts.
    const back = faces.filter((f) => f.kind === 'facade' && f.normal.y > 0.99);
    expect(back.some((f) => Math.abs(Math.max(...f.pts.map((p) => p.z)) - 2.8) < 1e-9)).toBe(true);
  });

  it('puts a lean-to over the extension only, with a dormer and a roof window on the main roof', () => {
    const lean = roofSection({ type: 'lessenaarsdak', span: 2.6, pitch: 15 });
    const gable = roofSection({ type: 'zadeldak', span: 5.6, pitch: 40 });
    const plan = buildFloorPlan({
      rooms: [barn, ext],
      outerWall: 0.3,
      measuredWidth: null,
      measuredDepth: null,
      turn: 0,
      roofs: [
        {
          key: '0',
          name: 'kap',
          section: gable,
          ridge: 'x',
          flip: false,
          plateHeight: 4,
          overhang: 0.3,
          gableOverhang: 0.2,
          length: null,
          rooms: ['schuur'],
          dormers: [{ name: 'dakkapel', plane: 1, offset: 1, width: 2, frontHeight: 1.2, setback: 0.5, windowWidth: 1.5, windowHeight: 0.8 }],
          windows: [{ name: 'dakraam', plane: 0, offset: 3, up: 0.8, width: 0.78, length: 1.18 }],
        },
        { key: '1', name: 'lessenaar', section: lean, ridge: 'x', flip: true, plateHeight: 2.6, overhang: 0, gableOverhang: 0, length: null, rooms: ['aanbouw'] },
      ],
    });
    expect(plan.warnings).toEqual([]);
    expect(plan.roomRoof).toEqual([0, 1]);
    const [main, leanTo] = plan.roofs;
    expect(main.planes.map((p) => p.label)).toEqual(['voor', 'achter']);
    // Main roof spans the barn only: 5,6 m across, not the extension.
    expect(main.spanDiff).toBeCloseTo(0, 6);
    // Lean-to high against the barn (front of the extension), low at the back.
    expect(leanTo.profile[0].z).toBeGreaterThan(leanTo.profile[1].z);
    // Dormer on the back plane: front 0,5 m in from the wall plate, 1,2 m high.
    const d = main.dormers[0];
    const zF = 4 + 0.5 * Math.tan((40 * Math.PI) / 180);
    expect(d.front[0].z).toBeCloseTo(zF, 6);
    expect(d.topHeight).toBeCloseTo(zF + 1.2, 6);
    expect(d.facing.y).toBe(1); // faces backwards
    expect(d.window).not.toBeNull();
    // Roof window 0,8 m up the front plane from the plate.
    const w = main.windows[0];
    expect(w.pts[0].z).toBeCloseTo(4 + 0.8 * Math.sin((40 * Math.PI) / 180), 6);
    const faces = exteriorFaces(level(plan));
    expect(faces.filter((f) => f.kind === 'roof')).toHaveLength(3);
    expect(faces.filter((f) => f.kind === 'dormer')).toHaveLength(3);
    // Plan: roof outlines, dormer and roof window.
    const v = planView(plan);
    expect(v.prims.filter((p) => p.t === 'line' && p.cls === 'roof-line' && p.closed)).toHaveLength(2);
    expect(v.prims.some((p) => p.t === 'text' && p.text === 'dakkapel')).toBe(true);
    expect(v.prims.some((p) => p.t === 'text' && p.text === 'dakraam')).toBe(true);
    // Dormers seen from the back sit in front of the roof plane in the drawing order.
    const back = project(faces, { azimuth: 180, elevation: 0 });
    const kinds = back.map((f) => f.kind);
    expect(kinds.lastIndexOf('dormer')).toBeGreaterThan(kinds.indexOf('roof'));
  });

  it('warns about dormers and roof windows that do not fit', () => {
    const gable = roofSection({ type: 'zadeldak', span: 5.6, pitch: 40 });
    const plan = buildFloorPlan({
      rooms: [barn],
      outerWall: 0.3,
      measuredWidth: null,
      measuredDepth: null,
      turn: 0,
      roofs: [
        {
          section: gable,
          ridge: 'x',
          flip: false,
          plateHeight: 4,
          overhang: 0,
          gableOverhang: 0,
          length: null,
          dormers: [{ name: 'hoog', plane: 0, offset: 0, width: 2, frontHeight: 5, setback: 0.5, windowWidth: null, windowHeight: null }],
          windows: [{ name: 'lang', plane: 1, offset: 6, up: 3, width: 1, length: 2 }],
        },
      ],
    });
    expect(plan.warnings.some((w) => /hoog: komt boven de nok uit/.test(w))).toBe(true);
    expect(plan.warnings.some((w) => /lang: past niet op het dakvlak/.test(w))).toBe(true);
    expect(plan.warnings.some((w) => /lang: valt \(deels\) buiten/.test(w))).toBe(true);
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
    expect(dims).toContain('11300');
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
    expect(texts).toContain('+5000'); // gutter: plate minus the drop of the overhang
    expect(texts).toContain('Begane grond'); // chain per floor
    const side = elevationView(levels, 'rechts');
    expect(side.prims.some((p) => p.t === 'dim' && p.text === '11300')).toBe(true);
    const sideTexts = side.prims.flatMap((p) => (p.t === 'text' ? [p.text] : []));
    expect(sideTexts).toEqual(expect.arrayContaining(['+2600', '+5400', '+6200', '+7700'])); // extension, plate, dormer
    expect(sideTexts).not.toContain('+8400'); // no marks for points halfway a sloping edge
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

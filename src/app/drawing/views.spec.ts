import { describe, expect, it } from 'vitest';
import { cutawayFaces, exteriorFaces, faceNormal, project, stackLevels, viewDirection } from '../geometry/building';
import { buildFloorPlan, PlanRoomInput } from '../geometry/floorplan';
import { roofSection } from '../geometry/geometry';
import { computeBuilding, computePlattegrond, lookOf, planContext, voidsFromAbove } from '../model/compute-plan';
import { exampleHouse } from '../model/examples';
import { PlattegrondItem } from '../model/models';
import { projectToCsv } from '../model/export';
import { cutawayView, elevationView, exteriorView, materialNotes, planView } from './house-views';
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
    // The toilet inside the extension takes its floor plus its two free walls (70 mm) from the extension.
    expect(g.plan.netArea).toBeCloseTo(37 + 3.1 * 3.7 + 3.1 * 3.6 + 15 - 1.47 * 1.07 + 1.4, 6);
    // The extension has its own lean-to, the rest of the ground floor carries the upper floor.
    expect(g.plan.roofs).toHaveLength(1);
    const ext = g.plan.rooms.find((r) => r.name === 'Uitbouw')!;
    expect(g.plan.roomRoof[ext.index]).toBe(0);
    expect(g.plan.roomRoof.filter((x) => x === null)).toHaveLength(3);
    // Doors between the hall and the other rooms show up on both sides.
    const doors = g.plan.openings.filter((o) => o.door && !o.exterior);
    expect(doors.map((d) => d.name).sort()).toEqual(['deur keuken', 'deur toilet', 'deur woonkamer']);
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
    expect(inner).toHaveLength(22); // five rooms, plus the outside of the toilet's two free walls
    expect(inner.reduce((s, f) => s + f.holes.length, 0)).toBeGreaterThanOrEqual(7);
    expect(faces.find((f) => f.kind === 'cap')!.holes).toHaveLength(5);
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

describe('door symbols', () => {
  it('draws the swing on the side the door opens to, and a roller door with its coil box and slats', () => {
    const rect = [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 4 },
      { x: 0, y: 4 },
    ];
    const mk = (swing: 'binnen' | 'buiten') =>
      buildFloorPlan({
        rooms: [
          {
            id: 'g',
            name: 'Garage',
            points: rect,
            heights: [2.6],
            volume: null,
            mirror: false,
            link: null,
            openings: [
              { name: 'deur', wall: 1, offset: 1, width: 0.9, height: 2.1, sill: 0, swing },
              { name: 'roldeur', wall: 0, offset: 0.3, width: 2.4, height: 2.2, sill: 0 },
            ],
          },
        ],
        outerWall: 0.3,
        measuredWidth: null,
        measuredDepth: null,
        turn: 0,
        roofs: [],
      });
    const swingX = (swing: 'binnen' | 'buiten') => {
      const v = planView(mk(swing), { roomDims: false });
      // The quarter-circle of the door: the thin line with 17 points.
      const arc = v.prims.find((p) => p.t === 'line' && p.cls === 'sym-thin' && p.pts.length === 17) as { pts: { x: number }[] };
      return Math.max(...arc.pts.map((p) => p.x));
    };
    // Right wall at x = 3,3 (inside face) / 3,6 (outside face): inwards the swing stays left of it, outwards right.
    expect(swingX('binnen')).toBeLessThan(3.31);
    expect(swingX('buiten')).toBeGreaterThan(3.61);
    const plan = mk('binnen');
    expect(planView(plan).prims.some((p) => p.t === 'text' && p.text === 'roldeur ↑')).toBe(true);
    const levels = stackLevels([{ id: 'g', name: 'Garage', plan, below: null, floorThickness: 0.3, dx: 0, dy: 0 }], 'g');
    const front = elevationView(levels, 'voor');
    expect(front.prims.some((p) => p.t === 'poly' && p.cls === 'f-roll')).toBe(true);
    expect(front.prims.filter((p) => p.t === 'line' && p.cls === 'slat').length).toBeGreaterThan(5);
  });
});

describe('room inside another room', () => {
  it('places the toilet in the corner of the extension and carves it out', () => {
    const g = planOf(ground).plan;
    const ext = g.rooms.find((r) => r.name === 'Uitbouw')!;
    const wc = g.rooms.find((r) => r.name === 'Toilet')!;
    expect(wc.host).toBe(ext.index);
    expect(g.warnings).toEqual([]);
    // Every corner of the toilet lies in the extension.
    const xs = ext.points.map((p) => p.x);
    const ys = ext.points.map((p) => p.y);
    for (const p of wc.points) {
      expect(p.x).toBeGreaterThanOrEqual(Math.min(...xs) - 1e-6);
      expect(p.x).toBeLessThanOrEqual(Math.max(...xs) + 1e-6);
      expect(p.y).toBeGreaterThanOrEqual(Math.min(...ys) - 1e-6);
      expect(p.y).toBeLessThanOrEqual(Math.max(...ys) + 1e-6);
    }
    expect(wc.area).toBeCloseTo(1.4, 9);
    expect(ext.area).toBeCloseTo(15 - 1.47 * 1.07, 6);
    // The free walls face the extension through a 70 mm wall; the wall against the house is shared.
    const free = wc.walls.filter((w) => w.neighbours.some((n) => n.wall === -1));
    expect(free).toHaveLength(2);
    expect(free[0].neighbours[0].thickness).toBeCloseTo(0.07, 9);
    const shared = wc.walls[0];
    expect(shared.neighbours.some((n) => g.rooms[n.room].name === 'Woonkamer')).toBe(true);
    // Its door is an inside door in a 70 mm wall, not an outside door.
    const door = g.openings.find((o) => o.name === 'deur toilet')!;
    expect(door.exterior).toBe(false);
    expect(door.thickness).toBeCloseTo(0.07, 9);
    // Drawn as a box in the plan: the extension's floor has the toilet cut out.
    expect(ext.floor.length).toBe(1);
    expect(planView(g).prims.some((p) => p.t === 'text' && p.text === 'Toilet')).toBe(true);
  });

  it('warns when the inner room does not fit', () => {
    const big: PlanRoomInput = {
      id: 'b',
      name: 'Berging',
      points: [
        { x: 0, y: 0 },
        { x: 3, y: 0 },
        { x: 3, y: 3 },
        { x: 0, y: 3 },
      ],
      heights: [2.6],
      openings: [],
      volume: null,
      mirror: false,
      link: null,
    };
    const wc: PlanRoomInput = {
      ...big,
      id: 'w',
      name: 'Toilet',
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1.2 },
        { x: 0, y: 1.2 },
      ],
      link: { to: 'b', wall: 0, toWall: 0, thickness: 0.07, offset: 2.5, inside: true, distance: 0 },
    };
    const fp = buildFloorPlan({ rooms: [big, wc], outerWall: 0.3, measuredWidth: null, measuredDepth: null, turn: 0, roofs: [] });
    expect(fp.warnings.some((w) => /Toilet steekt buiten Berging uit/.test(w))).toBe(true);
    // In the middle of the room: four free walls and a hole in the floor.
    const mid = buildFloorPlan({
      rooms: [big, { ...wc, link: { ...wc.link!, offset: 1, distance: 0.9 } }],
      outerWall: 0.3,
      measuredWidth: null,
      measuredDepth: null,
      turn: 0,
      roofs: [],
    });
    expect(mid.warnings).toEqual([]);
    expect(mid.rooms[1].walls.filter((w) => w.neighbours.some((n) => n.wall === -1))).toHaveLength(4);
    expect(mid.rooms[0].floor.length).toBe(2);
    expect(mid.rooms[0].area).toBeCloseTo(9 - 1.14 * 1.34, 6);
  });
});


describe('loft without walls and floor heights', () => {
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
    heights: [h],
    openings: [],
    volume: null,
    mirror: false,
    link,
  });
  const plan = (rooms: PlanRoomInput[], open = false) =>
    buildFloorPlan({ open, rooms, outerWall: 0.3, measuredWidth: null, measuredDepth: null, turn: 0, roofs: [] });

  it('puts a floor over the low part at the height of that part, not the highest room', () => {
    // Living part 2,6 m high, garage next to it 4 m high; the upper floor covers the living part only.
    const ground = plan([room('wonen', 5, 6, 2.6), room('garage', 4, 6, 4, { to: 'wonen', wall: 3, toWall: 1, thickness: 0.2, offset: 0 })]);
    const upper = plan([room('kamer', 5, 6, 2.5)]);
    const levels = stackLevels(
      [
        { id: 'bg', name: 'bg', plan: ground, below: null, floorThickness: 0.3, dx: 0, dy: 0 },
        { id: 'v1', name: 'v1', plan: upper, below: 'bg', floorThickness: 0.3, dx: 0, dy: 0 },
      ],
      'v1',
    );
    expect(levels[1].base).toBeCloseTo(2.6 + 0.3, 9);
    // An explicit height wins.
    const set = stackLevels(
      [
        { id: 'bg', name: 'bg', plan: ground, below: null, floorThickness: 0.3, dx: 0, dy: 0 },
        { id: 'v1', name: 'v1', plan: upper, below: 'bg', floorThickness: 0.3, dx: 0, dy: 0, floorHeight: 3.1 },
      ],
      'v1',
    );
    expect(set[1].base).toBeCloseTo(3.1, 9);
  });

  it('places a loft inside the garage: no walls, no facades, the garage walls stay full height', () => {
    const garage = plan([room('garage', 6, 8, 3.5)]);
    const loft = plan([room('vliering', 6, 3, 1)], true);
    expect(loft.outerWall).toBe(0);
    expect(loft.wallRings.length).toBe(0);
    const levels = stackLevels(
      [
        { id: 'g', name: 'Garage', plan: garage, below: null, floorThickness: 0.3, dx: 0, dy: 0 },
        { id: 'l', name: 'Vliering', plan: loft, below: 'g', floorThickness: 0.2, dx: 0.3, dy: 0.3 + 5, floorHeight: 2.4, open: true },
      ],
      'l',
    );
    const [g, l] = levels;
    expect(l.open).toBe(true);
    expect(l.base).toBeCloseTo(2.4, 9);
    expect(g.above).toBeNull(); // a loft is not a floor on top
    const faces = exteriorFaces(levels);
    expect(faces.every((f) => f.level === 0)).toBe(true);
    const top = Math.max(...faces.filter((f) => f.kind === 'facade').flatMap((f) => f.pts.map((p) => p.z)));
    expect(top).toBeCloseTo(3.5 + 0.3, 6); // garage walls up to its own flat roof
    // The garage plan shows the loft dashed with its height; the loft shows the garage underneath.
    const ctx = planContext(levels, 'g');
    expect(ctx.lofts).toHaveLength(1);
    expect(ctx.lofts[0].height).toBeCloseTo(2.4, 9);
    const gv = planView(garage, ctx);
    expect(gv.prims.some((p) => p.t === 'text' && p.text === 'Vliering +2400')).toBe(true);
    expect(planContext(levels, 'l').under).toHaveLength(1);
    // Inside view: the garage cut under the loft with the loft slab on top.
    const inside = cutawayView(l, { azimuth: -30, elevation: 35 }, 'x', g);
    expect(inside.prims.some((p) => p.t === 'text' && p.text === 'vliering')).toBe(true);
    // The elevations do not mark the loft as a floor level.
    const front = elevationView(levels, 'voor');
    expect(front.prims.some((p) => p.t === 'text' && p.text === '+2400')).toBe(false);
  });

  it('lines a loft up with the inside of the walls when no shift is given', () => {
    const now = new Date().toISOString();
    const vorm = (id: string, w: number, d: number, h: string) =>
      ({
        id,
        kind: 'vorm',
        name: id,
        notes: '',
        updated: now,
        method: 'hoeken',
        sides: [String(w), String(d), String(w), String(d)],
        diagonals: [''],
        flips: [false, false, false, false],
        angles: ['90', '90'],
        height: h,
        heightMode: 'gelijk',
        heights: ['', '', '', ''],
        openings: [],
      }) as const;
    const base = { notes: '', updated: now, measuredWidth: '', measuredDepth: '', turn: 0, roofId: '', ridge: 'x' as const, roofFlip: false, plateHeight: '', floorThickness: '0,2', shiftX: '', shiftY: '' };
    const items = [
      vorm('garage', 6, 8, '3,5'),
      vorm('vliering', 6, 3, ''),
      { ...base, id: 'g', kind: 'plattegrond' as const, name: 'Garage', rooms: [{ roomId: 'garage' }], outerWall: '0,3', below: '' },
      { ...base, id: 'l', kind: 'plattegrond' as const, name: 'Vliering', rooms: [{ roomId: 'vliering' }], outerWall: '', below: 'g', open: true, floorHeight: '2,4' },
    ] as unknown as PlattegrondItem[];
    const r = computePlattegrond(items[3], items);
    expect(r.status).toBe('ok');
    const levels = computeBuilding(items[3], items);
    const loft = levels.find((x) => x.id === 'l')!;
    expect(loft.offset.x).toBeCloseTo(0.3, 9);
    expect(loft.offset.y).toBeCloseTo(0.3, 9);
    expect(loft.base).toBeCloseTo(2.4, 9);
  });
});

describe('attic: walls follow the roof', () => {
  const attic = (openings: PlanRoomInput['openings']): PlanRoomInput => ({
    id: 'z',
    name: 'Zolder',
    points: [
      { x: 0, y: 0 },
      { x: 8.2, y: 0 },
      { x: 8.2, y: 7.4 },
      { x: 0, y: 7.4 },
    ],
    heights: [2.6],
    openings,
    volume: null,
    mirror: false,
    link: null,
    followRoof: true,
  });
  const section = roofSection({ type: 'zadeldak', span: 8, pitch: 45 });
  const build = (openings: PlanRoomInput['openings']) =>
    buildFloorPlan({
      rooms: [attic(openings)],
      outerWall: 0.3,
      measuredWidth: null,
      measuredDepth: null,
      turn: 0,
      roofs: [{ section, ridge: 'x', flip: false, plateHeight: 0, overhang: 0, gableOverhang: 0, length: null, name: 'Kap', dormers: [], windows: [] }],
    });

  it('takes its heights, volume and the floor at least 1,50 m high from the roof', () => {
    const fp = build([]);
    const r = fp.rooms[0];
    expect(r.followsRoof).toBe(true);
    // Inside face of the eaves wall is 0,3 m in from the plate: 0,3 m high at 45°.
    expect(r.heights[0]).toBeCloseTo(0.3, 9);
    // The gable wall (2–3) bends under the ridge at 4 m.
    const gable = r.walls[1];
    expect(gable.top!.map((p) => Math.round(p.z * 1000) / 1000)).toEqual([0.3, 4, 0.3]);
    expect(r.volume).toBeCloseTo(8.2 * (16 - 0.09), 6);
    expect(r.usableArea).toBeCloseTo(8.2 * 5, 6);
    expect(fp.volume).toBeCloseTo(8.2 * (16 - 0.09), 6);
    // Wall area: two gables (triangle-ish) and two eaves walls of 0,3 m.
    const gableArea = 2 * (((0.3 + 4) / 2) * 3.7);
    expect(r.netWallArea).toBeCloseTo(2 * gableArea + 2 * 8.2 * 0.3, 6);
  });

  it('puts a window high in the gable and warns when it does not fit under the slope', () => {
    const ok = build([{ name: 'raam', wall: 1, offset: 3.2, width: 1, height: 1.2, sill: 0.8 }]);
    expect(ok.warnings).toEqual([]);
    const levels = stackLevels([{ id: 'z', name: 'Zolder', plan: ok, below: null, floorThickness: 0.3, dx: 0, dy: 0 }], 'z');
    const decals = exteriorFaces(levels).flatMap((f) => f.decals);
    expect(decals).toHaveLength(1);
    expect(Math.max(...decals[0].pts.map((p) => p.z))).toBeCloseTo(2, 9);
    const side = elevationView(levels, 'rechts');
    expect(side.prims.some((p) => p.t === 'poly' && p.cls === 'f-glass')).toBe(true);
    const off = build([{ name: 'raam', wall: 1, offset: 7, width: 1, height: 1, sill: 0.8 }]);
    expect(off.warnings.some((w) => /raam past niet op wand 2–3 van Zolder/.test(w))).toBe(true);
    const low = build([{ name: 'raam', wall: 1, offset: 0.5, width: 1, height: 1.2, sill: 0.8 }]);
    expect(low.warnings.some((w) => /raam in Zolder past niet onder de kap/.test(w))).toBe(true);
    // The plan shows where it is 1,50 m high; the inside view shows the walls up to the roof.
    const plan = planView(ok);
    expect(plan.prims.filter((p) => p.t === 'text' && p.text === '1500')).toHaveLength(2);
    const inner = cutawayFaces(levels[0], Infinity).filter((f) => f.kind === 'inner');
    expect(Math.max(...inner.flatMap((f) => f.pts.map((p) => p.z)))).toBeCloseTo(4, 9);
    expect(inner.reduce((n, f) => n + f.holes.length, 0)).toBe(1);
  });
});

describe('attic through the model', () => {
  it('uses the openings of a room without heights and puts the plate on the attic floor', () => {
    const now = new Date().toISOString();
    const items = [
      {
        id: 'zv',
        kind: 'vorm',
        name: 'Zolder',
        notes: '',
        updated: now,
        method: 'hoeken',
        sides: ['8,2', '7,4', '8,2', '7,4'],
        diagonals: [''],
        flips: [false, false, false, false],
        angles: ['90', '90'],
        height: '',
        heightMode: 'kap',
        heights: ['', '', '', ''],
        openings: [{ name: 'raam', wall: '1', offset: '3,2', width: '1', height: '1,2', sill: '0,8' }],
      },
      { id: 'kap', kind: 'dak', name: 'Kap', notes: '', updated: now, roofType: 'zadeldak', span: '8', rise: '', pitch: '45', rafter: '', ridgeOffset: '', overhang: '', length: '' },
      {
        id: 'zp',
        kind: 'plattegrond',
        name: 'Zolder',
        notes: '',
        updated: now,
        rooms: [{ roomId: 'zv' }],
        outerWall: '0,3',
        measuredWidth: '',
        measuredDepth: '',
        turn: 0,
        roofId: 'kap',
        ridge: 'x',
        roofFlip: false,
        plateHeight: '',
        below: '',
        floorThickness: '0,3',
        shiftX: '',
        shiftY: '',
      },
    ] as unknown as PlattegrondItem[];
    const r = computePlattegrond(items[2], items);
    if (r.status !== 'ok') throw new Error(r.message);
    expect(r.value.plateHeight).toBe(0);
    expect(r.value.assumedHeight).toEqual([]);
    const room = r.value.plan.rooms[0];
    expect(room.followsRoof).toBe(true);
    expect(room.walls[1].openings).toHaveLength(1);
    expect(r.value.plan.openings[0].exterior).toBe(true);
    expect(r.value.plan.warnings).toEqual([]);
    expect(projectToCsv({ id: 'p', name: 'p', created: now, updated: now, items } as never)).toContain('Zolder vloer ≥ 1,50 m;41,00 m²');
  });
});

describe('attic floor inside the roof of the floor below', () => {
  const now = new Date().toISOString();
  const vorm = (id: string, h: string, mode: string, openings: unknown[] = []) => ({
    id,
    kind: 'vorm',
    name: id,
    notes: '',
    updated: now,
    method: 'hoeken',
    sides: ['8,2', '7,4', '8,2', '7,4'],
    diagonals: [''],
    flips: [false, false, false, false],
    angles: ['90', '90'],
    height: h,
    heightMode: mode,
    heights: ['', '', '', ''],
    openings,
  });
  const floor = (id: string, room: string, extra: object) => ({
    id,
    kind: 'plattegrond',
    name: id,
    notes: '',
    updated: now,
    rooms: [{ roomId: room }],
    outerWall: '0,3',
    measuredWidth: '',
    measuredDepth: '',
    turn: 0,
    roofId: '',
    ridge: 'x',
    roofFlip: false,
    plateHeight: '',
    below: '',
    floorThickness: '0,25',
    shiftX: '',
    shiftY: '',
    ...extra,
  });
  const items = [
    vorm('Slaapverdieping', '2,5', 'gelijk'),
    vorm('Zolder', '', 'kap', [{ name: 'zolderraam', wall: '1', offset: '3,2', width: '1', height: '1,2', sill: '0,8' }]),
    { id: 'kap', kind: 'dak', name: 'Kap', notes: '', updated: now, roofType: 'zadeldak', span: '8', rise: '', pitch: '45', rafter: '', ridgeOffset: '', overhang: '', length: '' },
    floor('v1', 'Slaapverdieping', { roofId: 'kap' }),
    floor('zo', 'Zolder', { below: 'v1' }),
  ] as unknown as PlattegrondItem[];

  it('lets the attic rooms follow the roof that stands on the floor below, without assuming a height', () => {
    const r = computePlattegrond(items[4], items);
    if (r.status !== 'ok') throw new Error(r.message);
    const plan = r.value.plan;
    expect(plan.warnings).toEqual([]);
    expect(r.value.assumedHeight).toEqual([]);
    expect(plan.insideRoof).toBe(true);
    const room = plan.rooms[0];
    expect(room.followsRoof).toBe(true);
    // Plate 2,5 m above the floor below, attic floor 2,5 + 0,25 higher: 0,05 m at the inside of the eaves wall, 3,75 m under the ridge.
    expect(room.heights[0]).toBeCloseTo(0.05, 9);
    expect(Math.max(...room.walls[1].top!.map((p) => p.z))).toBeCloseTo(3.75, 9);
    expect(room.volume).toBeCloseTo(8.2 * 2 * 7.03, 6);

    const levels = computeBuilding(items[4], items);
    expect(levels.map((l) => l.id)).toEqual(['v1', 'zo']);
    expect(levels[1].base).toBeCloseTo(2.75, 9);
    const faces = exteriorFaces(levels);
    // No facades or flat roof for the attic: the floor below with its roof is the outside.
    expect(faces.every((f) => f.level === 0)).toBe(true);
    const decals = faces.flatMap((f) => f.decals);
    expect(decals.map((d) => d.name)).toEqual(['zolderraam']);
    expect(Math.min(...decals[0].pts.map((p) => p.z))).toBeCloseTo(2.75 + 0.8, 9);
    // The elevation shows the eaves, not the attic floor (not seen from outside, it would hide the eaves).
    const side = elevationView(levels, 'rechts').prims.flatMap((p) => (p.t === 'text' ? [p.text] : []));
    expect(side).toContain('+2500');
    expect(side).not.toContain('+2750');
  });
});

describe('rooms without a height', () => {
  it('follow the roof when there is one, and get an assumed height otherwise', () => {
    const now = new Date().toISOString();
    const vorm = { id: 'r', kind: 'vorm', name: 'Zolder', notes: '', updated: now, method: 'hoeken', sides: ['8,2', '7,4', '8,2', '7,4'], diagonals: [''], flips: [false, false, false, false], angles: ['90', '90'], height: '', heightMode: 'gelijk', heights: ['', '', '', ''], openings: [] };
    const dak = { id: 'kap', kind: 'dak', name: 'Kap', notes: '', updated: now, roofType: 'zadeldak', span: '8', rise: '', pitch: '45', rafter: '', ridgeOffset: '', overhang: '', length: '' };
    const plan = (roofId: string) => ({ id: 'p', kind: 'plattegrond', name: 'p', notes: '', updated: now, rooms: [{ roomId: 'r' }], outerWall: '0,3', measuredWidth: '', measuredDepth: '', turn: 0, roofId, ridge: 'x', roofFlip: false, plateHeight: '', below: '', floorThickness: '0,3', shiftX: '', shiftY: '' });
    const withRoof = computePlattegrond(plan('kap') as never, [vorm, dak] as never);
    if (withRoof.status !== 'ok') throw new Error(withRoof.message);
    expect(withRoof.value.assumedHeight).toEqual([]);
    expect(withRoof.value.plan.rooms[0].followsRoof).toBe(true);
    const flat = computePlattegrond(plan('') as never, [vorm, dak] as never);
    if (flat.status !== 'ok') throw new Error(flat.message);
    expect(flat.value.assumedHeight).toEqual(['Zolder']);
    expect(flat.value.plan.warnings).toEqual([]);
  });
});

describe('typing errors', () => {
  it('warns about a floor thickness of 49 m instead of drawing it', () => {
    const items = exampleHouse().items.map((i) => (i.id === 'vw-1' ? { ...i, floorThickness: '49' } : i));
    const r = computePlattegrond(items.find((i) => i.id === 'vw-1') as PlattegrondItem, items);
    if (r.status !== 'ok') throw new Error(r.message);
    expect(r.value.plan.warnings.some((w) => /Vloerdikte is 49,000 m: dat lijkt een typfout\. Bedoel je 0,490 m\?/.test(w))).toBe(true);
  });
});

describe('gable of an attic under a roof without wall plate', () => {
  // Hans's case: the roof sits on the attic floor, plate 0, so the gable starts exactly at the floor.
  const now = '';
  const vorm = (id: string, w: string, d: string, h: string, mode: string, openings: unknown[] = []) => ({ id, kind: 'vorm', name: id, notes: '', updated: now, method: 'hoeken', sides: [w, d, w, d], diagonals: [''], flips: [false, false, false, false], angles: ['90', '90'], height: h, heightMode: mode, heights: ['', '', '', ''], openings });
  const floor = (id: string, room: string, extra: object) => ({ id, kind: 'plattegrond', name: id, notes: '', updated: now, rooms: [{ roomId: room }], outerWall: '0.3', measuredWidth: '', measuredDepth: '', turn: 0, roofId: '', ridge: 'x', roofFlip: false, plateHeight: '', below: '', floorThickness: '0.3', shiftX: '', shiftY: '', ...extra });
  const items = [
    vorm('w', '7.4', '5.9', '2.8', 'gelijk'),
    vorm('z', '7.7', '6.2', '', 'kap', [{ name: 'raam', wall: '3', offset: '3', width: '0.5', height: '0.8', sill: '0.3' }]),
    { id: 'kap', kind: 'dak', name: 'Kap', notes: '', updated: now, roofType: 'zadeldak', span: '6.5', rise: '2', pitch: '', rafter: '', ridgeOffset: '', overhang: '', length: '' },
    floor('bg', 'w', {}),
    floor('zo', 'z', { below: 'bg', outerWall: '0.15', roofs: [{ roofId: 'kap', rooms: [], ridge: 'x', flip: false, plateHeight: '', dormers: [], windows: [] }] }),
  ] as never[];

  it('builds both gables as whole triangles, with the window on the left one', () => {
    const levels = computeBuilding(items[4], items);
    const gables = exteriorFaces(levels).filter((f) => f.kind === 'facade' && f.level === 1 && Math.abs(f.normal.x) > 0.9);
    expect(gables.length).toBe(2);
    for (const g of gables) {
      const ys = g.pts.map((p) => p.y);
      expect(Math.min(...ys)).toBeCloseTo(0, 6);
      expect(Math.max(...ys)).toBeCloseTo(6.5, 6);
      expect(Math.max(...g.pts.map((p) => p.z))).toBeCloseTo(5.1, 6);
    }
    expect(gables.find((g) => g.normal.x < 0)!.decals.length).toBe(1);
    expect(gables.find((g) => g.normal.x > 0)!.decals.length).toBe(0);
  });
});

describe('cladding, frame colour and roof covering', () => {
  /** The example house in brick, a black-boarded extension, anthracite frames and tiles, a white dormer. */
  const dressed = () => {
    const items = exampleHouse().items.map((i) => {
      if (i.kind !== 'plattegrond') return i;
      const p = i as PlattegrondItem;
      return {
        ...p,
        cladding: { type: 'metselwerk', colour: '' },
        frameColour: '#383E42',
        rooms: p.rooms.map((r, k) => (p.id === 'vw-bg' && k === 3 ? { ...r, cladding: { type: 'rabat', colour: '' } } : r)),
        roofs: (p.roofs ?? []).map((r) => ({ ...r, covering: { type: 'pannen', colour: '#3d4043' }, dormerCladding: { type: 'rabat', colour: '#f4f4ef' } })),
      };
    });
    return { items, levels: computeBuilding(items[0] as PlattegrondItem, items) };
  };

  it('has no look until something is chosen', () => {
    const ground = house.items.find((i) => i.id === 'vw-bg') as PlattegrondItem;
    expect(lookOf(ground)).toBeNull();
    expect(lookOf({ ...ground, cladding: { type: '', colour: '#ff0000' }, frameColour: 'rood' })).toBeNull();
    const look = lookOf({ ...ground, frameColour: '#383E42' })!;
    expect(look.frame).toBe('#383e42');
    expect(look.cladding).toBeNull();
  });

  it('keeps the plain look without choices', () => {
    const levels = computeBuilding(house.items[0] as PlattegrondItem, house.items);
    const faces = exteriorFaces(levels);
    expect(faces.some((f) => f.finish)).toBe(false);
    const proj = project(faces, { azimuth: 0, elevation: 0 });
    expect(proj.some((f) => f.colour || f.lines || f.kind === 'frame')).toBe(false);
  });

  it('clads each room as chosen, its own choice first', () => {
    const { items, levels } = dressed();
    const ground = items.find((i) => i.id === 'vw-bg') as PlattegrondItem;
    const extension = ground.rooms[3].roomId;
    const lv = levels.find((l) => l.id === 'vw-bg')!;
    const room = lv.plan.rooms.find((r) => r.id === extension)!;
    const facades = exteriorFaces(levels).filter((f) => f.kind === 'facade' && f.level === levels.indexOf(lv));
    expect(facades.every((f) => f.finish)).toBe(true);
    const boarded = facades.filter((f) => f.finish!.type === 'rabat');
    expect(boarded.length).toBeGreaterThan(0);
    // The boarded walls are those of the extension: every corner on (or just outside) its outline.
    const grownExt = room.points;
    const ys = grownExt.map((p) => p.y);
    for (const f of boarded) for (const p of f.pts) expect(p.y - lv.offset.y).toBeGreaterThanOrEqual(Math.min(...ys) - 0.31);
    expect(facades.filter((f) => f.finish!.type === 'metselwerk').length).toBeGreaterThan(0);
  });

  it('covers roofs and dormers, and frames the windows and doors', () => {
    const { levels } = dressed();
    const faces = exteriorFaces(levels);
    const roofs = faces.filter((f) => f.kind === 'roof');
    expect(roofs.length).toBeGreaterThan(0);
    for (const r of roofs) expect(r.finish).toEqual({ type: 'pannen', colour: '#3d4043' });
    const dormers = faces.filter((f) => f.kind === 'dormer');
    expect(dormers.length).toBe(3);
    for (const d of dormers) expect(d.finish).toEqual({ type: 'rabat', colour: '#f4f4ef' });
    const decals = faces.flatMap((f) => f.decals);
    const facadeDecals = faces.filter((f) => f.kind !== 'roof').flatMap((f) => f.decals);
    expect(facadeDecals.length).toBeGreaterThan(5);
    for (const d of facadeDecals) expect(d.frame).toBe('#383e42');
    // Roof windows keep their own (grey) frame.
    for (const d of faces.filter((f) => f.kind === 'roof').flatMap((f) => f.decals)) expect(d.frame).toBeUndefined();
    expect(decals.length).toBeGreaterThan(facadeDecals.length);
  });

  it('draws frames under the glass, without changing the dimensions', () => {
    const plain = elevationView(computeBuilding(house.items[0] as PlattegrondItem, house.items), 'voor');
    const { levels } = dressed();
    const view = elevationView(levels, 'voor');
    const dims = (v: View) => v.prims.filter((p) => p.t === 'dim').map((p) => (p as { text: string }).text);
    expect(dims(view)).toEqual(dims(plain));
    const proj = project(exteriorFaces(levels), { azimuth: 0, elevation: 0 });
    const frames = proj.filter((f) => f.kind === 'frame');
    expect(frames.length).toBeGreaterThan(0);
    // Each frame is followed by the glass or door leaf inside it.
    for (const f of frames) {
      const next = proj[proj.indexOf(f) + 1];
      expect(next.inner).toBe(true);
      const xs = (g: typeof f) => g.rings[0].map((p) => p.x);
      expect(Math.min(...xs(next))).toBeGreaterThan(Math.min(...xs(f)));
      expect(Math.max(...xs(next))).toBeLessThan(Math.max(...xs(f)));
    }
    // A door leaf in the frame colour.
    expect(proj.some((f) => f.kind === 'door' && f.colour === '#383e42')).toBe(true);
  });

  it('renders the patterns and names the materials on the elevation', () => {
    const { levels } = dressed();
    expect(materialNotes(levels)).toEqual([
      'Gevel: Metselwerk, rood / Rabatdelen horizontaal, zwart',
      'Kozijnen: antraciet',
      'Dak: Dakpannen, antraciet',
      'Dakkapel: Rabatdelen horizontaal, wit',
    ]);
    const view = elevationView(levels, 'voor');
    expect(view.prims.filter((p) => p.t === 'segs').length).toBeGreaterThan(0);
    const texts = view.prims.filter((p) => p.t === 'text').map((p) => (p as { text: string }).text);
    expect(texts).toContain('Kozijnen: antraciet');
    const svg = renderFitted(view, 800, 600);
    expect(svg).toContain('class="bp-pattern"');
    expect(svg).toMatch(/style="fill:rgb\(/);
    // A light drawing leaves out the head joints.
    const full = project(exteriorFaces(levels), { azimuth: -35, elevation: 25 });
    const light = project(exteriorFaces(levels), { azimuth: -35, elevation: 25 }, { light: true });
    const count = (ps: typeof full) => ps.reduce((n, f) => n + (f.lines?.length ?? 0), 0);
    expect(count(light)).toBeLessThan(count(full) / 3);
    expect(materialNotes(computeBuilding(house.items[0] as PlattegrondItem, house.items))).toEqual([]);
  });
});

describe('overhang per side in the elevations', () => {
  const leanToEdge = (patch: object) => {
    const items = exampleHouse().items.map((i) => (i.id === 'vw-kap-uitbouw' ? { ...i, ...patch } : i));
    const levels = computeBuilding(items[1] as PlattegrondItem, items);
    const proj = project(exteriorFaces(levels), { azimuth: -90, elevation: 0 });
    // Seen from the right, the lean-to of the ground floor is side-on: one edge line.
    const edges = proj.filter((f) => f.kind === 'edge' && f.level === 0);
    expect(edges.length).toBe(1);
    const xs = edges[0].rings[0].map((p) => p.x);
    return { min: Math.min(...xs), max: Math.max(...xs), view: elevationView(levels, 'rechts') };
  };

  it('shows the roof edge side-on, with or without the overhang against the house', () => {
    const both = leanToEdge({});
    const none = leanToEdge({ overhangRight: '0' });
    // The high side against the house loses its 0,30 m overhang; the low side keeps it.
    expect(none.min - both.min).toBeCloseTo(0.3, 6);
    expect(none.max).toBeCloseTo(both.max, 6);
    expect(renderFitted(both.view, 800, 600)).toContain('class="bp-roof-edge"');
  });
});

describe('attic under a roof with a build-up', () => {
  const now = '';
  const vorm = (id: string, w: string, d: string, h: string, mode: string) => ({ id, kind: 'vorm', name: id, notes: '', updated: now, method: 'hoeken', sides: [w, d, w, d], diagonals: [''], flips: [false, false, false, false], angles: ['90', '90'], height: h, heightMode: mode, heights: ['', '', '', ''], openings: [] });
  const floor = (id: string, room: string, extra: object) => ({ id, kind: 'plattegrond', name: id, notes: '', updated: now, rooms: [{ roomId: room }], outerWall: '0.3', measuredWidth: '', measuredDepth: '', turn: 0, roofId: '', ridge: 'x', roofFlip: false, plateHeight: '', below: '', floorThickness: '0.3', shiftX: '', shiftY: '', ...extra });
  const items = (buildup?: object) =>
    [
      vorm('w', '7.4', '5.9', '2.8', 'gelijk'),
      vorm('z', '7.7', '6.2', '', 'kap'),
      { id: 'kap', kind: 'dak', name: 'Kap', notes: '', updated: now, roofType: 'zadeldak', span: '6.5', rise: '2', pitch: '', rafter: '', ridgeOffset: '', overhang: '', length: '', buildup },
      floor('bg', 'w', {}),
      floor('zo', 'z', { below: 'bg', outerWall: '0.15', roofs: [{ roofId: 'kap', rooms: [], ridge: 'x', flip: false, plateHeight: '', dormers: [], windows: [] }] }),
    ] as never[];
  const attic = (buildup?: object) => {
    const all = items(buildup);
    const r = computePlattegrond(all[4], all);
    if (r.status !== 'ok') throw new Error(r.message);
    return r.value.plan;
  };

  it('follows the underside of the construction, while the outside stays the roof as entered', () => {
    const plain = attic();
    // 305 mm build-up, entered as the top of the tiles (the default).
    const built = attic({ reference: 'boven', rafter: '0.175', deck: '0.018', counter: '0.022', batten: '0.022', tile: '0.068' });
    const pitch = Math.atan2(2, 3.25);
    const plumb = 0.305 / Math.cos(pitch);
    const top = (p: typeof plain) => Math.max(...p.rooms[0].walls.flatMap((w) => (w.top ?? []).map((t) => t.z)));
    // Highest point of the attic: under the ridge, the plumb build-up lower.
    expect(top(plain)).toBeCloseTo(2, 6);
    expect(top(built)).toBeCloseTo(2 - plumb, 6);
    expect(built.rooms[0].volume!).toBeLessThan(plain.rooms[0].volume!);
    expect(built.rooms[0].usableArea!).toBeLessThan(plain.rooms[0].usableArea!);
    // The roof itself (3D, elevations) is unchanged.
    expect(built.roofs[0].heightAt(3.25)).toBeCloseTo(plain.roofs[0].heightAt(3.25), 9);
    // Built up from the underside: the attic follows the roof as entered.
    const fromBelow = attic({ reference: 'onder', rafter: '0.175', deck: '', counter: '', batten: '', tile: '0.068' });
    expect(top(fromBelow)).toBeCloseTo(2, 6);
  });
});

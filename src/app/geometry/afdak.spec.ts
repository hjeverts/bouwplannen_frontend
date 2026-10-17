import { describe, expect, it } from 'vitest';
import { afdakBeamSheet, afdakBeamView, afdakPlanSheet, afdakPlanView, afdakPocketView, afdakRafterSheet, afdakRafterView } from '../drawing/afdak-views';
import { computeAfdakEntry } from '../model/compute-afdak';
import { afdakLayers, computeDak } from '../model/compute';
import { AfdakEntry, createItem, DakItem, emptyAfdak, emptyAfdakRoof, emptyBuildup, emptyTiles, migrateProject } from '../model/models';
import { AfdakInput, computeAfdak, computeRafters, rafterOutline } from './afdak';
import { buildFrame } from './frame3d';

/** 5 m × 1,5 m against a building, three 150 × 150 posts at the front, no overhang. */
const base: AfdakInput = {
  width: 5,
  depth: 1.5,
  attached: true,
  wallOffset: null,
  postWidth: 0.15,
  postDepth: 0.15,
  postsFront: 3,
  postsBack: 0,
  overhangSide: 0,
  overhangFront: 0,
  overhangBack: 0,
  footing: 0.4,
  walls: [],
  wallThickness: 0.1,
};
const roof = { pitch: 18, frontHeight: 2.2, backHeight: null, beamWidth: 0.15, beamHeight: 0.15, backWidth: 0.15, rafterWidth: 0.05, rafterHeight: 0.15, rafterSpacing: 0.6, notchFraction: 1 / 3 };
const T18 = Math.tan((18 * Math.PI) / 180);
const S18 = Math.sin((18 * Math.PI) / 180);

describe('afdak from above', () => {
  it('puts the posts flush with the edges, evenly spaced, and gives the diagonals from the wall', () => {
    const r = computeAfdak(base);
    expect(r.posts.map((p) => [p.name, +p.x.toFixed(4), +p.s.toFixed(4)])).toEqual([
      ['P1', 0.075, 1.425],
      ['P2', 2.5, 1.425],
      ['P3', 4.925, 1.425],
    ]);
    expect(r.spacingFront).toBeCloseTo(2.425, 9);
    expect(r.wallMarks.map((m) => m.x)).toEqual([0.075, 4.925]);
    expect(r.diagonals.map((d) => `${d.from.label}–${d.to.label}`)).toEqual(['M1–P3', 'M2–P1']);
    for (const d of r.diagonals) expect(d.length).toBeCloseTo(Math.hypot(4.85, 1.425), 9);
  });

  it('puts posts at the back of a free-standing roof and keeps the overhangs', () => {
    const r = computeAfdak({ ...base, attached: false, postsBack: 2, overhangSide: 0.3, overhangFront: 0.2, overhangBack: 0.1, depth: 3 });
    const back = r.posts.filter((p) => p.row === 'achter');
    const front = r.posts.filter((p) => p.row === 'voor');
    expect(back.map((p) => p.x)).toEqual([expect.closeTo(0.375, 9), expect.closeTo(4.625, 9)]);
    expect(back[0].s).toBeCloseTo(0.175, 9);
    expect(front[0].s).toBeCloseTo(3 - 0.2 - 0.075, 9);
    expect(r.wallMarks).toEqual([]);
    expect(r.diagonals[0].length).toBeCloseTo(r.diagonals[1].length, 9);
    expect(r.spacingBack).toBeCloseTo(4.25, 9);
  });

  it('places walls on the post lines and refuses a back wall against the building', () => {
    const r = computeAfdak({ ...base, walls: ['links', 'voor', 'achter'] });
    expect(r.walls.map((w) => w.side)).toEqual(['links', 'voor']);
    const left = r.walls[0];
    expect([left.x0, left.x1, left.s0, left.s1]).toEqual([0, 0.1, 0, 1.5]);
    expect(r.warnings.some((w) => /muur van het gebouw/.test(w))).toBe(true);
  });

  it('refuses posts that do not fit', () => {
    expect(() => computeAfdak({ ...base, overhangSide: 2.5 })).toThrow(/passen niet in de breedte/);
    expect(() => computeAfdak({ ...base, overhangFront: 1.5 })).toThrow(/passen niet in de diepte/);
  });
});

describe('afdak rafters and their notches', () => {
  const plan = computeAfdak(base);

  it('seats the rafters on both beams with a notch of at most a third', () => {
    const r = computeRafters(plan, roof);
    const [back, front] = r.seats;
    // Full seat over the 150 mm beam: 150·sin 18° = 46 mm deep, under the 50 mm (1/3) limit.
    expect(front.length).toBeCloseTo(0.15, 9);
    expect(front.depth).toBeCloseTo(0.15 * S18, 9);
    expect(front.plumb).toBeCloseTo(0.15 * T18, 9);
    expect(front.left).toBeCloseTo(0.15 - 0.15 * S18, 9);
    expect(front.limited).toBe(false);
    expect(back.name).toBe('Ligger tegen gebouw');
    // Back support: higher by the run between the two seat starts.
    expect(r.backHeight).toBeCloseTo(2.2 + T18 * 1.35, 9);
    expect(r.frontPost).toBeCloseTo(2.05, 9);
    expect(r.length).toBeCloseTo(1.5 / Math.cos((18 * Math.PI) / 180), 9);
    // The underside passes through the start of each seat.
    expect(r.undersideAt(1.5 - 0.15)).toBeCloseTo(2.2, 9);
    expect(r.undersideAt(0)).toBeCloseTo(r.backHeight, 9);
    // 10 rafters over 5 m, the outer ones flush: 4,95 / 9 = 550 h.o.h.
    expect(r.xs).toHaveLength(10);
    expect(r.spacing).toBeCloseTo(0.55, 9);
    expect(r.warnings).toEqual([]);
  });

  it('works out the pitch from both heights, and the front from the back', () => {
    const fromHeights = computeRafters(plan, { ...roof, pitch: null, backHeight: 2.2 + T18 * 1.35 });
    expect(fromHeights.pitch).toBeCloseTo(18, 6);
    const fromBack = computeRafters(plan, { ...roof, frontHeight: null, backHeight: 2.6 });
    expect(fromBack.frontHeight).toBeCloseTo(2.6 - T18 * 1.35, 9);
  });

  it('keeps the notch shallow on a low rafter, with a shorter seat', () => {
    const r = computeRafters(plan, { ...roof, pitch: 30, rafterHeight: 0.1 });
    const front = r.seats[1];
    expect(front.limited).toBe(true);
    expect(front.depth).toBeCloseTo(0.1 / 3, 9);
    expect(front.length).toBeCloseTo(0.1 / 3 / 0.5, 9);
    expect(r.warnings.some((w) => /beperkt tot 33 mm/.test(w))).toBe(true);
    const quarter = computeRafters(plan, { ...roof, pitch: 30, rafterHeight: 0.1, notchFraction: 0.25 });
    expect(quarter.seats[1].depth).toBeCloseTo(0.025, 9);
  });
});

describe('afdak rafters fixed against the wall beam', () => {
  const plan = computeAfdak(base);
  const C18 = Math.cos((18 * Math.PI) / 180);

  it('ends the rafter against the beam face, top flush, without a notch at the back', () => {
    const r = computeRafters(plan, { ...roof, backFix: 'tegen' });
    const [back, front] = r.seats;
    expect(back.against).toBe(true);
    expect(back.length).toBe(0);
    expect(back.plumb).toBeCloseTo(0.15 / C18, 9);
    expect(front.length).toBeCloseTo(0.15, 9);
    // Starts at the face of the 150 mm beam; flush top: the beam top equals the rafter top there.
    expect(r.start).toBeCloseTo(0.15, 9);
    expect(r.length).toBeCloseTo(1.35 / C18, 9);
    expect(r.ends.back.top).toBeCloseTo(r.backHeight, 9);
    expect(r.backHeight).toBeCloseTo(2.2 + T18 * (1.35 - 0.15) + 0.15 / C18, 9);
  });

  it('takes an offset, works out the pitch from the heights, and checks the beam height', () => {
    const lower = computeRafters(plan, { ...roof, backFix: 'tegen', backOffset: -0.02 });
    expect(lower.ends.back.top).toBeCloseTo(lower.backHeight - 0.02, 9);
    const fromHeights = computeRafters(plan, { ...roof, backFix: 'tegen', pitch: null, backHeight: lower.backHeight, backOffset: -0.02 });
    expect(fromHeights.pitch).toBeCloseTo(18, 6);
    // A 150 mm rafter at 18° has a 158 mm end cut: 8 mm below a flush 150 mm beam.
    const check = computeRafters(plan, { ...roof, backFix: 'tegen', backBeamHeight: 0.15 });
    expect(check.warnings.some((w) => /onder de ligger uit/.test(w))).toBe(true);
    expect(computeRafters(plan, { ...roof, backFix: 'tegen', backBeamHeight: 0.2 }).warnings).toEqual([]);
  });

  it('draws and prints the rafter against the beam', () => {
    const item: AfdakEntry = {
      ...emptyAfdak(),
      width: '5',
      depth: '1,5',
      roof: { ...emptyAfdakRoof(), pitch: '18', frontHeight: '2,2', beamHeight: '0,15', backWidth: '0,15', rafterWidth: '0,05', rafterHeight: '0,15', backFix: 'tegen', backOffset: '-0,01' },
    };
    const r = computeAfdakEntry(item);
    if (r.status !== 'ok') throw new Error(r.message);
    expect(r.value.roofMessage).toBeNull();
    expect(r.value.backOffset).toBeCloseTo(-0.01, 9);
    const texts = afdakRafterView(r.value)!.prims.flatMap((p) => (p.t === 'dim' || p.t === 'text' ? [p.text] : []));
    expect(texts.some((t) => /tegen de ligger/.test(t))).toBe(true);
    expect(texts).toContain(String(Math.round((1.35 / C18) * 1000)));
    const sheet = afdakRafterSheet(r.value, { project: 'P', subject: 'A' })!;
    expect(sheet).toContain('achter: tegen');
    expect(sheet).not.toContain('NaN');
    // Free-standing: always on top of the back beam.
    const free = computeAfdakEntry({ ...item, attached: false, roof: { ...item.roof!, backWidth: '' } });
    if (free.status !== 'ok') throw new Error(free.message);
    expect(free.value.rafters!.seats[0].against).toBeFalsy();
  });
});

describe('afdak beams on their posts', () => {
  // 120 × 120 posts, a 70 mm wide beam.
  const plan = computeAfdak({ ...base, postWidth: 0.12, postDepth: 0.12 });
  const narrow = { ...roof, beamWidth: 0.07, backWidth: 0.07 };

  it('puts the beam centred, or flush with the front or the back of the posts', () => {
    const post = { front: plan.frontRow + 0.06, back: plan.frontRow - 0.06 };
    const mid = computeRafters(plan, narrow).seats[1];
    expect(mid.s0).toBeCloseTo(plan.frontRow - 0.035, 9);
    expect(mid.s1).toBeCloseTo(plan.frontRow + 0.035, 9);
    const front = computeRafters(plan, { ...narrow, beamAlign: 'voor' }).seats[1];
    expect(front.s1).toBeCloseTo(post.front, 9);
    expect(front.s0).toBeCloseTo(post.front - 0.07, 9);
    const back = computeRafters(plan, { ...narrow, beamAlign: 'achter' }).seats[1];
    expect(back.s0).toBeCloseTo(post.back, 9);
    // Flush with the back: the seat starts further back, so the wall side comes lower for the same pitch.
    expect(computeRafters(plan, { ...narrow, beamAlign: 'achter' }).backHeight).toBeLessThan(computeRafters(plan, { ...narrow, beamAlign: 'voor' }).backHeight);
  });

  it('applies to the back beam of a free-standing roof as well', () => {
    const free = computeAfdak({ ...base, attached: false, postsBack: 3, depth: 3, postWidth: 0.12, postDepth: 0.12 });
    const r = computeRafters(free, { ...narrow, beamAlign: 'voor' });
    expect(r.seats[0].s1).toBeCloseTo(free.backRow! + 0.06, 9);
    expect(r.seats[1].s1).toBeCloseTo(free.frontRow + 0.06, 9);
  });
});

describe('afdak item and drawings', () => {
  const item: AfdakEntry = {
    ...emptyAfdak(),
    width: '5',
    depth: '1,5',
    footing: '0,4',
    wallOffset: '0,8',
    walls: ['links'],
    roof: { ...emptyAfdakRoof(), pitch: '18', frontHeight: '2,2', beamHeight: '0,15', backWidth: '0,15', rafterWidth: '0,05', rafterHeight: '0,15' },
  };

  it('computes from what is typed, with sensible defaults', () => {
    const r = computeAfdakEntry(item);
    if (r.status !== 'ok') throw new Error(r.message);
    expect(r.value.plan.posts).toHaveLength(3);
    expect(r.value.rafters!.seats[1].length).toBeCloseTo(0.15, 9); // beam width = post depth
    expect(computeAfdakEntry({ ...item, width: '' }).status).toBe('incomplete');
    const half = computeAfdakEntry({ ...item, roof: { ...item.roof!, frontHeight: '' } });
    expect(half.status === 'ok' && /twee van deze drie/.test(half.value.roofMessage ?? '')).toBe(true);
  });

  it('draws the set-out plan and the rafter, and puts both on A4', () => {
    const r = computeAfdakEntry(item);
    if (r.status !== 'ok') throw new Error(r.message);
    const texts = afdakPlanView(r.value).prims.flatMap((p) => (p.t === 'dim' || p.t === 'text' ? [p.text] : []));
    for (const t of ['2425', '5000', '1425', '1500', '800', 'P1', 'P3', 'M1', 'M2']) expect(texts).toContain(t);
    expect(texts.some((t) => t.startsWith('M1–P3 '))).toBe(true);
    const rafter = afdakRafterView(r.value)!.prims.flatMap((p) => (p.t === 'dim' || p.t === 'text' ? [p.text] : []));
    expect(rafter).toContain('1577'); // 1500 / cos 18°
    expect(rafter.some((t) => /voorligger: zit 150, keep 46 diep/.test(t))).toBe(true);
    const plan = afdakPlanSheet(r.value, { project: 'Schuur', subject: 'Afdak' });
    const saw = afdakRafterSheet(r.value, { project: 'Schuur', subject: 'Afdak' })!;
    for (const s of [plan, saw]) {
      expect(s).toContain('width="297mm"');
      expect(s).not.toContain('NaN');
    }
    expect(plan).toContain('Uitzetten');
    expect(saw).toContain('Kepen');
    expect(saw).toContain('Over boven de keep');
  });
});

describe('afdak as part of a lean-to roof', () => {
  const afdak: AfdakEntry = {
    ...emptyAfdak(),
    width: '5',
    depth: '1,5',
    roof: { ...emptyAfdakRoof(), pitch: '18', frontHeight: '2,2', beamHeight: '0,15', backWidth: '0,15', rafterWidth: '0,05', rafterHeight: '0,15' },
  };
  const dak = (extra: Partial<DakItem> = {}): DakItem => ({ ...(createItem('dak') as DakItem), roofType: 'lessenaarsdak', afdakOn: true, afdak, ...extra });

  it('takes the section from the posts, beams and rafters', () => {
    const r = computeDak(dak());
    if (r.status !== 'ok') throw new Error(r.message);
    const { roof, afdak: a } = r.value;
    expect(roof.type).toBe('lessenaarsdak');
    expect(roof.left.pitch).toBeCloseTo(18, 6);
    // Underside of the rafters: from the front seat start (1350 from the wall) to the back seat start (0).
    expect(roof.span).toBeCloseTo(1.35, 9);
    expect(roof.plateLeft).toBeCloseTo(2.2, 9);
    expect(roof.plateRight).toBeCloseTo(a!.rafters!.backHeight, 9);
    expect([roof.overhangLeft, roof.overhangRight]).toEqual([expect.closeTo(0.15, 9), expect.closeTo(0, 9)]);
    // The rafter, ends included, is the afdak's rafter.
    expect(roof.left.rafterWithOverhang).toBeCloseTo(a!.rafters!.length, 9);
    expect(r.value.purlinLength).toBeCloseTo(5, 9);
  });

  it('builds the roof on the rafters and lays the tiles along it', () => {
    const r = computeDak(
      dak({
        buildup: { ...emptyBuildup(), deck: '18 mm', counter: '0', batten: '22 mm', tile: '68 mm' },
        tiles: { ...emptyTiles(), gauge: '308 mm', cover: '204 mm', eavesGap: '245 mm' },
      }),
    );
    if (r.status !== 'ok') throw new Error(r.message);
    const bu = r.value.buildup!;
    // The rafter (150) is the first layer, whatever the build-up said about it.
    expect(bu.lines.map((l) => l.name)).toEqual(['Onderkant constructie', 'Bovenkant spoor / gording', 'Bovenkant dakbeschot', 'Bovenkant panlat', 'Bovenkant pannen']);
    expect(bu.total).toBeCloseTo(0.15 + 0.018 + 0.022 + 0.068, 9);
    expect(r.value.tiles!.counter).toBe(false);
    expect(r.value.tiles!.planes).toHaveLength(1);
    expect(r.value.tiles!.normalPerRow).toBe(25); // 5 m / 204 mm = 24,5
    // The layers in the afdak's own section: tiles on top, front edge at the depth.
    const layers = afdakLayers(r.value);
    expect(layers.map((l) => l.name)).toEqual(['Bovenkant dakbeschot', 'Bovenkant panlat', 'Bovenkant pannen']);
    const top = layers[2].pts;
    expect(Math.max(...top.map((p) => p.x))).toBeCloseTo(1.5, 9);
    const sheet = afdakRafterSheet(r.value.afdak!, { project: 'P', subject: 'A' }, layers)!;
    expect(sheet).toContain('Bovenkant pannen voor · achter');
  });

  it('says what is missing while the afdak has no roof yet', () => {
    const r = computeDak(dak({ afdak: { ...afdak, roof: undefined } }));
    expect(r.status).toBe('incomplete');
    // Switched off: the lean-to is computed from its own fields again.
    expect(computeDak(dak({ afdakOn: false, span: '3', pitch: '15' })).status).toBe('ok');
  });

  it('turns old afdak items into lean-to roofs', () => {
    const old = { id: 'a1', kind: 'afdak', name: 'Afdak schuur', notes: 'oud', updated: '2026-10-17', width: '5', depth: '1,5', attached: true, postsFront: '3', roof: afdak.roof };
    const p = migrateProject({ id: 'p', name: 'P', created: '', updated: '', items: [old, { ...(createItem('maten')), id: 'm' }] });
    const d = p.items[0] as DakItem;
    expect(d.kind).toBe('dak');
    expect([d.id, d.name, d.notes, d.roofType, d.afdakOn]).toEqual(['a1', 'Afdak schuur', 'oud', 'lessenaarsdak', true]);
    expect(d.afdak!.width).toBe('5');
    expect(d.afdak!.postWidth).toBe('0,150'); // filled in from the defaults
    expect(p.items[1].kind).toBe('maten');
    expect(computeDak(d).status).toBe('ok');
  });
});

describe('afdak notch depth and a nose to the wall', () => {
  const plan = computeAfdak(base);
  const A = (16.7 * Math.PI) / 180;
  // A 50 mm wide front beam: automatically the seat covers it, 50·sin 16,7° = 14 mm deep.
  const thin = { ...roof, pitch: 16.7, beamWidth: 0.05, backWidth: 0.05 };

  it('cuts a deeper notch on request, housed over the beam, so the beam sits higher in the rafter', () => {
    const auto = computeRafters(plan, thin);
    expect(auto.seats[1].depth).toBeCloseTo(0.05 * Math.sin(A), 9);
    expect(auto.seats[1].housed).toBe(false);
    const deep = computeRafters(plan, { ...thin, frontNotch: 0.04 });
    const f = deep.seats[1];
    expect(f.housed).toBe(true);
    expect(f.length).toBeCloseTo(0.05, 9);
    expect(f.plumb).toBeCloseTo(0.04 / Math.cos(A), 9);
    expect(f.upPlumb).toBeCloseTo((0.04 - 0.05 * Math.sin(A)) / Math.cos(A), 9);
    expect(f.left).toBeCloseTo(0.11, 9);
    // Same pitch and front height: the roof (and the back) comes lower by the extra plumb depth.
    expect(auto.backHeight - deep.backHeight).toBeCloseTo((0.04 - 0.05 * Math.sin(A)) / Math.cos(A), 9);
    expect(deep.undersideAt(f.s1)).toBeCloseTo(2.2 - f.plumb, 9);
    expect(deep.warnings).toEqual([]);
    // Deeper than a third of the rafter: a warning.
    expect(computeRafters(plan, { ...thin, frontNotch: 0.06 }).warnings.some((w) => /dieper dan 1\/3/.test(w))).toBe(true);
    // A shallow notch on a wide beam: a shorter seat.
    const shallow = computeRafters(plan, { ...roof, frontNotch: 0.02 }).seats[1];
    expect(shallow.length).toBeCloseTo(0.02 / Math.sin((18 * Math.PI) / 180), 9);
  });

  it('runs a nose over the wall beam to the wall', () => {
    const r = computeRafters(plan, { ...roof, backFix: 'tegen', backOffset: 0.03, backThrough: true });
    const back = r.seats[0];
    expect(back.through).toBe(true);
    expect(r.start).toBe(0);
    expect(r.length).toBeCloseTo(1.5 / Math.cos((18 * Math.PI) / 180), 9);
    // Below the beam top the rafter butts the beam: its plumb face; above it a 30 mm nose (square: 28,5).
    expect(back.plumb).toBeCloseTo(0.15 / Math.cos((18 * Math.PI) / 180) - 0.03, 9);
    expect(back.left).toBeCloseTo(0.03 * Math.cos((18 * Math.PI) / 180), 9);
    expect(back.length).toBeCloseTo(0.15, 9);
    expect(r.ends.back.top - r.backHeight).toBeCloseTo(0.03 + 0.15 * Math.tan((18 * Math.PI) / 180), 9);
    expect(r.warnings).toEqual([]);
    expect(computeRafters(plan, { ...roof, backFix: 'tegen', backThrough: true }).warnings.some((w) => /geen neus/.test(w))).toBe(true);
  });

  it('draws the nose and the housed notch', () => {
    const item: AfdakEntry = {
      ...emptyAfdak(),
      width: '5',
      depth: '1,5',
      roof: { ...emptyAfdakRoof(), pitch: '16,7', frontHeight: '2,2', beamWidth: '0,05', beamHeight: '0,15', backWidth: '0,05', rafterWidth: '0,05', rafterHeight: '0,15', backFix: 'tegen', backOffset: '0,03', backThrough: true, frontNotch: '0,04' },
    };
    const r = computeAfdakEntry(item);
    if (r.status !== 'ok') throw new Error(r.message);
    expect(r.value.roofMessage).toBeNull();
    const texts = afdakRafterView(r.value)!.prims.flatMap((p) => (p.t === 'dim' || p.t === 'text' ? [p.text] : []));
    expect(texts.some((t) => /neus 29 dik over 50 tot de muur/.test(t))).toBe(true);
    expect(texts.some((t) => /ingekeept/.test(t))).toBe(true);
    const sheet = afdakRafterSheet(r.value, { project: 'P', subject: 'A' })!;
    expect(sheet).toContain('achter: neus');
    expect(sheet).toContain('Tweede loodsnede (ingekeept)');
    expect(sheet).not.toContain('NaN');
  });
});

describe('afdak sized by its construction', () => {
  const base: AfdakEntry = { ...emptyAfdak(), sizeOf: 'constructie', width: '5', depth: '1,5', overhangSide: '0,2', overhangFront: '0,3' };
  const plan = (e: AfdakEntry) => {
    const r = computeAfdakEntry(e);
    if (r.status !== 'ok') throw new Error(r.message);
    return r.value.plan;
  };

  it('adds the overhangs to the construction for the whole roof', () => {
    const p = plan(base);
    expect(p.width).toBeCloseTo(5.4, 9);
    expect(p.depth).toBeCloseTo(1.8, 9);
    // The outside of the front posts lies 1.5 from the wall, the outer posts' outsides 5 apart.
    expect(p.frontRow + p.postDepth / 2).toBeCloseTo(1.5, 9);
    const xs = p.posts.map((q) => q.x);
    expect(Math.max(...xs) - Math.min(...xs) + p.postWidth).toBeCloseTo(5, 9);
  });

  it('keeps the posts in place when only an overhang changes', () => {
    const a = plan(base);
    const b = plan({ ...base, overhangFront: '0,45', overhangSide: '0,1' });
    expect(b.depth).toBeCloseTo(1.95, 9);
    expect(b.frontRow).toBeCloseTo(a.frontRow, 9);
    expect(b.posts.map((q) => q.x - 0.1)).toEqual(a.posts.map((q) => expect.closeTo(q.x - 0.2, 9)));
  });

  it('counts the back overhang too when free-standing', () => {
    const p = plan({ ...base, attached: false, postsBack: '3', overhangBack: '0,25' });
    expect(p.depth).toBeCloseTo(2.05, 9);
  });

  it('keeps old afdaks measured edge to edge', () => {
    const p = plan({ ...base, sizeOf: undefined });
    expect([p.width, p.depth]).toEqual([5, 1.5]);
  });
});

describe('afdak pockets in the beams', () => {
  const plan = computeAfdak(base);
  const thin = { ...roof, pitch: 16.7, beamWidth: 0.05, backWidth: 0.05 };

  it('lets the rafter sink into the beam: same notch in the rafter, beam higher in the roof', () => {
    const plain = computeRafters(plan, thin);
    const pocket = computeRafters(plan, { ...thin, frontPocket: 0.03, backPocket: 0.02 });
    const [b0, f0] = plain.seats;
    const [b1, f1] = pocket.seats;
    // The rafter's own notch does not change.
    expect([f1.depth, f1.length, b1.depth]).toEqual([expect.closeTo(f0.depth, 12), expect.closeTo(f0.length, 12), expect.closeTo(b0.depth, 12)]);
    // The seat lies at the bottom of the pocket.
    expect(f1.floor).toBeCloseTo(f1.z - 0.03, 12);
    expect(b1.floor).toBeCloseTo(b1.z - 0.02, 12);
    // Same front beam top and pitch: the whole roof comes 30 mm lower over the front beam ...
    expect(pocket.undersideAt(f1.s1)).toBeCloseTo(plain.undersideAt(f0.s1) - 0.03, 12);
    // ... and the back beam top comes out 20 mm higher than the rafter would otherwise need.
    expect(pocket.backHeight - plain.backHeight).toBeCloseTo(-0.03 + 0.02, 12);
    // The rafter's outline rests on the pocket bottoms.
    const outline = rafterOutline(pocket, plan.depth, 0.15);
    expect(outline.filter((p) => Math.abs(p.y - f1.floor) < 1e-9).length).toBe(2);
    expect(outline.filter((p) => Math.abs(p.y - b1.floor) < 1e-9).length).toBe(2);
  });

  it('warns when a pocket takes too much out of a beam, and refuses one deeper than the beam', () => {
    expect(computeRafters(plan, { ...thin, frontPocket: 0.03 }).warnings.some((w) => /Voorligger: een inkeping/.test(w))).toBe(false);
    expect(computeRafters(plan, { ...thin, frontPocket: 0.05 }).warnings.some((w) => /Voorligger: een inkeping van 50 mm/.test(w))).toBe(true);
    expect(() => computeRafters(plan, { ...thin, frontPocket: 0.15 })).toThrow(/dieper dan de ligger/);
  });

  it('has no pocket where the rafter ends against the wall beam', () => {
    const r = computeRafters(plan, { ...thin, backFix: 'tegen', backPocket: 0.03 });
    expect(r.seats[0].pocket).toBe(0);
  });

  it('reads the pockets from the entry and draws them in the beams', () => {
    const entry: AfdakEntry = {
      ...emptyAfdak(),
      sizeOf: 'totaal',
      width: '5',
      depth: '1,5',
      roof: { ...emptyAfdakRoof(), pitch: '18', frontHeight: '2,2', beamHeight: '0,15', backWidth: '0,15', rafterWidth: '0,05', rafterHeight: '0,15', frontPocket: '20 mm', backPocket: '0,03' },
    };
    const o = computeAfdakEntry(entry);
    if (o.status !== 'ok') throw new Error(o.message);
    const [back, front] = o.value.rafters!.seats;
    expect([front.pocket, back.pocket]).toEqual([expect.closeTo(0.02, 12), expect.closeTo(0.03, 12)]);
    const saw = afdakRafterSheet(o.value, { project: 'Schuur', subject: 'Afdak' })!;
    expect(saw).toContain('Inkeping ligger');
    const d = computeDak({ ...(createItem('dak') as DakItem), roofType: 'lessenaarsdak', afdakOn: true, afdak: entry });
    if (d.status !== 'ok') throw new Error(d.message);
    const beams = buildFrame(d.value).members.filter((m) => m.kind === 'beam');
    // Each beam: a pocket under every rafter, full height between them (outer rafters flush with the edges).
    const n = o.value.rafters!.xs.length;
    expect(beams.length).toBe(2 * (n + n - 1));
  });
});

describe('afdak beam drawing', () => {
  const entry = (roofExtra: Partial<AfdakEntry['roof']> = {}): AfdakEntry => ({
    ...emptyAfdak(),
    sizeOf: 'totaal',
    width: '5',
    depth: '1,5',
    postsFront: '3',
    roof: { ...emptyAfdakRoof(), pitch: '18', frontHeight: '2,2', beamHeight: '0,15', backWidth: '0,15', rafterWidth: '0,05', rafterHeight: '0,15', ...roofExtra },
  });
  const outcome = (e: AfdakEntry) => {
    const o = computeAfdakEntry(e);
    if (o.status !== 'ok') throw new Error(o.message);
    return o.value;
  };

  it('marks every rafter on both beams from the left end, with the posts under the front beam', () => {
    const o = outcome(entry());
    const r = o.rafters!;
    const front = afdakBeamView(o, 0)!;
    const texts = front.prims.filter((p) => p.t === 'text').map((p) => (p as { text: string }).text);
    // Left side of every rafter: 0, then one spacing further each time.
    expect(texts).toContain('0');
    expect(texts).toContain(String(Math.round((r.xs[1] - 0.025) * 1000)));
    expect(texts.filter((t) => /^S\d+$/.test(t)).length).toBe(r.xs.length);
    // Post centres along the front beam.
    const dims = front.prims.filter((p) => p.t === 'dim').map((p) => (p as { text: string }).text);
    expect(dims).toContain(String(Math.round(o.plan.posts[0].x * 1000)));
    expect(afdakPocketView(o, 0)).toBeNull();
    const sheet = afdakBeamSheet(o, { project: 'Schuur', subject: 'Afdak' })!;
    expect(sheet).toContain('Sporen op de liggers');
    expect(sheet).not.toContain('NaN');
  });

  it('adds a detail of the pocket when the beam has one', () => {
    const o = outcome(entry({ frontPocket: '0,02' }));
    const d = afdakPocketView(o, 0)!;
    expect(d.prims.filter((p) => p.t === 'dim').map((p) => (p as { text: string }).text)).toEqual(expect.arrayContaining(['50', '20']));
    const sheet = afdakBeamSheet(o, { project: 'Schuur', subject: 'Afdak' })!;
    expect(sheet).toContain('Inkepingen, voorkant');
    expect(sheet).toContain('50 br. × 20 diep');
  });
});

describe('afdak worked back from the top of the tiles at the wall', () => {
  const afdak = (roofExtra: Partial<AfdakEntry['roof']>): AfdakEntry => ({
    ...emptyAfdak(),
    sizeOf: 'totaal',
    width: '5',
    depth: '2',
    roof: { ...emptyAfdakRoof(), beamHeight: '0,15', backWidth: '0,15', rafterWidth: '0,05', rafterHeight: '0,15', ...roofExtra },
  });
  const buildup = { ...emptyBuildup(), deck: '0,018', counter: '0,022', batten: '0,025', tile: '0,06' };
  const dak = (roofExtra: Partial<AfdakEntry['roof']>) => {
    const d = computeDak({ ...(createItem('dak') as DakItem), roofType: 'lessenaarsdak', afdakOn: true, afdak: afdak(roofExtra), buildup });
    if (d.status !== 'ok') throw new Error(d.message);
    return d.value;
  };
  /** The tile line of the build-up at its back end (the wall). */
  const tilesAtWall = (d: ReturnType<typeof dak>) => {
    const line = d.buildup!.lines.find((l) => l.name === 'Bovenkant pannen')!.pts;
    return line.reduce((m, p) => (p.x > m.x ? p : m), line[0]).y;
  };

  it('finds the wall beam height from the pitch and the tiles', () => {
    const d = dak({ pitch: '18', tileTop: '2,8' });
    expect(d.afdak!.tileTopAtWall).toBeCloseTo(2.8, 6);
    expect(tilesAtWall(d)).toBeCloseTo(2.8, 6);
    // The wall beam lies the build-up plus the rafter (plumb) and its seat below that.
    const r = d.afdak!.rafters!;
    expect(r.backHeight).toBeLessThan(2.8 - (0.15 + 0.125) / Math.cos((18 * Math.PI) / 180) + 0.06);
    expect(r.warnings).toEqual([]);
  });

  it('finds the pitch from the front beam and the tiles', () => {
    const d = dak({ frontHeight: '2,2', tileTop: '2,9' });
    expect(tilesAtWall(d)).toBeCloseTo(2.9, 6);
    expect(d.afdak!.rafters!.frontHeight).toBeCloseTo(2.2, 9);
    const same = dak({ frontHeight: '2,2', backHeight: String(d.afdak!.rafters!.backHeight).replace('.', ',') });
    expect(same.afdak!.rafters!.pitch).toBeCloseTo(d.afdak!.rafters!.pitch, 6);
  });

  it('warns when pitch, front beam and tiles do not agree, and refuses a back height as well', () => {
    const d = dak({ pitch: '18', frontHeight: '2,2', tileTop: '3,5' });
    expect(d.afdak!.rafters!.warnings.some((w) => /bovenkant van de pannen achter/.test(w))).toBe(true);
    const o = computeAfdakEntry(afdak({ pitch: '18', backHeight: '2,6', tileTop: '2,8' }), 0.125);
    expect(o.status === 'ok' && o.value.roofMessage).toMatch(/niet allebei/);
  });

  it('says so when there is no build-up to work back through', () => {
    const o = computeAfdakEntry(afdak({ pitch: '18', tileTop: '2,8' }));
    if (o.status !== 'ok') throw new Error(o.message);
    expect(o.value.rafters!.warnings.some((w) => /geen dakopbouw/.test(w))).toBe(true);
    expect(o.value.tileTopAtWall).toBeCloseTo(2.8, 6);
  });
});

describe('afdak rafters in joist hangers at the wall beam', () => {
  const plan = computeAfdak(base);
  const A = (18 * Math.PI) / 180;

  it('gives a level seat at the rafter end for a hanger with a level seat', () => {
    const r = computeRafters(plan, { ...roof, backFix: 'tegen', backHanger: 'vlak', hangerSeat: 0.07, backBeamHeight: 0.2 });
    const back = r.seats[0];
    expect(back.hanger!.kind).toBe('vlak');
    expect(back.hanger!.heel).toBeCloseTo(0.07 * Math.tan(A), 12);
    expect(back.hanger!.bottom).toBeCloseTo(r.undersideAt(back.s1), 12);
    // Outline: the level cut from the end, then the heel down to the underside.
    const outline = rafterOutline(r, plan.depth, 0.15);
    const level = outline.filter((p) => Math.abs(p.y - back.hanger!.bottom) < 1e-9);
    expect(level.map((p) => p.x).sort()).toEqual([expect.closeTo(back.s1, 9), expect.closeTo(back.s1 + 0.07, 9)]);
    // A hanger changes nothing about the heights.
    const plain = computeRafters(plan, { ...roof, backFix: 'tegen', backBeamHeight: 0.2 });
    expect(r.backHeight).toBeCloseTo(plain.backHeight, 12);
  });

  it('only cuts the plumb end for a tilting hanger, and checks the hanger fits on the beam', () => {
    const r = computeRafters(plan, { ...roof, backFix: 'tegen', backHanger: 'hellend', backBeamHeight: 0.2 });
    expect(r.seats[0].hanger!.heel).toBe(0);
    expect(r.seats[0].hanger!.height).toBeCloseTo(0.75 * 0.15, 12);
    expect(rafterOutline(r, plan.depth, 0.15).length).toBe(rafterOutline(computeRafters(plan, { ...roof, backFix: 'tegen', backBeamHeight: 0.2 }), plan.depth, 0.15).length);
    const tall = computeRafters(plan, { ...roof, backFix: 'tegen', backHanger: 'hellend', hangerHeight: 0.3, backBeamHeight: 0.2 });
    expect(tall.warnings.some((w) => /boven de ligger uit/.test(w))).toBe(true);
    const low = computeRafters(plan, { ...roof, backFix: 'tegen', backHanger: 'hellend', hangerHeight: 0.06, backBeamHeight: 0.2 });
    expect(low.warnings.some((w) => /minder dan 60%/.test(w))).toBe(true);
  });

  it('has no nose to the wall with a hanger, and puts the hangers on the sheets', () => {
    const e: AfdakEntry = {
      ...emptyAfdak(),
      sizeOf: 'totaal',
      width: '5',
      depth: '1,5',
      roof: { ...emptyAfdakRoof(), pitch: '18', frontHeight: '2,2', beamHeight: '0,15', backWidth: '0,15', rafterWidth: '0,05', rafterHeight: '0,15', backFix: 'tegen', backThrough: true, backHanger: 'vlak', backBeamHeight: '0,2' },
    };
    const o = computeAfdakEntry(e);
    if (o.status !== 'ok') throw new Error(o.message);
    expect(o.value.rafters!.seats[0].through).toBeFalsy();
    expect(o.value.rafters!.seats[0].hanger).toBeTruthy();
    const saw = afdakRafterSheet(o.value, { project: 'Schuur', subject: 'Afdak' })!;
    expect(saw).toContain('Balkdragers (vlakke zit)');
    expect(saw).toContain('balkdrager: vlakke zit 70');
    expect(afdakBeamSheet(o.value, { project: 'Schuur', subject: 'Afdak' })!).toContain('balkdragers');
  });
});

describe('afdak without a wall beam: hangers on the wall', () => {
  const e = (extra: Partial<AfdakEntry['roof']> = {}): AfdakEntry => ({
    ...emptyAfdak(),
    sizeOf: 'totaal',
    width: '5',
    depth: '1,5',
    roof: { ...emptyAfdakRoof(), pitch: '18', frontHeight: '2,2', beamHeight: '0,15', rafterWidth: '0,05', rafterHeight: '0,15', backFix: 'muur', ...extra },
  });
  const out = (entry: AfdakEntry) => {
    const o = computeAfdakEntry(entry);
    if (o.status !== 'ok') throw new Error(o.message);
    if (!o.value.rafters) throw new Error(o.value.roofMessage ?? 'geen sporen');
    return o.value;
  };

  it('needs no beam width and lets the rafters run to the wall, in hangers', () => {
    const o = out(e());
    const back = o.rafters!.seats[0];
    expect(back.wall).toBe(true);
    expect([back.s0, back.s1]).toEqual([0, 0]);
    expect(o.rafters!.start).toBe(0);
    // Screwed is not possible without a beam: a hanger with a level seat.
    expect(back.hanger!.kind).toBe('vlak');
    // The back height is the top of the rafter at the wall.
    const a = (18 * Math.PI) / 180;
    expect(o.rafters!.backHeight).toBeCloseTo(o.rafters!.undersideAt(0) + 0.15 / Math.cos(a), 9);
    expect(back.hanger!.bottom).toBeCloseTo(o.rafters!.undersideAt(0), 12);
    expect(computeAfdakEntry(e({ backHanger: 'hellend' })).status === 'ok' && out(e({ backHanger: 'hellend' })).rafters!.seats[0].hanger!.kind).toBe('hellend');
  });

  it('works from the top of the rafter at the wall, and from the tiles there', () => {
    const fromBack = out(e({ frontHeight: '', backHeight: '2,7' }));
    expect(fromBack.rafters!.backHeight).toBeCloseTo(2.7, 9);
    const fromTiles = out(e({ frontHeight: '', tileTop: '2,8' }));
    expect(fromTiles.tileTopAtWall).toBeCloseTo(2.8, 6);
  });

  it('draws no wall beam, and the hangers on the wall on the beam sheet', () => {
    const o = out(e());
    const beamSheet = afdakBeamSheet(o, { project: 'Schuur', subject: 'Afdak' })!;
    expect(beamSheet).toContain('Muur, van boven: balkdragers');
    expect(beamSheet).toContain('Muur (geen ligger)');
    const saw = afdakRafterSheet(o, { project: 'Schuur', subject: 'Afdak' })!;
    expect(saw).toContain('Bovenkant spoor tegen muur');
    expect(saw).not.toContain('NaN');
    const d = computeDak({ ...(createItem('dak') as DakItem), roofType: 'lessenaarsdak', afdakOn: true, afdak: e() });
    if (d.status !== 'ok') throw new Error(d.message);
    const f = buildFrame(d.value);
    expect(f.members.filter((m) => m.kind === 'beam').length).toBe(1);
    expect(f.members.filter((m) => m.kind === 'hanger').length).toBe(4 * o.rafters!.xs.length);
  });
});

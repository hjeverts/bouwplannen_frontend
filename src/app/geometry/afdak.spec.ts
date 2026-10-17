import { describe, expect, it } from 'vitest';
import { afdakPlanSheet, afdakPlanView, afdakRafterSheet, afdakRafterView } from '../drawing/afdak-views';
import { computeAfdakItem } from '../model/compute-afdak';
import { AfdakItem, createItem, emptyAfdakRoof } from '../model/models';
import { AfdakInput, computeAfdak, computeRafters } from './afdak';

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
    const item: AfdakItem = {
      ...(createItem('afdak') as AfdakItem),
      width: '5',
      depth: '1,5',
      roof: { ...emptyAfdakRoof(), pitch: '18', frontHeight: '2,2', beamHeight: '0,15', backWidth: '0,15', rafterWidth: '0,05', rafterHeight: '0,15', backFix: 'tegen', backOffset: '-0,01' },
    };
    const r = computeAfdakItem(item);
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
    const free = computeAfdakItem({ ...item, attached: false, roof: { ...item.roof!, backWidth: '' } });
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
  const item: AfdakItem = {
    ...(createItem('afdak') as AfdakItem),
    width: '5',
    depth: '1,5',
    footing: '0,4',
    wallOffset: '0,8',
    walls: ['links'],
    roof: { ...emptyAfdakRoof(), pitch: '18', frontHeight: '2,2', beamHeight: '0,15', backWidth: '0,15', rafterWidth: '0,05', rafterHeight: '0,15' },
  };

  it('computes from what is typed, with sensible defaults', () => {
    const r = computeAfdakItem(item);
    if (r.status !== 'ok') throw new Error(r.message);
    expect(r.value.plan.posts).toHaveLength(3);
    expect(r.value.rafters!.seats[1].length).toBeCloseTo(0.15, 9); // beam width = post depth
    expect(computeAfdakItem({ ...item, width: '' }).status).toBe('incomplete');
    const half = computeAfdakItem({ ...item, roof: { ...item.roof!, frontHeight: '' } });
    expect(half.status === 'ok' && /twee van deze drie/.test(half.value.roofMessage ?? '')).toBe(true);
  });

  it('draws the set-out plan and the rafter, and puts both on A4', () => {
    const r = computeAfdakItem(item);
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

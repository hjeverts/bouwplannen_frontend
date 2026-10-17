import { describe, expect, it } from 'vitest';
import { roofSection } from './geometry';
import { computeTiles, dividePlane, TileSpec } from './tiles';

/** Wienerberger "Opnieuw Verbeterde Holle pan": fixed gauge 308, cover 204, last gauge 245. */
const OVH: TileSpec = {
  width: 0.267,
  length: 0.367,
  gauge: 0.308,
  gaugeMin: null,
  cover: 0.204,
  ridgeGap: 0.035,
  eavesGap: 0.245,
  counterSpacing: 0.6,
  vergeStart: null,
  vergeEnd: null,
  minPitch: 25,
  weight: 2.46,
};

describe('battens on a roof plane', () => {
  it('fits whole gauges when the plane allows it', () => {
    // 35 + 10 × 308 + 245 = 3360 mm.
    const d = dividePlane(3.36, OVH);
    expect(d.spaces).toBe(10);
    expect(d.gauge).toBeCloseTo(0.308, 9);
    expect(d.eavesGap).toBeCloseTo(0.245, 9);
    expect(d.eavesDiff).toBeCloseTo(0, 9);
    expect(d.battens).toBe(11);
    expect(d.rows).toBe(11);
  });

  it('lets the last gauge give for a fixed gauge, whichever way is closest', () => {
    // 100 mm too long: keep 10 gauges, last gauge 345.
    const longer = dividePlane(3.46, OVH);
    expect(longer.spaces).toBe(10);
    expect(longer.gauge).toBeCloseTo(0.308, 9);
    expect(longer.eavesGap).toBeCloseTo(0.345, 9);
    expect(longer.eavesDiff).toBeCloseTo(0.1, 9);
    // 250 mm too long: one gauge more, last gauge 245 − 58 = 187.
    const more = dividePlane(3.61, OVH);
    expect(more.spaces).toBe(11);
    expect(more.eavesGap).toBeCloseTo(0.187, 9);
    expect(more.eavesDiff).toBeCloseTo(-0.058, 9);
  });

  it('spreads the gauges evenly for a sliding tile', () => {
    const slide = { ...OVH, gauge: 0.34, gaugeMin: 0.31 };
    // 35 + 245 + 3,2 m: ten gauges of 320.
    const d = dividePlane(3.48, slide);
    expect(d.spaces).toBe(10);
    expect(d.gauge).toBeCloseTo(0.32, 9);
    expect(d.eavesGap).toBeCloseTo(0.245, 9);
    // Outside the range: the largest gauge with one fewer, or the smallest with one more.
    const tight = dividePlane(0.035 + 0.245 + 0.36, slide);
    expect(tight.spaces).toBe(1);
    expect(tight.gauge).toBeCloseTo(0.34, 9);
    expect(tight.eavesDiff).toBeCloseTo(0.02, 9);
  });

  it('copes with a plane shorter than the ridge and eaves distances', () => {
    const d = dividePlane(0.2, OVH);
    expect(d.battens).toBe(1);
    expect(d.gauge).toBe(0);
  });
});

describe('tiles on a roof', () => {
  // Gable roof, 45°, rafters 3,36 m with the overhang: exactly 10 gauges on each side.
  const rafter = 3.36;
  const roof = roofSection({ type: 'zadeldak', span: 2 * (rafter * Math.SQRT1_2), pitch: 45 });

  it('counts tiles, battens and counter battens', () => {
    const t = computeTiles(roof, 10, OVH);
    expect(t.planes.map((p) => p.label)).toEqual(['Dakvlak links', 'Dakvlak rechts']);
    for (const p of t.planes) {
      expect(p.slope).toBeCloseTo(rafter, 9);
      expect(p.rows).toBe(11);
      expect(p.counterBattens).toBe(17); // 10 m / 600 mm + 1
    }
    // 10 m / 204 mm = 49,02: 49 tiles cover 9,996 m, 4 mm short is fine.
    expect(t.normalPerRow).toBe(49);
    expect(t.widthDiff).toBeCloseTo(-0.004, 9);
    expect(t.tiles).toBe(2 * 11 * 49);
    // 11 battens + the eaves batten, per side, each 10 m.
    expect(t.battenLength).toBeCloseTo(2 * 12 * 10, 9);
    expect(t.counterBattens).toBe(34);
    expect(t.counterLength).toBeCloseTo(34 * rafter, 9);
    expect(t.perM2).toBeCloseTo(15.9, 1);
    expect(t.weight).toBeCloseTo(2 * 11 * 49 * 2.46, 6);
    expect(t.headLap).toBeCloseTo(0.059, 9);
    expect(t.sideLap).toBeCloseTo(0.063, 9);
    expect(t.warnings).toEqual([]);
  });

  it('adds verge tiles at the gables', () => {
    const t = computeTiles(roof, 10, { ...OVH, vergeStart: 0.19, vergeEnd: 0.23 });
    // (10 − 0,42) / 0,204 = 46,96 → 47 normal tiles and two verge tiles per row.
    expect(t.normalPerRow).toBe(47);
    expect(t.vergePerRow).toBe(2);
    expect(t.vergeTiles).toBe(2 * 11 * 2);
    expect(t.covered).toBeCloseTo(0.42 + 47 * 0.204, 9);
  });

  it('warns for a pitch under the minimum and a last gauge that does not fit', () => {
    const flat = roofSection({ type: 'lessenaarsdak', span: 3.4, pitch: 20 });
    const t = computeTiles(flat, 5, OVH);
    expect(t.planes).toHaveLength(1);
    expect(t.warnings.some((w) => /flauwer dan het minimum/.test(w))).toBe(true);
    expect(t.warnings.some((w) => /laatste latafstand/.test(w))).toBe(true);
  });

  it('counts per row only when the roof length is known', () => {
    const t = computeTiles(roof, null, OVH);
    expect(t.tiles).toBeNull();
    expect(t.battenLength).toBeNull();
    expect(t.planes[0].rows).toBe(11);
  });
});

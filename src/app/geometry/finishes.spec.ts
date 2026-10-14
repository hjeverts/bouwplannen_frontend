import { describe, expect, it } from 'vitest';
import type { P3 } from './building';
import {
  CLADDING_TYPES,
  colourName,
  finishLabel,
  finishSegments,
  insetQuad,
  lineColour,
  resolveFinish,
  ROOF_COLOURS,
  ROOF_TYPES,
  WALL_COLOURS,
} from './finishes';

const P = (x: number, y: number, z: number): P3 => ({ x, y, z });

/** A wall 2 m long and 1 m high in the plane y = 0, facing the front (-y). */
const wall = { pts: [P(0, 0, 0), P(2, 0, 0), P(2, 0, 1), P(0, 0, 1)], holes: [] as P3[][], normal: P(0, -1, 0) };

describe('materials', () => {
  it('gives every material a colour from its own swatches, so the legend can name it', () => {
    for (const t of CLADDING_TYPES) expect(WALL_COLOURS.map((c) => c.hex)).toContain(t.colour);
    for (const t of ROOF_TYPES) expect(ROOF_COLOURS.map((c) => c.hex)).toContain(t.colour);
  });

  it('reads a stored choice', () => {
    expect(resolveFinish(undefined, CLADDING_TYPES)).toBeNull();
    expect(resolveFinish({ type: '', colour: '#ff0000' }, CLADDING_TYPES)).toBeNull();
    expect(resolveFinish({ type: 'onbekend', colour: '' }, CLADDING_TYPES)).toBeNull();
    expect(resolveFinish({ type: 'metselwerk', colour: '' }, CLADDING_TYPES)).toEqual({ type: 'metselwerk', colour: '#9b4a34' });
    expect(resolveFinish({ type: 'rabat', colour: '#ABCDEF' }, CLADDING_TYPES)).toEqual({ type: 'rabat', colour: '#abcdef' });
    // Not a colour: the material's own.
    expect(resolveFinish({ type: 'pannen', colour: 'rood' }, ROOF_TYPES)!.colour).toBe('#8d3f2a');
  });

  it('names colours and finishes', () => {
    expect(colourName('#9B4A34')).toBe('Rood');
    expect(colourName('#123456')).toBe('#123456');
    expect(finishLabel({ type: 'metselwerk', colour: '#9b4a34' })).toBe('Metselwerk, rood');
    expect(finishLabel({ type: 'pannen', colour: '#3d4043' })).toBe('Dakpannen, antraciet');
  });

  it('draws joints lighter on dark materials and darker on light ones', () => {
    const lum = (s: string) => s.match(/\d+/g)!.map(Number).reduce((a, b) => a + b, 0);
    expect(lum(lineColour([40, 40, 40]))).toBeGreaterThan(120);
    expect(lum(lineColour([240, 240, 240]))).toBeLessThan(720);
  });
});

describe('material patterns', () => {
  const inFace = (p: P3) => p.x >= -1e-9 && p.x <= 2 + 1e-9 && Math.abs(p.y) < 1e-9 && p.z >= -1e-9 && p.z <= 1 + 1e-9;

  it('lays brick courses from the ground up, with staggered head joints', () => {
    const segs = finishSegments(wall, 'metselwerk');
    const rows = segs.filter(([a, b]) => Math.abs(a.z - b.z) < 1e-9);
    const joints = segs.filter(([a, b]) => Math.abs(a.x - b.x) < 1e-9);
    // Courses every 62,5 mm: 15 lines inside a 1 m high wall, each the full length.
    expect(rows.length).toBe(15);
    for (const [a, b] of rows) expect(Math.abs(b.x - a.x)).toBeCloseTo(2, 9);
    expect(rows.map(([a]) => a.z).sort((x, y) => x - y)[0]).toBeCloseTo(0.0625, 9);
    // Head joints one course high, shifted half a brick on every other course.
    for (const [a, b] of joints) expect(Math.abs(b.z - a.z)).toBeLessThanOrEqual(0.0625 + 1e-9);
    const firstX = (z: number) => Math.min(...joints.filter(([a, b]) => Math.min(a.z, b.z) < z && Math.max(a.z, b.z) > z).map(([a]) => a.x));
    expect(Math.abs(firstX(0.03) - firstX(0.09))).toBeCloseTo(0.105, 9);
    for (const [a, b] of segs) expect(inFace(a) && inFace(b)).toBe(true);
  });

  it('leaves out the fine joints in a light drawing', () => {
    const full = finishSegments(wall, 'metselwerk');
    const light = finishSegments(wall, 'metselwerk', true);
    expect(light.length).toBe(15);
    expect(full.length).toBeGreaterThan(light.length * 5);
  });

  it('keeps patterns out of holes', () => {
    const holed = { ...wall, holes: [[P(0.5, 0, 0.25), P(1.5, 0, 0.25), P(1.5, 0, 0.75), P(0.5, 0, 0.75)]] };
    for (const [a, b] of finishSegments(holed, 'rabat')) {
      const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
      expect(mid.x > 0.5 + 1e-6 && mid.x < 1.5 - 1e-6 && mid.z > 0.25 && mid.z < 0.75).toBe(false);
    }
    expect(finishSegments(holed, 'verticaal').length).toBeGreaterThan(0);
  });

  it('draws nothing for plain materials or flat faces', () => {
    expect(finishSegments(wall, 'stuc')).toEqual([]);
    expect(finishSegments({ ...wall, normal: P(0, 0, 1) }, 'metselwerk')).toEqual([]);
  });

  it('runs tile rows along a roof plane from the eaves', () => {
    // A 45° plane rising to the back: eaves at y = 0, z = 0; 3 m along the slope.
    const r = 3 / Math.SQRT2;
    const n = P(0, -Math.SQRT1_2, Math.SQRT1_2);
    const roof = { pts: [P(0, 0, 0), P(4, 0, 0), P(4, r, r), P(0, r, r)], holes: [], normal: n };
    const segs = finishSegments(roof, 'pannen');
    const rows = segs.filter(([a, b]) => Math.abs(a.z - b.z) < 1e-9).map(([a]) => a.z * Math.SQRT2).sort((x, y) => x - y);
    expect(rows[0]).toBeCloseTo(0.33, 9);
    expect(rows[1] - rows[0]).toBeCloseTo(0.33, 9);
    expect(rows.length).toBe(9);
    // Every point lies in the plane.
    for (const [a, b] of segs) for (const p of [a, b]) expect(p.y - p.z).toBeCloseTo(0, 9);
  });
});

describe('frames', () => {
  it('moves the edges of a quadrilateral inwards', () => {
    const q = [P(0, 0, 0), P(1, 0, 0), P(1, 0, 2), P(0, 0, 2)];
    expect(insetQuad(q, [0.1, 0.1, 0.1, 0.1]).map((p) => [+p.x.toFixed(9), +p.z.toFixed(9)])).toEqual([
      [0.1, 0.1],
      [0.9, 0.1],
      [0.9, 1.9],
      [0.1, 1.9],
    ]);
    // A door: no frame along the bottom.
    expect(insetQuad(q, [0, 0.1, 0.1, 0.1]).map((p) => [+p.x.toFixed(9), +p.z.toFixed(9)])).toEqual([
      [0.1, 0],
      [0.9, 0],
      [0.9, 1.9],
      [0.1, 1.9],
    ]);
  });
});

import { describe, expect, it } from 'vitest';
import { computeBuildup, heightOn, offsetLine, roofLine } from './buildup';
import { mansardSection, roofSection } from './geometry';

const S2 = Math.SQRT2;
/** 175 spoor, 18 beschot, 22 tengel, 22 panlat, 68 pan: 305 mm. */
const layers = { rafter: 0.175, deck: 0.018, counter: 0.022, batten: 0.022, tile: 0.068 };

describe('roof build-up', () => {
  it('moves a roof line square to its slopes, meeting again at the ridge', () => {
    const line = [
      { x: 0, y: 0 },
      { x: 4, y: 4 },
      { x: 8, y: 0 },
    ];
    const up = offsetLine(line, 0.1);
    expect(up.map((p) => [+p.x.toFixed(9), +p.y.toFixed(9)])).toEqual([
      [0, +(0.1 * S2).toFixed(9)],
      [4, +(4 + 0.1 * S2).toFixed(9)],
      [8, +(0.1 * S2).toFixed(9)],
    ]);
    expect(heightOn(up, 2)).toBeCloseTo(2 + 0.1 * S2, 9);
  });

  it('works back from the top of the tiles to the rafters, also under the overhang', () => {
    // 45° gable roof, 8 m span, 400 mm overhang; the entered roof is the top of the tiles.
    const roof = roofSection({ type: 'zadeldak', span: 8, pitch: 45, overhang: 0.4 });
    const bu = computeBuildup(roof, { reference: 'boven', ...layers });
    expect(bu.total).toBeCloseTo(0.305, 9);
    expect(bu.plumb.map((p) => p.thickness)).toEqual([expect.closeTo(0.305 * S2, 9), expect.closeTo(0.305 * S2, 9)]);
    expect(bu.lines.map((l) => l.name)).toEqual([
      'Onderkant constructie',
      'Bovenkant spoor / gording',
      'Bovenkant dakbeschot',
      'Bovenkant tengel',
      'Bovenkant panlat',
      'Bovenkant pannen',
    ]);
    expect(bu.points.map((p) => p.label)).toEqual(['Einde overstek links', 'Muur links', 'Nok', 'Muur rechts', 'Einde overstek rechts']);
    const [end, wall, ridge] = bu.points;
    // Top of the tiles is the entered line: 0 at the wall, 4 m at the ridge, −0,4 at the end of the overhang.
    expect(wall.z[5]).toBeCloseTo(0, 9);
    expect(ridge.z[5]).toBeCloseTo(4, 9);
    expect(end.z[5]).toBeCloseTo(-0.4, 9);
    // Underside of the rafters 305 mm square below: 431 mm plumb.
    expect(wall.z[0]).toBeCloseTo(-0.305 * S2, 9);
    expect(ridge.z[0]).toBeCloseTo(4 - 0.305 * S2, 9);
    // Under the overhang: that much lower again than the end of the tiles.
    expect(end.z[0]).toBeCloseTo(-0.4 - 0.305 * S2, 9);
    // Top of the rafters: 130 mm (the layers on them) square under the tiles.
    expect(wall.z[1]).toBeCloseTo(-0.13 * S2, 9);
  });

  it('builds up from the underside', () => {
    const roof = roofSection({ type: 'zadeldak', span: 8, pitch: 45 });
    const bu = computeBuildup(roof, { reference: 'onder', ...layers, deck: 0 });
    // A layer of 0 is left out.
    expect(bu.lines.map((l) => l.name)).not.toContain('Bovenkant dakbeschot');
    const ridge = bu.points.find((p) => p.label === 'Nok')!;
    expect(ridge.z[0]).toBeCloseTo(4, 9);
    expect(ridge.z[ridge.z.length - 1]).toBeCloseTo(4 + 0.287 * S2, 9);
    expect(bu.points.some((p) => p.label.startsWith('Einde overstek'))).toBe(false);
  });

  it('keeps every layer parallel when the pitches differ', () => {
    const roof = roofSection({ type: 'zadeldak', span: 6, wallLeft: 3, wallRight: 2.4, pitch: 40, pitchRight: 25, overhang: 0.3 });
    const bu = computeBuildup(roof, { reference: 'boven', ...layers });
    const base = roofLine(roof);
    const under = bu.lines[0].pts;
    // Each moved segment lies 305 mm square below its own slope.
    for (let i = 0; i + 1 < under.length; i++) {
      const mx = (under[i].x + under[i + 1].x) / 2;
      const j = base.findIndex((p, k) => k + 1 < base.length && p.x <= mx && mx <= base[k + 1].x && base[k + 1].x - p.x > 1e-9);
      const [a, b] = [base[j], base[j + 1]];
      const mid = { x: (under[i].x + under[i + 1].x) / 2, y: (under[i].y + under[i + 1].y) / 2 };
      const dist = ((b.x - a.x) * (mid.y - a.y) - (b.y - a.y) * (mid.x - a.x)) / Math.hypot(b.x - a.x, b.y - a.y);
      expect(dist).toBeCloseTo(-0.305, 6);
    }
    // The battens follow their own line: longer on the left than the rafter line from the end to the ridge.
    expect(bu.battenSlopes).toHaveLength(2);
    expect(bu.battenSlopes[0]).not.toBeCloseTo(roof.left.rafterWithOverhang, 3);
  });

  it('gives a lean-to its low and high side, and a mansard roof its knees', () => {
    const lean = roofSection({ type: 'lessenaarsdak', span: 3.6, pitch: 10, overhang: 0.3, overhangRight: 0 });
    const bl = computeBuildup(lean, { reference: 'boven', ...layers });
    expect(bl.points.map((p) => p.label)).toEqual(['Einde overstek lage kant', 'Muur lage kant', 'Muur hoge kant']);
    expect(bl.battenSlopes[0]).toBeCloseTo(lean.left.rafterWithOverhang, 9);
    const mansard = mansardSection({ span: 8, lower: { run: 1, rise: 2.5 }, upper: { rise: 1.5 } });
    const bm = computeBuildup(mansard, { reference: 'onder', ...layers });
    expect(bm.points.map((p) => p.label)).toEqual(['Muur links', 'Knik links', 'Nok', 'Knik rechts', 'Muur rechts']);
    expect(bm.plumb).toHaveLength(4);
    // The knee of the top layer lies above and inside the knee of the line.
    const knee = bm.lines[bm.lines.length - 1].pts[1];
    expect(knee.y).toBeGreaterThan(2.5);
  });
});

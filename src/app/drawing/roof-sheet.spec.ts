import { describe, expect, it } from 'vitest';
import { computeDak } from '../model/compute';
import { createItem, DakItem, emptyBuildup, emptyTiles } from '../model/models';
import { roofSectionView, roofSheet } from './roof-sheet';

const base = {
  ...(createItem('dak') as DakItem),
  span: '8',
  wallLeft: '3',
  wallRight: '3',
  pitch: '45',
  overhang: '0,4',
  length: '10',
  gableOverhang: '0,2',
  buildup: { ...emptyBuildup(), rafter: '175 mm', deck: '18 mm', counter: '22 mm', batten: '22 mm', tile: '68 mm' },
  tiles: { ...emptyTiles(), gauge: '308 mm', cover: '204 mm', eavesGap: '245 mm', weight: '2,46' },
};
const dak = (item: DakItem) => {
  const r = computeDak(item);
  if (r.status !== 'ok') throw new Error(r.message);
  return r.value;
};
const texts = (item: DakItem) => roofSectionView(dak(item)).prims.flatMap((p) => (p.t === 'dim' || p.t === 'text' ? [p.text] : []));

describe('roof truss work drawing', () => {
  it('dimensions span, overhangs, heights, rafters and battens', () => {
    const t = texts(base);
    // Horizontal: overhang, half spans, span, overall.
    for (const s of ['400', '4000', '8000', '8800']) expect(t).toContain(s);
    // Heights of the roof as entered: wall 3000, ridge 4000 above it, 7000 in all.
    for (const s of ['3000', '7000']) expect(t).toContain(s);
    // Rafters on their top: 45°, 4 m run less the build-up → 5657 wall to ridge, 566 overhang.
    expect(t.filter((x) => x === '5657')).toHaveLength(2);
    expect(t.filter((x) => x === '566')).toHaveLength(2);
    expect(t).toContain('45,0°');
    // Battens: 35 at the ridge, then the gauges.
    expect(t).toContain('35');
    expect(t.some((x) => /^\d+ × 308$/.test(x))).toBe(true);
  });

  it('puts the tables next to the section on one A4 at scale', () => {
    const svg = roofSheet(dak(base), { project: 'Schuur', subject: 'Kap', date: new Date(2026, 9, 17) });
    expect(svg).toContain('width="297mm"');
    expect(svg).toMatch(/1:(50|100)/);
    for (const s of ['Dak', 'Sparren (bovenkant spar)', 'Zaagsneden', 'Hoogtes (opbouw 305)', 'Latverdeling (langs de spar)', 'Materiaal', 'Schuur · Kap']) expect(svg).toContain(s);
    // Plumb cut at 45°: 45° on the rafter, 175 mm rafter → 247 mm long.
    expect(svg).toContain('45,0° op de spar');
    expect(svg).toContain('>247<');
    expect(svg).not.toContain('NaN');
  });

  it('draws a lean-to and a mansard roof, and a roof without build-up', () => {
    const lean = { ...base, roofType: 'lessenaarsdak' as const, span: '3,6', pitch: '15', wallRight: '', overhangRight: '0' };
    const mansard = { ...base, roofType: 'mansardekap' as const, lowerRun: '1', lowerRise: '2,5', rise: '1,5', pitch: '', wallLeft: '', wallRight: '' };
    const plain = { ...base, buildup: undefined, tiles: undefined };
    for (const item of [lean, mansard, plain]) {
      const svg = roofSheet(dak(item), { project: 'P', subject: 'Kap' });
      expect(svg).not.toContain('NaN');
      expect(svg).not.toContain('undefined');
    }
    expect(roofSheet(dak(mansard), { project: 'P', subject: 'Kap' })).toContain('Bovendak: loodsnede nok');
    expect(texts(lean)).toContain('3600');
  });
});

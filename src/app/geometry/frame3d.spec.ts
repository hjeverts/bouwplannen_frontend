import { describe, expect, it } from 'vitest';
import { frameView, framePieces } from '../drawing/frame-views';
import { renderFitted } from '../drawing/vector';
import { computeDak } from '../model/compute';
import { AfdakEntry, createItem, DakItem, emptyAfdak, emptyAfdakRoof, emptyBuildup, emptyTiles } from '../model/models';
import { buildFrame, piecesOf, Prism } from './frame3d';

const afdak: AfdakEntry = {
  ...emptyAfdak(),
  width: '5',
  depth: '2,5',
  postsFront: '3',
  footing: '0,4',
  walls: ['links'],
  roof: { ...emptyAfdakRoof(), pitch: '18', frontHeight: '2,2', beamHeight: '0,15', backWidth: '0,15', rafterWidth: '0,05', rafterHeight: '0,15', rafterSpacing: '0,6' },
};
const tiles = { ...emptyTiles(), width: '0,267', length: '0,367', gauge: '0,308', cover: '0,204', eavesGap: '0,245', ridgeGap: '0,035' };
const afdakDak = (extra: Partial<DakItem> = {}): DakItem => ({
  ...(createItem('dak') as DakItem),
  roofType: 'lessenaarsdak',
  afdakOn: true,
  afdak,
  buildup: { ...emptyBuildup(), counter: '0,022', batten: '0,025', tile: '0,06' },
  tiles,
  ...extra,
});
const kap = (extra: Partial<DakItem> = {}): DakItem => ({
  ...(createItem('dak') as DakItem),
  roofType: 'zadeldak',
  span: '6',
  pitch: '40',
  pitchRight: '40',
  overhang: '0,4',
  length: '8',
  gableOverhang: '0,3',
  buildup: { ...emptyBuildup(), reference: 'onder', rafter: '0,17', deck: '0,018', counter: '0,022', batten: '0,025', tile: '0,06', rafterWidth: '0,07', rafterSpacing: '0,6' },
  tiles,
  ...extra,
});

function ok(item: DakItem) {
  const r = computeDak(item);
  if (r.status !== 'ok') throw new Error(r.message);
  return r.value;
}

describe('3D construction', () => {
  it('cuts a member into blocks whose faces cover its outside exactly once', () => {
    const prism: Prism = { kind: 'beam', poly: [{ x: 0, y: 0 }, { x: 0.15, y: 0 }, { x: 0.15, y: 1 }, { x: 0, y: 1 }], w0: 0, w1: 2 };
    const pieces = piecesOf(prism);
    const areaOf = (pts: { x: number; y: number; z: number }[]) => {
      // Newell: half the length of the summed cross products.
      let x = 0;
      let y = 0;
      let z = 0;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        x += (a.y - b.y) * (a.z + b.z);
        y += (a.z - b.z) * (a.x + b.x);
        z += (a.x - b.x) * (a.y + b.y);
      }
      return Math.hypot(x, y, z) / 2;
    };
    const total = pieces.flatMap((p) => p.faces).reduce((s, f) => s + areaOf(f.pts), 0);
    // 2 × (0.15 × 1) ends + 2 × (2 × 1) sides + 2 × (2 × 0.15) top and bottom.
    expect(total).toBeCloseTo(0.3 + 4 + 0.6, 9);
    expect(pieces.length).toBe(Math.ceil(1 / 0.45) * Math.ceil(2 / 0.45));
    // Edges: only the 12 edges of the beam, in pieces (total length 4 × 0.15 + 4 × 1 + 4 × 2).
    const seen = new Set<string>();
    let length = 0;
    for (const f of pieces.flatMap((p) => p.faces))
      for (const [a, b] of f.edges) {
        const key = [a, b].map((p) => [p.x, p.y, p.z].map((v) => v.toFixed(6)).join(',')).sort().join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        length += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      }
    expect(length).toBeCloseTo(0.6 + 4 + 8, 6);
  });

  it('builds an afdak from posts, footings, beams, rafters, counter battens and battens', () => {
    const d = ok(afdakDak());
    const f = buildFrame(d);
    const count = (k: string) => f.members.filter((m) => m.kind === k).length;
    const r = d.afdak!.rafters!;
    expect(count('post')).toBe(3);
    expect(count('footing')).toBe(3);
    expect(count('beam')).toBe(2);
    expect(count('rafter')).toBe(r.xs.length);
    expect(count('counter')).toBe(r.xs.length);
    // One batten per row plus the eaves batten.
    expect(count('batten')).toBe(d.tiles!.planes[0].battens + 1);
    // Posts stand on the ground up to the underside of the front beam.
    const post = f.members.find((m) => m.kind === 'post')!;
    expect(Math.max(...post.poly.map((p) => p.y))).toBeCloseTo(r.frontPost, 9);
    // The rafter keeps its notches: the front seat is level at the top of the beam.
    const rafter = f.members.find((m) => m.kind === 'rafter')!;
    expect(rafter.poly.filter((p) => Math.abs(p.y - r.seats[1].z) < 1e-9).length).toBe(2);
    // Battens lie on the counter battens: their underside at the top of the counter battens.
    const counterTop = d.buildup!.lines.find((l) => l.name === 'Bovenkant tengel')!;
    expect(counterTop).toBeTruthy();
    // Tiles, the side wall and the building wall are see-through sheets, not members.
    expect(f.ghosts.some((g) => g.kind === 'tiles')).toBe(true);
    expect(f.ghosts.filter((g) => g.kind === 'wall').length).toBe(2);
    expect(f.members.every((m) => m.poly.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)))).toBe(true);
  });

  it('builds a gable roof: rafter pairs along the length and battens on both planes', () => {
    const d = ok(kap());
    const f = buildFrame(d);
    const rafters = f.members.filter((m) => m.kind === 'rafter');
    // 8 m, 70 mm rafters at most 600 apart: 14 spaces, 15 rafters, the outer ones flush with the gables.
    expect(rafters.length).toBe(15);
    expect(rafters[0].w0).toBeCloseTo(0.3, 9);
    expect(rafters[rafters.length - 1].w1).toBeCloseTo(8.3, 9);
    const planes = d.tiles!.planes;
    expect(f.members.filter((m) => m.kind === 'batten').length).toBe(planes.reduce((s, p) => s + p.battens + 1, 0));
    // Battens run the full length with the gable overhangs.
    expect(f.members.find((m) => m.kind === 'batten')!.w1).toBeCloseTo(8.6, 9);
    expect(f.ghosts.filter((g) => g.kind === 'wall').length).toBe(2);
  });

  it('says what is missing for a roof', () => {
    expect(buildFrame(ok(kap({ buildup: undefined }))).notes[0]).toContain('hoogte van de spoor');
    expect(buildFrame(ok(kap({ length: '' }))).notes[0]).toContain('daklengte');
    expect(buildFrame(ok(kap({ buildup: { ...kap().buildup!, rafterWidth: '', rafterSpacing: '' } }))).notes[0]).toContain('niet ingevuld');
  });

  it('draws the timber shaded, and the tiles see-through or not at all', async () => {
    for (const item of [afdakDak(), kap()]) {
      const f = buildFrame(ok(item));
      const pieces = framePieces(f);
      const cam = { azimuth: -35, elevation: 28 };
      const see = frameView(f, pieces, cam, { cover: 'doorzichtig', walls: 'doorzichtig', battens: true });
      const off = frameView(f, pieces, cam, { cover: 'uit', walls: 'uit', battens: false });
      expect(see.prims.some((p) => p.t === 'poly' && p.cls === 'ghost')).toBe(true);
      expect(off.prims.some((p) => p.t === 'poly' && p.cls === 'ghost')).toBe(false);
      expect(off.prims.length).toBeLessThan(see.prims.length);
      const svg = renderFitted(see, 800, 560, 3.8, 2);
      expect(svg).not.toContain('NaN');
      const dump = (globalThis as { process?: { env?: Record<string, string> } }).process?.env?.['FRAME_DUMP'];
      if (dump) {
        // Manual check: the SVG next to the scratch files.
        const name = 'node:fs';
        const fs = (await import(/* @vite-ignore */ name)) as { writeFileSync: (p: string, s: string) => void };
        fs.writeFileSync(`${dump}/${item.roofType}.svg`, svg);
      }
    }
  });
});

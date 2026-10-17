import { TestBed } from '@angular/core/testing';
import { computeDak, computeDriehoek, computeHoek, computeVorm } from './compute';
import { outlineOf, outlineToDxf, parseImport, projectToCsv, toJson } from './export';
import { createItem, DakItem, DriehoekItem, emptyBuildup, emptyTiles, HoekItem, resizeVorm, VormItem } from './models';
import { ProjectStore } from './project-store';
import { MemoryProjectStorage, PROJECT_STORAGE } from './storage';

describe('compute', () => {
  it('hoek: incomplete, error and ok', () => {
    const item = createItem('hoek') as HoekItem;
    expect(computeHoek(item).status).toBe('incomplete');
    expect(computeHoek({ ...item, a: '1', b: '1', c: 'x' })).toEqual({ status: 'error', message: expect.stringContaining('geen maat') });
    expect(computeHoek({ ...item, a: '1', b: '1', c: '5' }).status).toBe('error');
    const ok = computeHoek({ ...item, a: '300 mm', b: '0,4', c: '50 cm' });
    expect(ok.status).toBe('ok');
    if (ok.status === 'ok') expect(ok.value.angle).toBeCloseTo(90, 9);
  });

  it('driehoek counts missing values', () => {
    const item = createItem('driehoek') as DriehoekItem;
    const r = computeDriehoek({ ...item, a: '3' });
    expect(r).toEqual({ status: 'incomplete', message: expect.stringContaining('2 waarden') });
    const ok = computeDriehoek({ ...item, a: '3', b: '4', C: '90' });
    expect(ok.status).toBe('ok');
  });

  it('vorm via diagonals and via angles with room totals', () => {
    let item = createItem('vorm') as VormItem;
    item = { ...item, sides: ['4', '3', '4', '3'], diagonals: ['5'], height: '2,5', openings: [{ name: 'deur', width: '0,9', height: '2,1' }] };
    const r = computeVorm(item);
    expect(r.status).toBe('ok');
    if (r.status === 'ok') {
      expect(r.value.room!.floorArea).toBeCloseTo(12, 9);
      expect(r.value.room!.netWallArea).toBeCloseTo(35 - 1.89, 9);
    }
    const viaAngles = computeVorm({ ...item, method: 'hoeken', angles: ['90', '90'], sides: ['4', '3', '4', ''] });
    expect(viaAngles.status).toBe('ok');
    if (viaAngles.status === 'ok') expect(viaAngles.value.shape.area).toBeCloseTo(12, 9);
  });

  it('vorm incomplete message counts what is missing', () => {
    const item = createItem('vorm') as VormItem;
    expect(computeVorm(item)).toEqual({ status: 'incomplete', message: 'Nog 5 maten in te vullen.' });
  });

  it('resizeVorm keeps existing values', () => {
    const item = { ...(createItem('vorm') as VormItem), sides: ['1', '2', '3', '4'] };
    const five = resizeVorm(item, 5);
    expect(five.sides).toEqual(['1', '2', '3', '4', '']);
    expect(five.diagonals.length).toBe(2);
    expect(five.angles.length).toBe(3);
    expect(resizeVorm(item, 2).sides.length).toBe(3);
  });

  it('mansardekap: incomplete messages, result and older items without lower fields', () => {
    const base = { ...(createItem('dak') as DakItem), roofType: 'mansardekap' as const, span: '8' };
    expect(computeDak(base)).toEqual({ status: 'incomplete', message: 'Vul voor het onderdak nog 2 waarden in.' });
    expect(computeDak({ ...base, lowerRun: '1', lowerRise: '2,5' })).toEqual({
      status: 'incomplete',
      message: 'Vul voor het bovendak de hoogte, helling of lengte in.',
    });
    const ok = computeDak({ ...base, lowerRun: '1', lowerRise: '2,5', rise: '1,5', length: '10' });
    expect(ok.status).toBe('ok');
    if (ok.status === 'ok') {
      expect(ok.value.roof.rise).toBeCloseTo(4, 9);
      const perSide = (Math.hypot(1, 2.5) + Math.hypot(3, 1.5)) * 10;
      expect(ok.value.surfaceLeft! + ok.value.surfaceRight!).toBeCloseTo(2 * perSide, 9);
    }
    const legacy = { ...base } as Partial<DakItem>;
    delete legacy.lowerRun;
    delete legacy.lowerRise;
    expect(computeDak(legacy as DakItem).status).toBe('incomplete');
  });

  it('zadeldak: gable overhang lengthens purlins and the roof surface', () => {
    const item = { ...(createItem('dak') as DakItem), span: '8', rise: '3', overhang: '0,4', length: '10', gableOverhang: '0,3' };
    const r = computeDak(item);
    expect(r.status).toBe('ok');
    if (r.status === 'ok') {
      expect(r.value.purlinLength).toBeCloseTo(10.6, 9);
      const rafter = 5 + 0.4 / 0.8; // 0,4 m level overhang along a 3:4 slope
      expect(r.value.roof.left.rafterWithOverhang).toBeCloseTo(rafter, 9);
      expect(r.value.surfaceLeft).toBeCloseTo(rafter * 10.6, 9);
    }
    expect(computeDak({ ...item, gableOverhang: '-1' }).status).toBe('error');
  });

  it('overhang per side: none on one eaves or one gable end', () => {
    const base = { ...(createItem('dak') as DakItem), span: '8', rise: '3', overhang: '0,4', length: '10', gableOverhang: '0,3' };
    const r = computeDak({ ...base, overhangRight: '0', gableOverhangEnd: '0' });
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.value.roof.left.rafterWithOverhang).toBeCloseTo(5.5, 9);
    expect(r.value.roof.right!.rafterWithOverhang).toBeCloseTo(5, 9);
    // One gable end without overhang: purlins 10 + 0,3.
    expect(r.value.purlinLength).toBeCloseTo(10.3, 9);
    expect(r.value.surfaceRight).toBeCloseTo(5 * 10.3, 9);
    // Empty: the same as the other side, as before.
    const same = computeDak({ ...base, overhangRight: '', gableOverhangEnd: '' });
    if (same.status !== 'ok') throw new Error(same.message);
    expect(same.value.roof.right!.rafterWithOverhang).toBeCloseTo(5.5, 9);
    expect(same.value.purlinLength).toBeCloseTo(10.6, 9);
    expect(computeDak({ ...base, overhangRight: '-0,1' }).status).toBe('error');
    expect(computeDak({ ...base, gableOverhangEnd: '-0,1' }).status).toBe('error');
  });

  it('lessenaarsdak: the rafter runs out past both walls', () => {
    // 4 m run, 3 m rise: rafter 5, slope factor 5/4.
    const item = { ...(createItem('dak') as DakItem), roofType: 'lessenaarsdak' as const, span: '4', rise: '3', overhang: '0,4' };
    const both = computeDak(item);
    if (both.status !== 'ok') throw new Error(both.message);
    expect(both.value.roof.left.rafterWithOverhang).toBeCloseTo(5 + 0.8 * 1.25, 9);
    const one = computeDak({ ...item, overhangRight: '0' });
    if (one.status !== 'ok') throw new Error(one.message);
    expect(one.value.roof.left.rafterWithOverhang).toBeCloseTo(5 + 0.4 * 1.25, 9);
    expect([one.value.roof.overhangLeft, one.value.roof.overhangRight]).toEqual([0.4, 0]);
  });

  it('mansardekap: its own overhang on each side', () => {
    const item = { ...(createItem('dak') as DakItem), roofType: 'mansardekap' as const, span: '8', lowerRun: '1', lowerRise: '2,5', rise: '1,5', overhang: '0,3', overhangRight: '0' };
    const r = computeDak(item);
    if (r.status !== 'ok') throw new Error(r.message);
    expect(r.value.roof.left.rafterWithOverhang).toBeGreaterThan(r.value.roof.left.rafter);
    expect(r.value.roof.right!.rafterWithOverhang).toBeCloseTo(r.value.roof.right!.rafter, 9);
  });

  it('tiles from the manufacturer sheet, typed in mm', () => {
    const tiles = { ...emptyTiles(), width: '267 mm', length: '367 mm', gauge: '308 mm', cover: '204 mm', eavesGap: '245 mm', weight: '2,46', minPitch: '25' };
    const item = { ...(createItem('dak') as DakItem), span: '8', pitch: '45', length: '10', tiles };
    const r = computeDak(item);
    if (r.status !== 'ok') throw new Error(r.message);
    expect(r.value.tilesMessage).toBeNull();
    const t = r.value.tiles!;
    expect(t.planes).toHaveLength(2);
    // Rafter 4·√2 = 5,657 m: 35 + 17 × 308 = 5271, last gauge 386 or one more (78): 386 − 245 = 141 < 245 − 78.
    expect(t.planes[0].spaces).toBe(17);
    expect(t.planes[0].eavesGap).toBeCloseTo(4 * Math.SQRT2 - 0.035 - 17 * 0.308, 9);
    expect(t.normalPerRow).toBe(49);
    expect(t.warnings.length).toBe(2);
    // No tile data: no tiles and no message; incomplete data: a message, the roof itself still works.
    const none = computeDak({ ...item, tiles: emptyTiles() });
    expect(none.status === 'ok' && none.value.tiles === null && none.value.tilesMessage === null).toBe(true);
    const half = computeDak({ ...item, tiles: { ...emptyTiles(), gauge: '308 mm' } });
    expect(half.status).toBe('ok');
    if (half.status === 'ok') expect(half.value.tilesMessage).toMatch(/dekkende breedte/);
    const wrong = computeDak({ ...item, tiles: { ...tiles, weight: 'zwaar' } });
    if (wrong.status === 'ok') expect(wrong.value.tilesMessage).toMatch(/geen getal/);
  });

  it('roof build-up: heights from the top of the tiles, battens along their own line', () => {
    const buildup = { ...emptyBuildup(), rafter: '175 mm', deck: '18 mm', counter: '22 mm', batten: '22 mm', tile: '68 mm' };
    const item = { ...(createItem('dak') as DakItem), span: '6', wallLeft: '3', wallRight: '3', pitch: '40', pitchRight: '30', overhang: '0,3', buildup };
    const r = computeDak(item);
    if (r.status !== 'ok') throw new Error(r.message);
    const bu = r.value.buildup!;
    expect(r.value.buildupMessage).toBeNull();
    const wall = bu.points.find((p) => p.label === 'Muur links')!;
    // Top of the tiles at 3 m on the wall (as entered); the rafters sit 305 mm square lower.
    expect(wall.z[bu.lines.length - 1]).toBeCloseTo(3, 9);
    expect(wall.z[0]).toBeCloseTo(3 - 0.305 / Math.cos((40 * Math.PI) / 180), 9);
    // Tiles laid out along the top of the battens.
    const withTiles = computeDak({ ...item, tiles: { ...emptyTiles(), gauge: '308 mm', cover: '204 mm', eavesGap: '245 mm' } });
    if (withTiles.status !== 'ok') throw new Error(withTiles.message);
    expect(withTiles.value.tiles!.planes[0].slope).toBeCloseTo(bu.battenSlopes[0], 9);
    // Nothing entered: no build-up; a negative thickness: a message, the roof still works.
    const none = computeDak({ ...item, buildup: emptyBuildup() });
    expect(none.status === 'ok' && none.value.buildup === null).toBe(true);
    const bad = computeDak({ ...item, buildup: { ...buildup, deck: '-18 mm' } });
    expect(bad.status === 'ok' && /negatief/.test(bad.value.buildupMessage ?? '')).toBe(true);
  });

  it('no counter battens in the build-up: battens straight on the rafters, no counter battens counted', () => {
    const tiles = { ...emptyTiles(), gauge: '308 mm', cover: '204 mm', eavesGap: '245 mm' };
    const item = { ...(createItem('dak') as DakItem), span: '3', pitch: '18', length: '5', tiles };
    const withCounter = computeDak({ ...item, buildup: { ...emptyBuildup(), rafter: '150 mm', deck: '18 mm', counter: '22 mm', batten: '22 mm', tile: '68 mm' } });
    const without = computeDak({ ...item, buildup: { ...emptyBuildup(), rafter: '150 mm', deck: '', counter: '0', batten: '22 mm', tile: '68 mm' } });
    if (withCounter.status !== 'ok' || without.status !== 'ok') throw new Error('roof');
    expect(withCounter.value.tiles!.counter).toBe(true);
    expect(withCounter.value.tiles!.counterBattens).toBeGreaterThan(0);
    expect(without.value.tiles!.counter).toBe(false);
    expect(without.value.tiles!.counterBattens).toBeNull();
    expect(without.value.tiles!.counterLength).toBeNull();
    // Neither a deck nor counter battens: the battens lie straight on the rafters.
    const names = without.value.buildup!.lines.map((l) => l.name);
    expect(names).toEqual(['Onderkant constructie', 'Bovenkant spar / gording', 'Bovenkant panlat', 'Bovenkant pannen']);
    // Without a build-up nothing is known about counter battens: counted as before.
    const plain = computeDak(item);
    expect(plain.status === 'ok' && plain.value.tiles!.counter).toBe(true);
  });

  it('zadeldak: left and right pitch with different wall heights', () => {
    const item = { ...(createItem('dak') as DakItem), span: '6', wallLeft: '3', wallRight: '2,4', pitch: '40', pitchRight: '25' };
    const r = computeDak(item);
    expect(r.status).toBe('ok');
    if (r.status === 'ok') {
      expect(r.value.roof.left.pitch).toBeCloseTo(40, 9);
      expect(r.value.roof.right!.pitch).toBeCloseTo(25, 9);
      expect(r.value.roof.fromFloor).toBe(true);
    }
    expect(computeDak({ ...item, pitchRight: '' })).toEqual({ status: 'incomplete', message: expect.stringContaining('tweede waarde') });
  });

  it('dak with roof length gives surfaces', () => {
    const item = { ...(createItem('dak') as DakItem), span: '8', rise: '3', length: '10' };
    const r = computeDak(item);
    expect(r.status).toBe('ok');
    if (r.status === 'ok') {
      expect(r.value.surfaceLeft).toBeCloseTo(50, 9);
      expect(r.value.surfaceRight).toBeCloseTo(50, 9);
    }
  });
});

describe('export', () => {
  const vorm = { ...(createItem('vorm') as VormItem), name: 'Werkplaats', sides: ['4', '3', '4', '3'], diagonals: ['5'] };
  const project = { id: 'p1', name: 'Schuur', created: '2026-10-09T10:00:00Z', updated: '2026-10-09T10:00:00Z', items: [vorm] };

  it('JSON round trip', () => {
    expect(parseImport(toJson([project]))).toEqual([project]);
    expect(parseImport(JSON.stringify(project))).toEqual([project]);
    expect(() => parseImport('nope')).toThrowError(/JSON/);
    expect(() => parseImport('{"foo":1}')).toThrowError(/Geen projecten/);
  });

  it('CSV uses ; and decimal comma', () => {
    const csv = projectToCsv(project);
    expect(csv.split('\r\n')[0]).toBe('Onderdeel;Soort;Omschrijving;Waarde');
    expect(csv).toContain('Werkplaats;Vorm;Oppervlakte;12,00 m²');
  });

  it('DXF has one LINE per side, in mm', () => {
    const pts = outlineOf(vorm)!;
    const dxf = outlineToDxf(pts);
    expect(dxf.match(/\r\nLINE\r\n/g)!.length).toBe(4);
    expect(dxf).toContain('\r\n4000\r\n');
    expect(dxf.trimEnd().endsWith('EOF')).toBe(true);
  });
});

describe('ProjectStore', () => {
  let storage: MemoryProjectStorage;
  let store: ProjectStore;

  beforeEach(() => {
    storage = new MemoryProjectStorage();
    TestBed.configureTestingModule({ providers: [{ provide: PROJECT_STORAGE, useValue: storage }] });
    store = TestBed.inject(ProjectStore);
  });

  it('creates projects and items and persists every change', () => {
    const p = store.createProject('Schuur');
    expect(store.currentProject()?.name).toBe('Schuur');
    const item = store.addItem('hoek')!;
    expect(store.currentItem()?.id).toBe(item.id);
    store.addItem('hoek');
    expect(store.currentProject()!.items.map((i) => i.name)).toEqual(['Hoek', 'Hoek 2']);
    store.updateItem({ ...(item as HoekItem), a: '1' });
    expect((storage.projects[0].items[0] as HoekItem).a).toBe('1');
    store.duplicateItem(item.id);
    expect(store.currentProject()!.items[1].name).toBe('Hoek (kopie)');
    store.deleteItem(item.id);
    expect(store.currentProject()!.items.length).toBe(2);
    store.deleteProject(p.id);
    expect(storage.projects).toEqual([]);
    expect(store.currentProject()).toBeNull();
  });

  it('import replaces projects with the same id', () => {
    const p = store.createProject('A');
    store.importProjects([{ ...p, name: 'A (import)' }, { ...p, id: 'other', name: 'B' }]);
    expect(store.projects().map((x) => x.name).sort()).toEqual(['A (import)', 'B']);
  });
});

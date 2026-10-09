import { TestBed } from '@angular/core/testing';
import { computeDak, computeDriehoek, computeHoek, computeVorm } from './compute';
import { outlineOf, outlineToDxf, parseImport, projectToCsv, toJson } from './export';
import { createItem, DakItem, DriehoekItem, HoekItem, resizeVorm, VormItem } from './models';
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
      expect(r.value.room.floorArea).toBeCloseTo(12, 9);
      expect(r.value.room.netWallArea!).toBeCloseTo(35 - 1.89, 9);
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

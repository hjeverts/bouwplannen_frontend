import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { DakItem, HoekItem, VormItem } from './model/models';
import { ProjectStore } from './model/project-store';
import { MemoryProjectStorage, PROJECT_STORAGE } from './model/storage';
import { exampleProject } from './pages/project-list';

describe('App', () => {
  let storage: MemoryProjectStorage;

  beforeEach(async () => {
    storage = new MemoryProjectStorage();
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [{ provide: PROJECT_STORAGE, useValue: storage }],
    }).compileComponents();
  });

  function render() {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement, store: TestBed.inject(ProjectStore) };
  }

  it('shows the empty state and can open the example project', async () => {
    const { fixture, el, store } = render();
    expect(el.textContent).toContain('Nog geen projecten');
    (Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes('Voorbeeldproject')) as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(store.currentProject()?.name).toBe('Voorbeeld: schuur');
    expect(el.querySelectorAll('.item').length).toBe(6);
  });

  it('renders every editor for the example project with a result and a drawing', async () => {
    storage.projects = [exampleProject()];
    const { fixture, el, store } = render();
    store.openProject('voorbeeld-schuur');
    for (const item of store.currentProject()!.items) {
      store.openItem(item.id);
      fixture.detectChanges();
      await fixture.whenStable();
      expect(el.querySelector('.status--error')).toBeNull();
      if (item.kind !== 'maten') {
        expect(el.querySelector('.results')).not.toBeNull();
        expect(el.querySelector('.drawing line')).not.toBeNull();
      }
    }
  });

  it('switching the roof to a mansard roof shows the two-part form and a result', async () => {
    storage.projects = [exampleProject()];
    const { fixture, el, store } = render();
    store.openProject('voorbeeld-schuur');
    store.openItem('vb-dak');
    fixture.detectChanges();
    (Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Mansardekap') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.textContent).toContain('Onderdak: twee van deze vier');
    const item = store.currentItem() as DakItem;
    store.updateItem({ ...item, pitch: '', lowerRun: '0,6', lowerRise: '1,8', rise: '1,0' });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(el.querySelector('.status--error')).toBeNull();
    expect(el.querySelector('.result--main dd')?.textContent).toContain('2,800 m');
    expect(el.querySelectorAll('.drawing line').length).toBeGreaterThan(5);
  });

  it('room with corner heights shows walls, volume and a 3D view with openings', async () => {
    storage.projects = [exampleProject()];
    const { fixture, el, store } = render();
    store.openProject('voorbeeld-schuur');
    store.openItem('vb-kapschuur');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(el.querySelector('.status--error')).toBeNull();
    expect(el.querySelectorAll('table.walls tbody tr').length).toBe(6);
    expect(el.textContent).toContain('Inhoud (dakvorm)');
    (Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.trim() === '3D') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    const walls = el.querySelectorAll('app-room3d path.r3d-wall-far, app-room3d path.r3d-wall-near');
    expect(walls.length).toBe(6);
    // Openings are cut out as extra sub-paths ("M … Z M … Z").
    const withHoles = Array.from(walls).filter((p) => (p.getAttribute('d')!.match(/M/g) ?? []).length > 1);
    expect(withHoles.length).toBe(2);
    expect(el.textContent).toContain('schuifdeur');
  });

  it('an opening that does not fit shows an error but keeps the floor plan', async () => {
    storage.projects = [exampleProject()];
    const { fixture, el, store } = render();
    store.openProject('voorbeeld-schuur');
    store.openItem('vb-kapschuur');
    const item = store.currentItem() as VormItem;
    store.updateItem({ ...item, openings: [{ name: 'te breed', width: '9', height: '1', wall: '2', offset: '0', sill: '0' }] });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(el.querySelector('.status--error')?.textContent).toContain('past niet op wand 3–4');
    expect(el.querySelector('.result--main dd')?.textContent).toContain('48,00 m²');
  });

  it('typing a measurement updates the result', async () => {
    storage.projects = [exampleProject()];
    const { fixture, el, store } = render();
    store.openProject('voorbeeld-schuur');
    store.openItem('vb-hoek');
    fixture.detectChanges();
    const input = el.querySelectorAll<HTMLInputElement>('app-measure-field input')[2];
    input.value = '1,4142';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();
    expect((store.currentItem() as HoekItem).c).toBe('1,4142');
    expect(el.querySelector('.result--main dd')?.textContent).toContain('90,00°');
  });
});

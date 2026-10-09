import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { DakItem, HoekItem } from './model/models';
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
    expect(el.querySelectorAll('.item').length).toBe(5);
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

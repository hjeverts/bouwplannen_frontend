import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { API_FETCH } from './api/api-client';
import { DakItem, HoekItem, VormItem } from './model/models';
import { ProjectStore } from './model/project-store';
import { MemoryProjectStorage, PROJECT_STORAGE } from './model/storage';
import { exampleProject } from './pages/project-list';

/** Let pending promises (fetch answers) finish, then update the view. */
async function settle(fixture: { detectChanges(): void; whenStable(): Promise<unknown> }) {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  await fixture.whenStable();
  fixture.detectChanges();
}

describe('App', () => {
  let storage: MemoryProjectStorage;

  beforeEach(async () => {
    storage = new MemoryProjectStorage();
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        { provide: PROJECT_STORAGE, useValue: storage },
        // No Bouwplannen server in these tests: the app works on this device only.
        { provide: API_FETCH, useValue: async () => new Response('niet gevonden', { status: 404 }) },
      ],
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

  it('with a server and no session: login page first, can continue without login, can log in', async () => {
    let loggedIn = false;
    const me = { id: 'u-hans', username: 'hans', displayName: 'Hans', isAdmin: true, personalGroupId: 'p-hans', groups: [{ id: 'p-hans', name: 'Privé', personal: true, isOwner: true, memberCount: 1 }] };
    TestBed.overrideProvider(API_FETCH, {
      useValue: async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        if (path === '/api/auth/login') {
          const body = JSON.parse(String(init?.body));
          if (body.password !== 'goed-wachtwoord') return new Response(JSON.stringify({ title: 'Gebruikersnaam of wachtwoord klopt niet.' }), { status: 401 });
          loggedIn = true;
          return new Response(JSON.stringify(me), { status: 200 });
        }
        if (path === '/api/auth/me') return loggedIn ? new Response(JSON.stringify(me), { status: 200 }) : new Response(null, { status: 401 });
        if (path.startsWith('/api/projects')) return new Response(JSON.stringify({ serverTime: '1', projects: [], groupIds: ['p-hans'], removed: [] }), { status: 200 });
        return new Response(null, { status: 404 });
      },
    });
    const { fixture, el } = render();
    await settle(fixture);
    expect(el.querySelector('app-login-page')).not.toBeNull();

    const type = (sel: string, value: string) => {
      const input = el.querySelector<HTMLInputElement>(sel)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };
    type('#login-user', 'hans');
    type('#login-pass', 'fout');
    fixture.detectChanges();
    el.querySelector<HTMLFormElement>('.login-form')!.dispatchEvent(new Event('submit'));
    await settle(fixture);
    expect(el.querySelector('.login .status--error')?.textContent).toContain('klopt niet');

    type('#login-pass', 'goed-wachtwoord');
    fixture.detectChanges();
    el.querySelector<HTMLFormElement>('.login-form')!.dispatchEvent(new Event('submit'));
    await settle(fixture);
    expect(el.querySelector('app-login-page')).toBeNull();
    expect(el.querySelector('.sync-chip')?.textContent).toContain('Hans');
    // New projects default to the private group.
    expect(el.querySelector('app-group-select select')).not.toBeNull();
  });

  it('continue without logging in shows the projects', async () => {
    TestBed.overrideProvider(API_FETCH, { useValue: async () => new Response(null, { status: 401 }) });
    const { fixture, el } = render();
    await settle(fixture);
    (el.querySelector('.login-skip') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('app-login-page')).toBeNull();
    expect(el.textContent).toContain('Nog geen projecten');
  });
});

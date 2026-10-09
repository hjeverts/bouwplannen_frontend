import { TestBed } from '@angular/core/testing';
import { API_FETCH } from '../api/api-client';
import { AuthService } from '../api/auth.service';
import { KeyValueStore, SYNC_KV } from '../api/kv';
import { HoekItem, Project } from '../model/models';
import { ProjectStore } from '../model/project-store';
import { MemoryProjectStorage, PROJECT_STORAGE } from '../model/storage';
import { SYNC_DEBOUNCE_MS, SyncService } from './sync.service';

type Doc = Project & { version: number; deleted: boolean; serverModified: number; previousGroupId?: string };

/**
 * In-memory stand-in for the .NET API with the same rules: login sessions, groups,
 * versions, If-Match (409 with the current project), tombstones, "since", "removed" and "groupIds".
 * Each device has its own session (like its own cookie).
 */
class FakeServer {
  online = true;
  private clock = 0;
  readonly users = new Map<string, { id: string; password: string; disabled?: boolean }>();
  readonly groups = new Map<string, { name: string; personalOf?: string; members: string[] }>();
  docs = new Map<string, Doc>();
  requests: string[] = [];

  addUser(username: string): string {
    const id = 'u-' + username;
    this.users.set(username, { id, password: 'goed-wachtwoord' });
    this.groups.set('p-' + username, { name: 'Privé', personalOf: id, members: [id] });
    return id;
  }

  addGroup(id: string, ...usernames: string[]): void {
    this.groups.set(id, { name: id, members: usernames.map((u) => 'u-' + u) });
  }

  private groupsOf(userId: string): string[] {
    return [...this.groups].filter(([, g]) => g.members.includes(userId)).map(([id]) => id);
  }

  private me(username: string) {
    const u = this.users.get(username)!;
    const groups = this.groupsOf(u.id).map((id) => ({ id, name: this.groups.get(id)!.name, personal: !!this.groups.get(id)!.personalOf, isOwner: true, memberCount: 1 }));
    return { id: u.id, username, displayName: username, isAdmin: false, personalGroupId: 'p-' + username, groups };
  }

  /** A device: its own session, like its own cookie jar. */
  device() {
    let session: string | null = null;
    const fetchFn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      if (!this.online) throw new TypeError('Failed to fetch');
      const url = new URL(String(input), 'https://bouwplannen.test');
      const method = init?.method ?? 'GET';
      const headers = (init?.headers ?? {}) as Record<string, string>;
      this.requests.push(`${method} ${url.pathname}${url.search}`);
      const json = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status });
      if (method !== 'GET' && headers['X-Requested-With'] !== 'bouwplannen') return json(403);

      if (url.pathname === '/api/auth/login') {
        const { username, password } = JSON.parse(String(init!.body));
        const u = this.users.get(username);
        if (!u || u.password !== password || u.disabled) return json(401, { title: 'Gebruikersnaam of wachtwoord klopt niet.' });
        session = username;
        return json(200, this.me(username));
      }
      const user = session ? this.users.get(session) : undefined;
      if (!user || user.disabled) return json(401);
      if (url.pathname === '/api/auth/me') return json(200, this.me(session!));
      if (url.pathname === '/api/auth/logout') {
        session = null;
        return json(204);
      }

      const access = new Set(this.groupsOf(user.id));
      const canSee = (d: Doc) => !!d.groupId && access.has(d.groupId);
      const ifMatch = headers['If-Match'] ? Number(headers['If-Match'].replaceAll('"', '')) : null;
      if (url.pathname === '/api/projects' && method === 'GET') {
        const since = url.searchParams.get('since');
        const cursor = ++this.clock;
        const changed = [...this.docs.values()].filter((d) => (since ? d.serverModified > Number(since) : !d.deleted));
        const removed = since ? changed.filter((d) => !canSee(d) && d.previousGroupId && access.has(d.previousGroupId)).map((d) => d.id) : [];
        return json(200, { serverTime: String(cursor), projects: changed.filter(canSee), groupIds: [...access], removed });
      }
      const id = decodeURIComponent(url.pathname.split('/').pop()!);
      const current = this.docs.get(id);
      if (method === 'PUT') {
        const body = JSON.parse(String(init!.body));
        if (!access.has(body.groupId)) return json(403);
        if (current && !canSee(current)) return json(404);
        const exists = !!current && !current.deleted;
        if (ifMatch !== null && (current?.version ?? 0) !== ifMatch) return exists ? json(409, current) : json(404);
        const previousGroupId = current && current.groupId !== body.groupId ? current.groupId : current?.previousGroupId;
        const doc = { ...body, version: (current?.version ?? 0) + 1, deleted: false, serverModified: ++this.clock, previousGroupId };
        this.docs.set(id, doc);
        return json(exists ? 200 : 201, doc);
      }
      if (method === 'DELETE') {
        if (!current || current.deleted || !canSee(current)) return json(404);
        if (ifMatch !== null && current.version !== ifMatch) return json(409, current);
        this.docs.set(id, { ...current, items: [], version: current.version + 1, deleted: true, serverModified: ++this.clock });
        return json(204);
      }
      return json(405);
    };
    return fetchFn;
  }

  /** Simulate an edit made by someone else. */
  editElsewhere(id: string, changes: Partial<Doc>): void {
    const d = this.docs.get(id)!;
    const previousGroupId = changes.groupId && changes.groupId !== d.groupId ? d.groupId : d.previousGroupId;
    this.docs.set(id, { ...d, ...changes, previousGroupId, version: d.version + 1, serverModified: ++this.clock });
  }
}

class MemoryKv implements KeyValueStore {
  data = new Map<string, string>();
  get = (k: string) => this.data.get(k) ?? null;
  set = (k: string, v: string) => void (v === '' ? this.data.delete(k) : this.data.set(k, v));
}

function device(server: FakeServer, projects: Project[] = [], kv = new MemoryKv(), fetchFn = server.device()) {
  TestBed.resetTestingModule();
  const storage = new MemoryProjectStorage(projects);
  TestBed.configureTestingModule({
    providers: [
      { provide: PROJECT_STORAGE, useValue: storage },
      { provide: SYNC_KV, useValue: kv },
      { provide: API_FETCH, useValue: fetchFn },
      { provide: SYNC_DEBOUNCE_MS, useValue: 0 },
    ],
  });
  return { store: TestBed.inject(ProjectStore), sync: TestBed.inject(SyncService), auth: TestBed.inject(AuthService), storage, kv, fetchFn };
}

const project = (id: string, name: string, groupId?: string, updated = '2026-10-09T10:00:00.000Z'): Project => ({
  id,
  name,
  created: '2026-10-09T09:00:00.000Z',
  updated,
  groupId,
  items: [{ id: 'h1', kind: 'hoek', name: 'Hoek', notes: '', updated, a: '1', b: '1', c: '1,414' } as HoekItem],
});

async function login(d: ReturnType<typeof device>, username: string) {
  expect(await d.auth.login(username, 'goed-wachtwoord')).toBeNull();
  await d.sync.syncNow();
}

describe('SyncService with login and groups', () => {
  let server: FakeServer;
  beforeEach(() => {
    server = new FakeServer();
    server.addUser('hans');
    server.addUser('piet');
    server.addGroup('g-team', 'hans', 'piet');
  });

  it('does nothing until logged in, then uploads projects that have a group', async () => {
    const d = device(server, [project('p1', 'Schuur', 'p-hans'), project('p2', 'Zonder groep')]);
    await d.sync.syncNow();
    expect(server.requests).toEqual([]);
    expect(d.sync.status()).toBe('uit');

    await login(d, 'hans');
    expect(d.sync.status()).toBe('ok');
    expect(server.docs.get('p1')?.groupId).toBe('p-hans');
    expect(server.docs.has('p2')).toBe(false);
    expect(d.sync.blocked()).toEqual({ p2: 'geen-groep' });

    // Choosing a group sends it.
    d.store.setProjectGroup('p2', 'p-hans');
    await d.sync.syncNow();
    expect(server.docs.get('p2')?.groupId).toBe('p-hans');
    expect(d.sync.blocked()).toEqual({});
  });

  it('wrong password: clear message, not logged in', async () => {
    const d = device(server);
    expect(await d.auth.login('hans', 'fout')).toBe('Gebruikersnaam of wachtwoord klopt niet.');
    expect(d.auth.loggedIn()).toBe(false);
  });

  it('shared group: a project of Hans reaches Piet, and Piet’s edit reaches Hans', async () => {
    const hans = device(server, [project('p1', 'Kap', 'g-team')]);
    await login(hans, 'hans');
    const hansFetch = hans.fetchFn;
    const hansKv = hans.kv;
    const hansStorage = hans.storage;

    const piet = device(server);
    await login(piet, 'piet');
    expect(piet.store.projects().map((p) => p.name)).toEqual(['Kap']);
    piet.store.renameProject('p1', 'Kap door Piet');
    await piet.sync.syncNow();

    const hans2 = device(server, hansStorage.load(), hansKv, hansFetch);
    await hans2.auth.check();
    await hans2.sync.syncNow();
    expect(hans2.store.projects()[0].name).toBe('Kap door Piet');
  });

  it('private projects stay private', async () => {
    const hans = device(server, [project('p1', 'Eigen', 'p-hans')]);
    await login(hans, 'hans');
    const piet = device(server);
    await login(piet, 'piet');
    expect(piet.store.projects()).toEqual([]);
  });

  it('a project moved to a group you are not in disappears here', async () => {
    const piet = device(server);
    server.docs.set('p1', { ...project('p1', 'Kap', 'g-team'), version: 1, deleted: false, serverModified: 0 });
    await login(piet, 'piet');
    expect(piet.store.projects().length).toBe(1);
    server.editElsewhere('p1', { groupId: 'p-hans' });
    await piet.sync.syncNow();
    expect(piet.store.projects()).toEqual([]);
  });

  it('removed from a group: its projects disappear here, unsent edits stay', async () => {
    server.docs.set('a', { ...project('a', 'A', 'g-team'), version: 1, deleted: false, serverModified: 0 });
    server.docs.set('b', { ...project('b', 'B', 'g-team'), version: 1, deleted: false, serverModified: 0 });
    const piet = device(server);
    await login(piet, 'piet');
    expect(piet.store.projects().length).toBe(2);

    server.online = false;
    piet.store.renameProject('b', 'B offline bewerkt');
    server.online = true;
    server.groups.get('g-team')!.members = ['u-hans'];
    await piet.sync.syncNow();
    expect(piet.store.projects().map((p) => p.id)).toEqual(['b']);
    expect(piet.sync.blocked()).toEqual({ b: 'geen-toegang' });
  });

  it('conflict: the most recently edited version wins', async () => {
    const d = device(server, [project('p1', 'Schuur', 'p-hans')]);
    await login(d, 'hans');
    d.store.renameProject('p1', 'Hier gewijzigd');
    server.editElsewhere('p1', { name: 'Daar gewijzigd', updated: '2999-01-01T00:00:00.000Z' });
    await d.sync.syncNow();
    expect(d.store.projects()[0].name).toBe('Daar gewijzigd');

    server.editElsewhere('p1', { name: 'Oud elders', updated: '2000-01-01T00:00:00.000Z' });
    d.store.renameProject('p1', 'Nieuw hier');
    await d.sync.syncNow();
    expect(server.docs.get('p1')?.name).toBe('Nieuw hier');
  });

  it('deletions travel, and an edit elsewhere wins over a delete here', async () => {
    const d = device(server, [project('p1', 'Schuur', 'p-hans'), project('p2', 'Garage', 'p-hans')]);
    await login(d, 'hans');
    d.store.deleteProject('p1');
    await d.sync.syncNow();
    expect(server.docs.get('p1')?.deleted).toBe(true);

    server.editElsewhere('p2', { name: 'Elders aangepast', updated: '2999-01-01T00:00:00.000Z' });
    d.store.deleteProject('p2');
    await d.sync.syncNow();
    expect(d.store.projects().map((p) => p.name)).toEqual(['Elders aangepast']);
  });

  it('offline: keeps changes and sends them when the server is back', async () => {
    const d = device(server, [project('p1', 'Schuur', 'p-hans')]);
    await login(d, 'hans');
    server.online = false;
    d.store.renameProject('p1', 'Op de bouwplaats');
    await d.sync.syncNow();
    expect(d.sync.status()).toBe('offline');
    expect(d.sync.pending()).toBe(1);
    server.online = true;
    await d.sync.syncNow();
    expect(server.docs.get('p1')?.name).toBe('Op de bouwplaats');
  });

  it('session ended elsewhere: logged out, changes kept for the next login', async () => {
    const d = device(server, [project('p1', 'Schuur', 'p-hans')]);
    await login(d, 'hans');
    server.users.get('hans')!.disabled = true;
    d.store.renameProject('p1', 'Na uitloggen');
    await d.sync.syncNow();
    expect(d.auth.loggedIn()).toBe(false);
    expect(d.sync.status()).toBe('uit');
    server.users.get('hans')!.disabled = false;
    await login(d, 'hans');
    expect(server.docs.get('p1')?.name).toBe('Na uitloggen');
  });

  it('offline at start with a known user: stays logged in on the last details', async () => {
    const d = device(server);
    await login(d, 'hans');
    const kv = d.kv;
    server.online = false;
    const again = device(server, [], kv);
    await again.auth.check();
    expect(again.auth.loggedIn()).toBe(true);
    expect(again.auth.offline()).toBe(true);
    expect(again.auth.groups().map((g) => g.id).sort()).toEqual(['g-team', 'p-hans']);
  });

  it('no server at this address: state geen-server', async () => {
    const d = device(server, [], new MemoryKv(), async () => new Response('<html>niet gevonden</html>', { status: 404 }));
    await d.auth.check();
    expect(d.auth.state()).toBe('geen-server');
  });

  it('logout with wipe removes the projects from this device', async () => {
    const d = device(server, [project('p1', 'Schuur', 'p-hans')]);
    await login(d, 'hans');
    await d.sync.logout({ wipe: true });
    expect(d.store.projects()).toEqual([]);
    expect(d.auth.loggedIn()).toBe(false);
    expect(server.docs.get('p1')?.deleted).toBe(false); // still on the server
  });

  it('every changing request carries the app header', async () => {
    const d = device(server, [project('p1', 'Schuur', 'p-hans')]);
    await login(d, 'hans');
    expect(server.docs.has('p1')).toBe(true); // the fake server refuses changes without the header
  });
});

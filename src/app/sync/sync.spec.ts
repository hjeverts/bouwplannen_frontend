import { TestBed } from '@angular/core/testing';
import { HoekItem, Project } from '../model/models';
import { ProjectStore } from '../model/project-store';
import { MemoryProjectStorage, PROJECT_STORAGE } from '../model/storage';
import { KeyValueStore, SYNC_DEBOUNCE_MS, SYNC_FETCH, SYNC_KV, SyncService } from './sync.service';

/**
 * In-memory stand-in for the .NET API with the same rules: versions, If-Match (409 with the
 * current project), tombstones, "since" cursor and the API key.
 */
class FakeServer {
  readonly key = 'geheim';
  online = true;
  private clock = 0;
  docs = new Map<string, Project & { version: number; deleted: boolean; serverModified: number }>();
  requests: string[] = [];

  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (!this.online) throw new TypeError('Failed to fetch');
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const headers = (init?.headers ?? {}) as Record<string, string>;
    this.requests.push(`${method} ${url.pathname}${url.search}`);
    const json = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status });
    if (url.pathname === '/api/health') return json(200, { status: 'ok' });
    if (headers['X-Api-Key'] !== this.key) return json(401, { title: 'nee' });

    const ifMatch = headers['If-Match'] ? Number(headers['If-Match'].replaceAll('"', '')) : null;
    if (url.pathname === '/api/projects' && method === 'GET') {
      const since = url.searchParams.get('since');
      const cursor = ++this.clock;
      const list = [...this.docs.values()].filter((d) => (since ? d.serverModified > Number(since) : !d.deleted));
      return json(200, { serverTime: String(cursor), projects: list });
    }
    const id = decodeURIComponent(url.pathname.split('/').pop()!);
    const current = this.docs.get(id);
    if (method === 'PUT') {
      const body = JSON.parse(String(init!.body));
      const exists = !!current && !current.deleted;
      if (ifMatch !== null && (current?.version ?? 0) !== ifMatch) return exists ? json(409, current) : json(404);
      const doc = { ...body, version: (current?.version ?? 0) + 1, deleted: false, serverModified: ++this.clock };
      this.docs.set(id, doc);
      return json(exists ? 200 : 201, doc);
    }
    if (method === 'DELETE') {
      if (!current || current.deleted) return json(404);
      if (ifMatch !== null && current.version !== ifMatch) return json(409, current);
      this.docs.set(id, { ...current, items: [], version: current.version + 1, deleted: true, serverModified: ++this.clock });
      return json(204);
    }
    return json(405);
  };

  /** Simulate an edit made on another device. */
  editElsewhere(id: string, name: string, updated: string): void {
    const d = this.docs.get(id)!;
    this.docs.set(id, { ...d, name, updated, version: d.version + 1, serverModified: ++this.clock });
  }
}

class MemoryKv implements KeyValueStore {
  data = new Map<string, string>();
  get = (k: string) => this.data.get(k) ?? null;
  set = (k: string, v: string) => void this.data.set(k, v);
}

function device(server: FakeServer, projects: Project[] = []) {
  TestBed.resetTestingModule();
  const storage = new MemoryProjectStorage(projects);
  const kv = new MemoryKv();
  TestBed.configureTestingModule({
    providers: [
      { provide: PROJECT_STORAGE, useValue: storage },
      { provide: SYNC_KV, useValue: kv },
      { provide: SYNC_FETCH, useValue: server.fetch },
      { provide: SYNC_DEBOUNCE_MS, useValue: 0 },
    ],
  });
  return { store: TestBed.inject(ProjectStore), sync: TestBed.inject(SyncService), storage, kv };
}

const project = (id: string, name: string, updated = '2026-10-09T10:00:00.000Z'): Project => ({
  id,
  name,
  created: '2026-10-09T09:00:00.000Z',
  updated,
  items: [{ id: 'h1', kind: 'hoek', name: 'Hoek', notes: '', updated, a: '1', b: '1', c: '1,414' } as HoekItem],
});

const on = (server: FakeServer) => ({ enabled: true, serverUrl: 'https://api.example/', apiKey: server.key });

describe('SyncService', () => {
  let server: FakeServer;
  beforeEach(() => (server = new FakeServer()));

  it('turning sync on uploads local projects', async () => {
    const { sync } = device(server, [project('p1', 'Schuur')]);
    await sync.configure(on(server));
    expect(sync.status()).toBe('ok');
    expect(server.docs.get('p1')?.name).toBe('Schuur');
    expect(server.docs.get('p1')?.version).toBe(1);
    expect(sync.pending()).toBe(0);
    // The trailing slash in the URL is removed.
    expect(sync.settings().serverUrl).toBe('https://api.example');
  });

  it('a second device receives the projects, and edits travel back', async () => {
    const a = device(server, [project('p1', 'Schuur')]);
    await a.sync.configure(on(server));

    const b = device(server);
    await b.sync.configure(on(server));
    expect(b.store.projects().map((p) => p.name)).toEqual(['Schuur']);

    b.store.renameProject('p1', 'Schuur achter');
    await b.sync.syncNow();
    expect(server.docs.get('p1')?.name).toBe('Schuur achter');
    expect(server.docs.get('p1')?.version).toBe(2);
  });

  it('only fetches changes after the first sync (since cursor)', async () => {
    const { sync } = device(server, [project('p1', 'Schuur')]);
    await sync.configure(on(server));
    server.requests = [];
    await sync.syncNow();
    expect(server.requests[0]).toMatch(/^GET \/api\/projects\?since=\d+$/);
    expect(server.requests.length).toBe(1); // nothing to send
  });

  it('conflict: the most recently edited version wins', async () => {
    const { store, sync } = device(server, [project('p1', 'Schuur')]);
    await sync.configure(on(server));

    // Edited elsewhere later than here: remote wins.
    store.renameProject('p1', 'Hier gewijzigd');
    server.editElsewhere('p1', 'Daar gewijzigd', '2999-01-01T00:00:00.000Z');
    await sync.syncNow();
    expect(store.projects()[0].name).toBe('Daar gewijzigd');
    expect(sync.pending()).toBe(0);

    // Edited elsewhere earlier than here: ours wins and overwrites the server.
    server.editElsewhere('p1', 'Oud elders', '2000-01-01T00:00:00.000Z');
    store.renameProject('p1', 'Nieuw hier');
    await sync.syncNow();
    expect(server.docs.get('p1')?.name).toBe('Nieuw hier');
    expect(store.projects()[0].name).toBe('Nieuw hier');
  });

  it('deletions travel both ways', async () => {
    const a = device(server, [project('p1', 'Schuur'), project('p2', 'Garage')]);
    await a.sync.configure(on(server));
    a.store.deleteProject('p1');
    await a.sync.syncNow();
    expect(server.docs.get('p1')?.deleted).toBe(true);

    const b = device(server, [project('p2', 'Garage')]);
    await b.sync.configure(on(server));
    expect(b.store.projects().map((p) => p.id)).toEqual(['p2']);
    // Deleted on the server by another device: disappears here on the next sync.
    a.store.deleteProject('p2');
    await a.sync.syncNow();
    await b.sync.syncNow();
    expect(b.store.projects()).toEqual([]);
  });

  it('a project deleted here but edited elsewhere comes back', async () => {
    const { store, sync } = device(server, [project('p1', 'Schuur')]);
    await sync.configure(on(server));
    server.editElsewhere('p1', 'Elders aangepast', '2999-01-01T00:00:00.000Z');
    store.deleteProject('p1');
    await sync.syncNow();
    expect(store.projects().map((p) => p.name)).toEqual(['Elders aangepast']);
    expect(server.docs.get('p1')?.deleted).toBe(false);
  });

  it('offline: keeps changes and sends them when the server is back', async () => {
    const { store, sync } = device(server, [project('p1', 'Schuur')]);
    await sync.configure(on(server));
    server.online = false;
    store.renameProject('p1', 'Op de bouwplaats');
    await sync.syncNow();
    expect(sync.status()).toBe('offline');
    expect(sync.pending()).toBe(1);
    expect(sync.message()).toContain('niet bereikbaar');

    server.online = true;
    await sync.syncNow();
    expect(sync.status()).toBe('ok');
    expect(server.docs.get('p1')?.name).toBe('Op de bouwplaats');
  });

  it('wrong key: clear error, nothing lost', async () => {
    const { sync } = device(server, [project('p1', 'Schuur')]);
    await sync.configure({ ...on(server), apiKey: 'fout' });
    expect(sync.status()).toBe('fout');
    expect(sync.message()).toContain('API-sleutel');
    expect(sync.pending()).toBe(1);
  });

  it('testConnection reports reachability, key and project count', async () => {
    const { sync } = device(server);
    expect((await sync.testConnection('api.example', server.key)).ok).toBe(false);
    expect((await sync.testConnection('https://api.example', 'fout')).message).toContain('sleutel klopt niet');
    expect(await sync.testConnection('https://api.example', server.key)).toEqual({ ok: true, message: 'Verbinding in orde. Op de server staan 0 projecten.' });
    server.online = false;
    expect((await sync.testConnection('https://api.example', server.key)).message).toContain('niet bereikbaar');
  });

  it('changes are sent automatically after a local edit', async () => {
    const { store, sync } = device(server, [project('p1', 'Schuur')]);
    await sync.configure(on(server));
    store.renameProject('p1', 'Automatisch');
    await new Promise((r) => setTimeout(r, 20));
    await sync.syncNow();
    expect(server.docs.get('p1')?.name).toBe('Automatisch');
  });

  it('settings and bookkeeping survive a restart', async () => {
    const first = device(server, [project('p1', 'Schuur')]);
    await first.sync.configure(on(server));
    const kv = first.kv;
    const storage = first.storage;

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: PROJECT_STORAGE, useValue: storage },
        { provide: SYNC_KV, useValue: kv },
        { provide: SYNC_FETCH, useValue: server.fetch },
        { provide: SYNC_DEBOUNCE_MS, useValue: 0 },
      ],
    });
    const sync = TestBed.inject(SyncService);
    expect(sync.settings().enabled).toBe(true);
    server.requests = [];
    await sync.syncNow();
    expect(server.requests).toEqual([expect.stringMatching(/since=/)]);
  });
});

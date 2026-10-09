import { computed, DestroyRef, inject, Injectable, InjectionToken, signal } from '@angular/core';
import { Project } from '../model/models';
import { ProjectChange, ProjectStore } from '../model/project-store';

/**
 * Keeps the projects on this device in step with the Bouwplannen API.
 *
 * Offline first: every change is stored locally straight away (as before) and marked "to send".
 * When the server is reachable, the app first fetches what changed elsewhere, then sends its own
 * changes with the version it last saw (If-Match). If both sides changed the same project, the most
 * recently edited version wins, per project. Deletions travel as well.
 */

export interface SyncSettings {
  enabled: boolean;
  serverUrl: string;
  apiKey: string;
}

/** Per project: the server version this device last saw, and whether there are unsent changes. */
interface Meta {
  version: number;
  dirty: boolean;
  deleted?: boolean;
  /** Counts local edits, so an edit made while a request is under way is not lost. */
  rev: number;
}

interface SyncState {
  cursor: string | null;
  meta: Record<string, Meta>;
}

interface RemoteProject extends Project {
  version: number;
  deleted: boolean;
}

export type SyncStatus = 'uit' | 'bezig' | 'ok' | 'offline' | 'fout';

/** Small key/value store for settings and sync bookkeeping (localStorage in the app, memory in tests). */
export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export const SYNC_KV = new InjectionToken<KeyValueStore>('SyncKeyValue', {
  providedIn: 'root',
  factory: () => ({
    get: (k) => {
      try {
        return localStorage.getItem(k);
      } catch {
        return null;
      }
    },
    set: (k, v) => {
      try {
        localStorage.setItem(k, v);
      } catch {
        /* blocked storage: settings last for this session only */
      }
    },
  }),
});

export const SYNC_FETCH = new InjectionToken<typeof fetch>('SyncFetch', {
  providedIn: 'root',
  factory: () => (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init),
});

/** Delay before sending after a change, so typing a measurement does not send every keystroke. */
export const SYNC_DEBOUNCE_MS = new InjectionToken<number>('SyncDebounce', { providedIn: 'root', factory: () => 1500 });

const SETTINGS_KEY = 'bouwplannen.sync.settings.v1';
const STATE_KEY = 'bouwplannen.sync.state.v1';

class SyncError extends Error {
  constructor(
    message: string,
    readonly offline = false,
  ) {
    super(message);
  }
}

interface Response<T> {
  status: number;
  body: T | null;
}

@Injectable({ providedIn: 'root' })
export class SyncService {
  private readonly store = inject(ProjectStore);
  private readonly kv = inject(SYNC_KV);
  private readonly fetchFn = inject(SYNC_FETCH);
  private readonly debounceMs = inject(SYNC_DEBOUNCE_MS);

  readonly settings = signal<SyncSettings>(this.readJson(SETTINGS_KEY) ?? { enabled: false, serverUrl: '', apiKey: '' });
  private state: SyncState = this.readJson(STATE_KEY) ?? { cursor: null, meta: {} };
  readonly status = signal<SyncStatus>(this.settings().enabled ? 'ok' : 'uit');
  readonly message = signal<string | null>(null);
  readonly lastSync = signal<Date | null>(null);
  private readonly pendingCount = signal(this.countPending());
  readonly pending = computed(() => this.pendingCount());

  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private again = false;

  constructor() {
    this.store.onChange((c) => this.onLocalChange(c));
    if (typeof window !== 'undefined') {
      const online = () => this.schedule(0);
      window.addEventListener('online', online);
      const interval = setInterval(() => this.settings().enabled && this.schedule(0), 60_000);
      inject(DestroyRef).onDestroy(() => {
        window.removeEventListener('online', online);
        clearInterval(interval);
        if (this.timer) clearTimeout(this.timer);
      });
    }
    if (this.settings().enabled) this.schedule(0);
  }

  /** Save new settings. Turning sync on sends every local project that the server has not seen. */
  async configure(settings: SyncSettings): Promise<void> {
    const clean = { ...settings, serverUrl: settings.serverUrl.trim().replace(/\/+$/, ''), apiKey: settings.apiKey.trim() };
    const serverChanged = clean.serverUrl !== this.settings().serverUrl;
    this.settings.set(clean);
    this.kv.set(SETTINGS_KEY, JSON.stringify(clean));
    if (serverChanged) this.state = { cursor: null, meta: {} };
    if (!clean.enabled) {
      this.status.set('uit');
      this.message.set(null);
      this.saveState();
      return;
    }
    for (const p of this.store.projects()) {
      if (!this.state.meta[p.id]) this.state.meta[p.id] = { version: 0, dirty: true, rev: 1 };
    }
    this.saveState();
    await this.syncNow();
  }

  /** Check URL and key without changing anything. Returns a message for the user. */
  async testConnection(serverUrl: string, apiKey: string): Promise<{ ok: boolean; message: string }> {
    const base = serverUrl.trim().replace(/\/+$/, '');
    if (!/^https?:\/\//.test(base)) return { ok: false, message: 'Het adres moet beginnen met https:// (of http:// op je eigen netwerk).' };
    try {
      const health = await this.request<unknown>('GET', '/api/health', undefined, undefined, { serverUrl: base, apiKey });
      if (health.status !== 200) return { ok: false, message: `De server antwoordt, maar niet als Bouwplannen-API (status ${health.status}).` };
      const list = await this.request<{ projects: RemoteProject[] }>('GET', '/api/projects', undefined, undefined, { serverUrl: base, apiKey });
      if (list.status === 401) return { ok: false, message: 'De server is bereikbaar, maar de API-sleutel klopt niet.' };
      if (list.status !== 200) return { ok: false, message: `De server gaf een fout (status ${list.status}).` };
      const n = list.body?.projects.length ?? 0;
      return { ok: true, message: `Verbinding in orde. Op de server ${n === 1 ? 'staat 1 project' : `staan ${n} projecten`}.` };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  /** Run a full sync now (pull, then push). Calls during a running sync are merged into one extra run. */
  syncNow(): Promise<void> {
    if (!this.settings().enabled) return Promise.resolve();
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.again = false;
        this.status.set('bezig');
        try {
          await this.pull();
          await this.push();
          this.status.set('ok');
          this.message.set(null);
          this.lastSync.set(new Date());
        } catch (e) {
          const err = e instanceof SyncError ? e : new SyncError((e as Error).message);
          this.status.set(err.offline ? 'offline' : 'fout');
          this.message.set(err.message);
          this.again = false;
        }
      } while (this.again);
    })().finally(() => {
      this.running = null;
      this.pendingCount.set(this.countPending());
    });
    return this.running;
  }

  private schedule(delay: number): void {
    if (!this.settings().enabled) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.syncNow();
    }, delay);
  }

  private onLocalChange(change: ProjectChange): void {
    if (!this.settings().enabled) return;
    const m = this.state.meta[change.id];
    if (change.type === 'delete' && (!m || m.version === 0)) {
      delete this.state.meta[change.id]; // never reached the server: nothing to delete there
    } else {
      this.state.meta[change.id] = { version: m?.version ?? 0, dirty: true, deleted: change.type === 'delete', rev: (m?.rev ?? 0) + 1 };
    }
    this.saveState();
    this.schedule(this.debounceMs);
  }

  private async pull(): Promise<void> {
    const query = this.state.cursor ? `?since=${encodeURIComponent(this.state.cursor)}` : '';
    const res = await this.request<{ serverTime: string; projects: RemoteProject[] }>('GET', `/api/projects${query}`);
    this.expectOk(res);
    for (const remote of res.body!.projects) {
      const m = this.state.meta[remote.id];
      const local = this.store.projects().find((p) => p.id === remote.id);
      if (remote.deleted) {
        if (m?.dirty && !m.deleted && local) {
          m.version = remote.version; // edited here after it was deleted elsewhere: keep, send again
        } else {
          if (local) this.store.removeRemote(remote.id);
          delete this.state.meta[remote.id];
        }
        continue;
      }
      if (m?.deleted) {
        if (remote.version !== m.version) {
          // Deleted here, but edited on another device since: keep that edit.
          this.store.applyRemote(toProject(remote));
          this.state.meta[remote.id] = { version: remote.version, dirty: false, rev: m.rev };
        }
        continue; // otherwise the delete goes out in push()
      }
      if (!local || !m?.dirty) {
        if (!local || m?.version !== remote.version) this.store.applyRemote(toProject(remote));
        this.state.meta[remote.id] = { version: remote.version, dirty: false, rev: m?.rev ?? 0 };
      } else if (remote.updated >= local.updated) {
        // Both changed and the other device's edit is newer, or it is the very same edit.
        this.store.applyRemote(toProject(remote));
        this.state.meta[remote.id] = { version: remote.version, dirty: false, rev: m.rev };
      } else {
        m.version = remote.version; // ours is newer: overwrite on push
      }
    }
    this.state.cursor = res.body!.serverTime;
    this.saveState();
  }

  private async push(): Promise<void> {
    for (const [id, m] of Object.entries(this.state.meta)) {
      if (!m.dirty) continue;
      const rev = m.rev;
      if (m.deleted) {
        const res = await this.request<RemoteProject>('DELETE', `/api/projects/${encodeURIComponent(id)}`, undefined, m.version);
        if (res.status === 204 || res.status === 404) delete this.state.meta[id];
        else if (res.status === 409 && res.body) {
          // Edited on another device after we last synced: that edit wins over our delete.
          this.store.applyRemote(toProject(res.body));
          this.state.meta[id] = { version: res.body.version, dirty: false, rev };
        } else this.expectOk(res);
        this.saveState();
        continue;
      }
      const local = this.store.projects().find((p) => p.id === id);
      if (!local) {
        delete this.state.meta[id];
        continue;
      }
      let res = await this.put(local, m.version);
      if (res.status === 404) res = await this.put(local, null); // deleted elsewhere, but edited here: recreate
      if (res.status === 409 && res.body) {
        if (res.body.updated >= local.updated) {
          this.store.applyRemote(toProject(res.body));
          this.state.meta[id] = { version: res.body.version, dirty: false, rev };
          this.saveState();
          continue;
        }
        res = await this.put(local, res.body.version);
      }
      this.expectOk(res);
      const current = this.state.meta[id];
      // Still dirty when it was edited again while the request was under way.
      this.state.meta[id] = { version: res.body!.version, dirty: (current?.rev ?? rev) !== rev, rev: current?.rev ?? rev };
      this.saveState();
    }
  }

  private put(project: Project, version: number | null): Promise<Response<RemoteProject>> {
    const body = { id: project.id, name: project.name, created: project.created, updated: project.updated, items: project.items };
    return this.request<RemoteProject>('PUT', `/api/projects/${encodeURIComponent(project.id)}`, body, version);
  }

  private expectOk(res: Response<unknown>): void {
    if (res.status >= 200 && res.status < 300) return;
    if (res.status === 401) throw new SyncError('De server weigert de API-sleutel. Controleer hem bij Synchroniseren.');
    if (res.status === 400) throw new SyncError('De server keurde een project af (ongeldige gegevens).');
    throw new SyncError(`De server gaf een fout (status ${res.status}). Later wordt het opnieuw geprobeerd.`);
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    ifMatch?: number | null,
    override?: Pick<SyncSettings, 'serverUrl' | 'apiKey'>,
  ): Promise<Response<T>> {
    const { serverUrl, apiKey } = override ?? this.settings();
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (apiKey) headers['X-Api-Key'] = apiKey;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (ifMatch !== undefined && ifMatch !== null) headers['If-Match'] = `"${ifMatch}"`;
    let res: globalThis.Response;
    try {
      res = await this.fetchFn(serverUrl + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new SyncError('Server niet bereikbaar. Je wijzigingen blijven bewaard en gaan mee zodra er verbinding is.', true);
    }
    const text = await res.text();
    let parsed: T | null = null;
    try {
      parsed = text ? (JSON.parse(text) as T) : null;
    } catch {
      parsed = null;
    }
    return { status: res.status, body: parsed };
  }

  private countPending(): number {
    return Object.values(this.state.meta).filter((m) => m.dirty).length;
  }

  private saveState(): void {
    this.kv.set(STATE_KEY, JSON.stringify(this.state));
    this.pendingCount.set(this.countPending());
  }

  private readJson<T>(key: string): T | null {
    try {
      const raw = this.kv.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }
}

function toProject(r: RemoteProject): Project {
  return { id: r.id, name: r.name, created: r.created, updated: r.updated, items: r.items };
}

import { computed, DestroyRef, inject, Injectable, InjectionToken, signal } from '@angular/core';
import { ApiClient, ApiResponse, OfflineError } from '../api/api-client';
import { AuthService, Me } from '../api/auth.service';
import { SYNC_KV } from '../api/kv';
import { Project } from '../model/models';
import { ProjectChange, ProjectStore } from '../model/project-store';

export { SYNC_KV } from '../api/kv';
export type { KeyValueStore } from '../api/kv';

/**
 * Keeps the projects on this device in step with the server, for the logged-in user.
 *
 * Offline first: every change is stored locally straight away and marked "to send". When the
 * server is reachable, the app first fetches what changed in your groups, then sends its own
 * changes with the version it last saw (If-Match). If both sides changed the same project, the
 * most recently edited version wins. Deletions and moves to other groups travel as well.
 * A project is only sent once it is in one of your groups.
 */

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
  /** Groups the user could see at the last sync. */
  groupIds: string[];
}

interface RemoteProject extends Project {
  version: number;
  deleted: boolean;
}

interface ListResponse {
  serverTime: string;
  projects: RemoteProject[];
  groupIds: string[];
  removed: string[];
}

export type SyncStatus = 'uit' | 'bezig' | 'ok' | 'offline' | 'fout';

/** Why a project is not being sent. */
export type Blocked = 'geen-groep' | 'geen-toegang';

/** Delay before sending after a change, so typing a measurement does not send every keystroke. */
export const SYNC_DEBOUNCE_MS = new InjectionToken<number>('SyncDebounce', { providedIn: 'root', factory: () => 1500 });

const stateKey = (userId: string) => `bouwplannen.sync.${userId}.v2`;

class SyncError extends Error {}

@Injectable({ providedIn: 'root' })
export class SyncService {
  private readonly store = inject(ProjectStore);
  private readonly kv = inject(SYNC_KV);
  private readonly api = inject(ApiClient);
  private readonly auth = inject(AuthService);
  private readonly debounceMs = inject(SYNC_DEBOUNCE_MS);

  readonly status = signal<SyncStatus>('uit');
  readonly message = signal<string | null>(null);
  readonly lastSync = signal<Date | null>(null);
  /** Projects that cannot be sent, with the reason. */
  readonly blocked = signal<Record<string, Blocked>>({});
  private readonly pendingCount = signal(0);
  readonly pending = computed(() => this.pendingCount());

  private userId: string | null = null;
  private state: SyncState = { cursor: null, meta: {}, groupIds: [] };
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private again = false;

  constructor() {
    this.store.onChange((c) => this.onLocalChange(c));
    this.auth.onUserChange((me) => this.switchUser(me));
    if (this.auth.me()) this.switchUser(this.auth.me());
    if (typeof window !== 'undefined') {
      const online = () => this.schedule(0);
      window.addEventListener('online', online);
      const interval = setInterval(() => this.userId && this.schedule(0), 60_000);
      inject(DestroyRef).onDestroy(() => {
        window.removeEventListener('online', online);
        clearInterval(interval);
        if (this.timer) clearTimeout(this.timer);
      });
    }
  }

  /** Another user (or nobody) is logged in: load that user's bookkeeping and sync. */
  private switchUser(me: Me | null): void {
    if (this.timer) clearTimeout(this.timer);
    this.userId = me?.id ?? null;
    if (!me) {
      this.status.set('uit');
      this.message.set(null);
      this.blocked.set({});
      this.pendingCount.set(0);
      return;
    }
    this.state = this.readJson<SyncState>(stateKey(me.id)) ?? { cursor: null, meta: {}, groupIds: [] };
    // Projects made on this device before logging in: offer them to the server too.
    for (const p of this.store.projects()) {
      if (!this.state.meta[p.id]) this.state.meta[p.id] = { version: 0, dirty: true, rev: 1 };
    }
    this.saveState();
    this.schedule(0);
  }

  /** Log out; with wipe, also remove the projects from this device. */
  async logout(options: { everywhere?: boolean; wipe?: boolean } = {}): Promise<void> {
    const userId = this.userId;
    await this.auth.logout(options.everywhere);
    if (options.wipe) {
      this.store.clearLocal();
      if (userId) this.kv.set(stateKey(userId), '');
    }
  }

  /** Run a full sync now (pull, then push). Calls during a running sync are merged into one extra run. */
  syncNow(): Promise<void> {
    if (!this.userId) return Promise.resolve();
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
          this.again = false;
          if (e instanceof OfflineError) {
            this.status.set('offline');
            this.message.set(e.message);
          } else if (this.userId) {
            this.status.set('fout');
            this.message.set((e as Error).message);
          }
        }
      } while (this.again && this.userId);
    })().finally(() => {
      this.running = null;
      this.pendingCount.set(this.countPending());
    });
    return this.running;
  }

  private schedule(delay: number): void {
    if (!this.userId) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.syncNow();
    }, delay);
  }

  private onLocalChange(change: ProjectChange): void {
    if (!this.userId) return;
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
    const res = await this.api.get<ListResponse>(`/api/projects${query}`);
    this.expectOk(res);
    const body = res.body!;
    for (const remote of body.projects) this.applyRemote(remote);

    // Moved to a group you are not in: gone here too, unless you still have unsent changes.
    for (const id of body.removed ?? []) {
      if (!this.state.meta[id]?.dirty) {
        this.store.removeRemote(id);
        delete this.state.meta[id];
      }
    }
    // Groups you left or were removed from: their projects go, unless you changed them here.
    const groups = new Set(body.groupIds ?? []);
    for (const p of this.store.projects()) {
      const m = this.state.meta[p.id];
      if (p.groupId && !groups.has(p.groupId) && m && !m.dirty && m.version > 0) {
        this.store.removeRemote(p.id);
        delete this.state.meta[p.id];
      }
    }
    this.state.groupIds = [...groups];
    this.state.cursor = body.serverTime;
    this.saveState();
  }

  private applyRemote(remote: RemoteProject): void {
    const m = this.state.meta[remote.id];
    const local = this.store.projects().find((p) => p.id === remote.id);
    if (remote.deleted) {
      if (m?.dirty && !m.deleted && local) {
        m.version = remote.version; // edited here after it was deleted elsewhere: keep, send again
      } else {
        if (local) this.store.removeRemote(remote.id);
        delete this.state.meta[remote.id];
      }
      return;
    }
    if (m?.deleted) {
      if (remote.version !== m.version) {
        // Deleted here, but edited on another device since: keep that edit.
        this.store.applyRemote(toProject(remote));
        this.state.meta[remote.id] = { version: remote.version, dirty: false, rev: m.rev };
      }
      return; // otherwise the delete goes out in push()
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

  private async push(): Promise<void> {
    const blocked: Record<string, Blocked> = {};
    const groups = new Set(this.state.groupIds);
    for (const [id, m] of Object.entries(this.state.meta)) {
      if (!m.dirty || !this.userId) continue;
      const rev = m.rev;
      if (m.deleted) {
        const res = await this.api.request<RemoteProject>('DELETE', `/api/projects/${encodeURIComponent(id)}`, undefined, ifMatch(m.version));
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
      if (!local.groupId) {
        blocked[id] = 'geen-groep';
        continue;
      }
      if (!groups.has(local.groupId)) {
        blocked[id] = 'geen-toegang';
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
      if (res.status === 403 || res.status === 404) {
        blocked[id] = 'geen-toegang';
        continue;
      }
      this.expectOk(res);
      const current = this.state.meta[id];
      // Still dirty when it was edited again while the request was under way.
      this.state.meta[id] = { version: res.body!.version, dirty: (current?.rev ?? rev) !== rev, rev: current?.rev ?? rev };
      this.saveState();
    }
    this.blocked.set(blocked);
  }

  private put(project: Project, version: number | null): Promise<ApiResponse<RemoteProject>> {
    const body = { id: project.id, name: project.name, created: project.created, updated: project.updated, groupId: project.groupId, items: project.items };
    return this.api.request<RemoteProject>('PUT', `/api/projects/${encodeURIComponent(project.id)}`, body, ifMatch(version));
  }

  private expectOk(res: ApiResponse<unknown>): void {
    if (res.status >= 200 && res.status < 300) return;
    if (res.status === 401) {
      this.auth.sessionEnded();
      throw new SyncError('Je bent uitgelogd. Log opnieuw in om te synchroniseren; je wijzigingen blijven bewaard.');
    }
    if (res.status === 400) throw new SyncError('De server keurde een project af (ongeldige gegevens).');
    throw new SyncError(`De server gaf een fout (status ${res.status}). Later wordt het opnieuw geprobeerd.`);
  }

  private countPending(): number {
    return Object.values(this.state.meta).filter((m) => m.dirty).length;
  }

  private saveState(): void {
    if (this.userId) this.kv.set(stateKey(this.userId), JSON.stringify(this.state));
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

function ifMatch(version: number | null): Record<string, string> {
  return version === null ? {} : { 'If-Match': `"${version}"` };
}

function toProject(r: RemoteProject): Project {
  return { id: r.id, name: r.name, created: r.created, updated: r.updated, groupId: r.groupId, items: r.items };
}

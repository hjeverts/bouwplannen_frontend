import { computed, inject, Injectable, signal } from '@angular/core';
import { SYNC_KV } from './kv';
import { ApiClient, OfflineError, problemMessage } from './api-client';

export interface GroupSummary {
  id: string;
  name: string;
  personal: boolean;
  isOwner: boolean;
  memberCount: number;
}

export interface Me {
  id: string;
  username: string;
  displayName: string;
  isAdmin: boolean;
  personalGroupId: string;
  groups: GroupSummary[];
}

/**
 * - 'onbekend': still checking
 * - 'geen-server': no Bouwplannen server behind this address (e.g. the app opened as a file or preview)
 * - 'uitgelogd': server present, not logged in
 * - 'ingelogd': logged in (possibly offline, then with the last known details)
 */
export type AuthState = 'onbekend' | 'geen-server' | 'uitgelogd' | 'ingelogd';

const ME_KEY = 'bouwplannen.me.v1';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(ApiClient);
  private readonly kv = inject(SYNC_KV);

  readonly state = signal<AuthState>('onbekend');
  /** Last known user; kept on the device so groups show offline too. */
  readonly me = signal<Me | null>(this.readMe());
  readonly offline = signal(false);
  /** The user chose to continue without logging in (this session only). */
  readonly skipLogin = signal(false);
  readonly groups = computed(() => this.me()?.groups ?? []);
  readonly loggedIn = computed(() => this.state() === 'ingelogd');

  private listeners: ((me: Me | null) => void)[] = [];

  /** Called when the logged-in user changes (login, logout, other user). */
  onUserChange(listener: (me: Me | null) => void): void {
    this.listeners.push(listener);
  }

  /** Check the session with the server. Offline with a known user: stay logged in on the last details. */
  async check(): Promise<void> {
    try {
      const res = await this.api.get<Me>('/api/auth/me');
      this.offline.set(false);
      if (res.status === 200 && res.body?.id) this.setMe(res.body);
      else if (res.status === 401) this.setLoggedOut();
      else this.state.set('geen-server');
    } catch (e) {
      if (!(e instanceof OfflineError)) throw e;
      this.offline.set(true);
      this.state.set(this.me() ? 'ingelogd' : 'geen-server');
    }
  }

  async login(username: string, password: string): Promise<string | null> {
    try {
      const res = await this.api.request<Me>('POST', '/api/auth/login', { username: username.trim(), password });
      if (res.status === 200 && res.body) {
        this.offline.set(false);
        this.setMe(res.body);
        return null;
      }
      if (res.status === 404 || res.status === 405) return 'Op dit adres draait geen Bouwplannen-server.';
      return problemMessage(res, 'Inloggen mislukt.');
    } catch (e) {
      if (e instanceof OfflineError) return 'Server niet bereikbaar. Controleer je verbinding.';
      throw e;
    }
  }

  async logout(everywhere = false): Promise<void> {
    try {
      await this.api.request('POST', everywhere ? '/api/auth/logout-all' : '/api/auth/logout');
    } catch {
      /* offline: the cookie stays, but the app forgets the user; the next login replaces it */
    }
    this.setLoggedOut();
  }

  async changePassword(current: string, next: string): Promise<string | null> {
    const res = await this.api.request('POST', '/api/auth/password', { current, new: next });
    if (res.status === 204) {
      // A new password ends every session, this one included: log straight back in.
      const username = this.me()?.username ?? '';
      return (await this.login(username, next)) ?? null;
    }
    return problemMessage(res, 'Wachtwoord wijzigen mislukt.');
  }

  /** Reload the user and groups (after group changes). */
  async refresh(): Promise<void> {
    const res = await this.api.get<Me>('/api/auth/me');
    if (res.status === 200 && res.body) this.setMe(res.body);
    else if (res.status === 401) this.setLoggedOut();
  }

  /** The server said 401 during sync: the session ended (password changed, logged out elsewhere). */
  sessionEnded(): void {
    this.setLoggedOut();
  }

  groupName(id: string | undefined): string | null {
    if (!id) return null;
    return this.groups().find((g) => g.id === id)?.name ?? null;
  }

  private setMe(me: Me): void {
    const previous = this.me()?.id;
    this.me.set(me);
    this.state.set('ingelogd');
    this.kv.set(ME_KEY, JSON.stringify(me));
    if (previous !== me.id) for (const l of this.listeners) l(me);
  }

  private setLoggedOut(): void {
    const hadUser = this.me() !== null;
    this.me.set(null);
    this.state.set('uitgelogd');
    this.kv.set(ME_KEY, '');
    if (hadUser) for (const l of this.listeners) l(null);
  }

  private readMe(): Me | null {
    try {
      const raw = this.kv.get(ME_KEY);
      return raw ? (JSON.parse(raw) as Me) : null;
    } catch {
      return null;
    }
  }
}

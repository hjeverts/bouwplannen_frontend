import { inject, Injectable, signal } from '@angular/core';
import { ApiClient, OfflineError, problemMessage } from './api-client';
import { AuthService } from './auth.service';

export interface Member {
  id: string;
  username: string;
  displayName: string;
  owner: boolean;
}

export interface GroupDetail {
  id: string;
  name: string;
  personal: boolean;
  isOwner: boolean;
  members: Member[];
  projectCount: number;
}

/** Groups with their members. Every change returns null on success or a message for the user. */
@Injectable({ providedIn: 'root' })
export class GroupsService {
  private readonly api = inject(ApiClient);
  private readonly auth = inject(AuthService);

  readonly groups = signal<GroupDetail[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      const res = await this.api.get<GroupDetail[]>('/api/groups');
      if (res.status === 200 && res.body) {
        this.groups.set(res.body);
        this.error.set(null);
      } else if (res.status === 401) this.auth.sessionEnded();
      else this.error.set(problemMessage(res, 'Groepen laden mislukt.'));
    } catch (e) {
      this.error.set(e instanceof OfflineError ? 'Offline: groepen kunnen nu niet worden geladen.' : String(e));
    } finally {
      this.loading.set(false);
    }
  }

  create(name: string): Promise<string | null> {
    return this.change('POST', '/api/groups', { name }, 201);
  }

  rename(id: string, name: string): Promise<string | null> {
    return this.change('PUT', `/api/groups/${encodeURIComponent(id)}`, { name });
  }

  remove(id: string): Promise<string | null> {
    return this.change('DELETE', `/api/groups/${encodeURIComponent(id)}`, undefined, 204);
  }

  addMember(id: string, username: string, owner = false): Promise<string | null> {
    return this.change('POST', `/api/groups/${encodeURIComponent(id)}/members`, { username: username.trim(), owner });
  }

  removeMember(id: string, userId: string): Promise<string | null> {
    return this.change('DELETE', `/api/groups/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`, undefined, 204);
  }

  private async change(method: string, path: string, body: unknown, okStatus = 200): Promise<string | null> {
    try {
      const res = await this.api.request(method, path, body);
      if (res.status !== okStatus) {
        if (res.status === 401) this.auth.sessionEnded();
        return problemMessage(res, 'Dat lukte niet.');
      }
      await Promise.all([this.load(), this.auth.refresh()]);
      return null;
    } catch (e) {
      if (e instanceof OfflineError) return 'Offline: groepen wijzigen kan alleen met verbinding.';
      throw e;
    }
  }
}

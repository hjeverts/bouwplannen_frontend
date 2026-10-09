import { Component, effect, inject, signal } from '@angular/core';
import { AuthService } from '../api/auth.service';
import { GroupDetail, GroupsService } from '../api/groups.service';

/** Your groups: create, rename, members (owners only), leave, delete when empty. */
@Component({
  selector: 'app-groups-panel',
  template: `
    <details class="more" (toggle)="opened($event)">
      <summary>Groepen</summary>
      <p class="hint">
        Projecten in een groep ziet en bewerkt iedereen in die groep. Je privégroep is alleen voor jou.
      </p>
      <form class="create" (submit)="create($event)">
        <label class="field field--text field--grow" for="new-group">
          <span class="field-label">Nieuwe groep</span>
          <input id="new-group" type="text" placeholder="bijv. Verbouwing Dorpsstraat" [value]="newName()" (input)="newName.set($any($event.target).value)" />
        </label>
        <button type="submit" class="btn" [disabled]="!newName().trim()">Groep maken</button>
      </form>
      @if (message(); as m) {
        <p class="status status--error" role="alert">{{ m }}</p>
      }
      @if (groups.error(); as e) {
        <p class="status">{{ e }}</p>
      }
      <ul class="groups">
        @for (g of groups.groups(); track g.id) {
          <li class="group">
            <div class="group-head">
              <strong>{{ g.personal ? 'Privé' : g.name }}</strong>
              <span class="group-meta">
                {{ g.projectCount }} project{{ g.projectCount === 1 ? '' : 'en' }}
                @if (!g.personal) {
                  · {{ g.members.length }} lid{{ g.members.length === 1 ? '' : 'en' }}
                }
              </span>
            </div>
            @if (!g.personal) {
              <ul class="members">
                @for (m of g.members; track m.id) {
                  <li>
                    <span>{{ m.displayName }} <span class="muted">({{ m.username }})</span></span>
                    @if (m.owner) {
                      <span class="chip">beheerder</span>
                    }
                    @if (g.isOwner && m.id !== auth.me()?.id) {
                      <button type="button" class="link-btn" (click)="removeMember(g, m.id)">Verwijderen</button>
                      @if (!m.owner) {
                        <button type="button" class="link-btn" (click)="addMember(g, m.username, true)">Beheerder maken</button>
                      }
                    }
                  </li>
                }
              </ul>
              <div class="group-actions">
                @if (g.isOwner) {
                  <form class="inline-form" (submit)="addFromForm($event, g)">
                    <label class="field field--text" [for]="'add-' + g.id">
                      <span class="field-label">Lid toevoegen (gebruikersnaam)</span>
                      <input [id]="'add-' + g.id" type="text" autocapitalize="none" spellcheck="false" [value]="memberValue(g.id)" (input)="setMemberInput(g.id, $any($event.target).value)" />
                    </label>
                    <button type="submit" class="btn btn--quiet" [disabled]="!memberValue(g.id).trim()">Toevoegen</button>
                  </form>
                }
                <div class="group-buttons">
                  @if (g.isOwner) {
                    <button type="button" class="btn btn--quiet" (click)="rename(g)">Hernoemen</button>
                    @if (g.projectCount === 0) {
                      @if (confirmDelete() === g.id) {
                        <button type="button" class="btn btn--danger" (click)="remove(g)">Ja, groep verwijderen</button>
                        <button type="button" class="btn btn--quiet" (click)="confirmDelete.set(null)">Annuleren</button>
                      } @else {
                        <button type="button" class="btn btn--quiet" (click)="confirmDelete.set(g.id)">Verwijderen</button>
                      }
                    }
                  }
                  @if (!g.isOwner || g.members.length === 1) {
                    <button type="button" class="btn btn--quiet" (click)="leave(g)">Groep verlaten</button>
                  }
                </div>
                @if (renaming() === g.id) {
                  <form class="inline-form" (submit)="saveName($event, g)">
                    <label class="field field--text" [for]="'name-' + g.id">
                      <span class="field-label">Nieuwe naam</span>
                      <input [id]="'name-' + g.id" type="text" [value]="renameValue()" (input)="renameValue.set($any($event.target).value)" />
                    </label>
                    <button type="submit" class="btn btn--quiet" [disabled]="!renameValue().trim()">Opslaan</button>
                  </form>
                }
              </div>
            }
          </li>
        }
      </ul>
    </details>
  `,
})
export class GroupsPanel {
  protected readonly groups = inject(GroupsService);
  protected readonly auth = inject(AuthService);
  protected readonly newName = signal('');
  protected readonly message = signal<string | null>(null);
  protected readonly memberInput = signal<Record<string, string>>({});
  protected readonly confirmDelete = signal<string | null>(null);
  protected readonly renaming = signal<string | null>(null);
  protected readonly renameValue = signal('');
  private loaded = false;

  constructor() {
    // Reload when the user changes.
    effect(() => {
      if (this.auth.me()?.id && this.loaded) void this.groups.load();
    });
  }

  protected opened(event: Event): void {
    if ((event.target as HTMLDetailsElement).open && !this.loaded) {
      this.loaded = true;
      void this.groups.load();
    }
  }

  private async run(action: Promise<string | null>): Promise<boolean> {
    const problem = await action;
    this.message.set(problem);
    return !problem;
  }

  protected async create(event: Event): Promise<void> {
    event.preventDefault();
    if (await this.run(this.groups.create(this.newName().trim()))) this.newName.set('');
  }

  protected memberValue(groupId: string): string {
    return this.memberInput()[groupId] || '';
  }

  protected setMemberInput(groupId: string, value: string): void {
    this.memberInput.update((m) => ({ ...m, [groupId]: value }));
  }

  protected async addFromForm(event: Event, g: GroupDetail): Promise<void> {
    event.preventDefault();
    if (await this.addMember(g, this.memberValue(g.id), false)) this.setMemberInput(g.id, '');
  }

  protected addMember(g: GroupDetail, username: string, owner: boolean): Promise<boolean> {
    return this.run(this.groups.addMember(g.id, username, owner));
  }

  protected removeMember(g: GroupDetail, userId: string): Promise<boolean> {
    return this.run(this.groups.removeMember(g.id, userId));
  }

  protected leave(g: GroupDetail): Promise<boolean> {
    return this.run(this.groups.removeMember(g.id, this.auth.me()!.id));
  }

  protected rename(g: GroupDetail): void {
    this.renaming.set(this.renaming() === g.id ? null : g.id);
    this.renameValue.set(g.name);
  }

  protected async saveName(event: Event, g: GroupDetail): Promise<void> {
    event.preventDefault();
    if (await this.run(this.groups.rename(g.id, this.renameValue().trim()))) this.renaming.set(null);
  }

  protected async remove(g: GroupDetail): Promise<void> {
    await this.run(this.groups.remove(g.id));
    this.confirmDelete.set(null);
  }
}

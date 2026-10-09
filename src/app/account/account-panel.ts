import { Component, computed, inject, output, signal } from '@angular/core';
import { AuthService } from '../api/auth.service';
import { SyncService } from '../sync/sync.service';

/** Logged-in user: sync state, password, log out (here or everywhere). */
@Component({
  selector: 'app-account-panel',
  template: `
    <details class="more" [open]="sync.status() === 'fout'">
      <summary>Account en synchroniseren</summary>
      @switch (auth.state()) {
        @case ('ingelogd') {
          <p class="account-who">
            Ingelogd als <strong>{{ auth.me()?.displayName }}</strong> ({{ auth.me()?.username }})
            @if (auth.me()?.isAdmin) {
              <span class="chip">beheerder</span>
            }
          </p>
          <div class="sync-state">
            <span class="sync-dot sync-dot--{{ sync.status() }}" aria-hidden="true"></span>
            <span>{{ stateText() }}</span>
            <button type="button" class="btn btn--quiet" [disabled]="sync.status() === 'bezig'" (click)="sync.syncNow()">Nu synchroniseren</button>
          </div>

          <details class="more more--inner">
            <summary>Wachtwoord wijzigen</summary>
            <form class="pw-form" (submit)="changePassword($event)">
              <label class="field field--text" for="pw-current">
                <span class="field-label">Huidig wachtwoord</span>
                <input id="pw-current" type="password" autocomplete="current-password" [value]="current()" (input)="current.set($any($event.target).value)" />
              </label>
              <label class="field field--text" for="pw-new">
                <span class="field-label">Nieuw wachtwoord (minstens 10 tekens)</span>
                <input id="pw-new" type="password" autocomplete="new-password" [value]="next()" (input)="next.set($any($event.target).value)" />
              </label>
              <button type="submit" class="btn" [disabled]="!current() || next().length < 10">Wijzigen</button>
            </form>
            @if (pwMessage(); as m) {
              <p class="status" [class.status--error]="pwError()" role="status">{{ m }}</p>
            }
            <p class="hint">Na het wijzigen ben je op je andere apparaten uitgelogd.</p>
          </details>

          <div class="logout">
            @if (confirmLogout()) {
              <label class="check"><input type="checkbox" [checked]="wipe()" (change)="wipe.set(!wipe())" /> Projecten van dit apparaat wissen</label>
              <button type="button" class="btn btn--primary" (click)="logout(false)">Uitloggen</button>
              <button type="button" class="btn btn--quiet" (click)="confirmLogout.set(false)">Annuleren</button>
            } @else {
              <button type="button" class="btn btn--quiet" (click)="confirmLogout.set(true)">Uitloggen</button>
              <button type="button" class="btn btn--quiet" (click)="logout(true)">Overal uitloggen</button>
            }
          </div>
          @if (sync.pending() && confirmLogout()) {
            <p class="status status--error">Er {{ sync.pending() === 1 ? 'is 1 wijziging' : 'zijn ' + sync.pending() + ' wijzigingen' }} nog niet verstuurd. Wis je de projecten, dan gaan die verloren.</p>
          }
        }
        @case ('uitgelogd') {
          <p class="hint">Je bent niet ingelogd. Projecten blijven alleen op dit apparaat.</p>
          <button type="button" class="btn btn--primary" (click)="showLogin.emit()">Inloggen</button>
        }
        @default {
          <p class="hint">
            Deze app draait zonder Bouwplannen-server: alles blijft op dit apparaat. Wil je delen en op meerdere apparaten werken,
            open de app dan via je eigen server.
          </p>
        }
      }
    </details>
  `,
})
export class AccountPanel {
  protected readonly auth = inject(AuthService);
  protected readonly sync = inject(SyncService);
  readonly showLogin = output<void>();

  protected readonly current = signal('');
  protected readonly next = signal('');
  protected readonly pwMessage = signal<string | null>(null);
  protected readonly pwError = signal(false);
  protected readonly confirmLogout = signal(false);
  protected readonly wipe = signal(false);

  protected readonly stateText = computed(() => {
    const pending = this.sync.pending();
    const waiting = pending ? ` · ${pending} wijziging${pending === 1 ? '' : 'en'} wacht${pending === 1 ? '' : 'en'}` : '';
    if (this.auth.offline()) return 'Offline: wijzigingen gaan mee zodra er verbinding is' + waiting;
    switch (this.sync.status()) {
      case 'bezig':
        return 'Bezig met synchroniseren…';
      case 'offline':
      case 'fout':
        return (this.sync.message() ?? 'Synchroniseren mislukt.') + waiting;
      default: {
        const t = this.sync.lastSync();
        return (t ? `Gesynchroniseerd om ${t.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}` : 'Klaar') + waiting;
      }
    }
  });

  protected async changePassword(event: Event): Promise<void> {
    event.preventDefault();
    const problem = await this.auth.changePassword(this.current(), this.next());
    this.pwError.set(!!problem);
    this.pwMessage.set(problem ?? 'Wachtwoord gewijzigd.');
    if (!problem) {
      this.current.set('');
      this.next.set('');
    }
  }

  protected async logout(everywhere: boolean): Promise<void> {
    await this.sync.logout({ everywhere, wipe: !everywhere && this.wipe() });
    this.confirmLogout.set(false);
    this.wipe.set(false);
  }
}

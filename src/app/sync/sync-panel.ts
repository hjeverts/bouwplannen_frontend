import { Component, computed, inject, signal } from '@angular/core';
import { canDownload } from '../ui/transfer';
import { SyncService } from './sync.service';

/** Settings for the server connection, with a connection test and the current state. */
@Component({
  selector: 'app-sync-panel',
  template: `
    <details class="more" [open]="sync.settings().enabled || sync.status() === 'fout'">
      <summary>Synchroniseren met server</summary>
      <p class="hint">
        Met je eigen Bouwplannen-server staan projecten op al je apparaten. Alles blijft ook op dit apparaat bewaard, dus meten
        zonder bereik werkt gewoon; wijzigingen gaan mee zodra er weer verbinding is.
      </p>
      <form class="sync-form" (submit)="save($event)">
        <label class="field field--text" for="sync-url">
          <span class="field-label">Adres van de server</span>
          <input id="sync-url" type="url" inputmode="url" autocomplete="url" placeholder="https://bouwplannen.jouwdomein.nl" [value]="url()" (input)="url.set($any($event.target).value)" />
        </label>
        <label class="field field--text" for="sync-key">
          <span class="field-label">API-sleutel</span>
          <input id="sync-key" type="password" autocomplete="off" [value]="key()" (input)="key.set($any($event.target).value)" />
        </label>
        <div class="sync-actions">
          <button type="button" class="btn btn--quiet" [disabled]="!url().trim() || testing()" (click)="test()">
            {{ testing() ? 'Bezig…' : 'Verbinding testen' }}
          </button>
          @if (sync.settings().enabled) {
            <button type="submit" class="btn btn--primary">Opslaan</button>
            <button type="button" class="btn btn--quiet" (click)="turnOff()">Uitzetten</button>
          } @else {
            <button type="submit" class="btn btn--primary" [disabled]="!url().trim()">Synchroniseren aanzetten</button>
          }
        </div>
      </form>
      @if (testResult(); as r) {
        <p class="status" [class.status--error]="!r.ok" role="status">{{ r.message }}</p>
      }
      @if (sync.settings().enabled) {
        <div class="sync-state">
          <span class="sync-dot sync-dot--{{ sync.status() }}" aria-hidden="true"></span>
          <span>{{ stateText() }}</span>
          <button type="button" class="btn btn--quiet" [disabled]="sync.status() === 'bezig'" (click)="sync.syncNow()">Nu synchroniseren</button>
        </div>
      }
    </details>
  `,
})
export class SyncPanel {
  protected readonly sync = inject(SyncService);
  // Served by the deploy setup, the API sits on the same address (/api): suggest that.
  protected readonly url = signal(this.sync.settings().serverUrl || defaultServerUrl());
  protected readonly key = signal(this.sync.settings().apiKey);
  protected readonly testing = signal(false);
  protected readonly testResult = signal<{ ok: boolean; message: string } | null>(null);

  protected readonly stateText = computed(() => {
    const pending = this.sync.pending();
    const waiting = pending ? ` · ${pending} wijziging${pending === 1 ? '' : 'en'} wacht${pending === 1 ? '' : 'en'}` : '';
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

  protected async test(): Promise<void> {
    this.testing.set(true);
    this.testResult.set(await this.sync.testConnection(this.url(), this.key()));
    this.testing.set(false);
  }

  protected async save(event: Event): Promise<void> {
    event.preventDefault();
    this.testResult.set(null);
    await this.sync.configure({ enabled: true, serverUrl: this.url(), apiKey: this.key() });
  }

  protected async turnOff(): Promise<void> {
    this.testResult.set(null);
    await this.sync.configure({ ...this.sync.settings(), enabled: false });
  }
}

function defaultServerUrl(): string {
  try {
    return canDownload() && /^https?:$/.test(location.protocol) ? location.origin : '';
  } catch {
    return '';
  }
}

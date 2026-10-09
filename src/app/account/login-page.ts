import { Component, inject, output, signal } from '@angular/core';
import { AuthService } from '../api/auth.service';

/** Full-page login, shown when this address has a Bouwplannen server and nobody is logged in. */
@Component({
  selector: 'app-login-page',
  template: `
    <section class="login">
      <div class="login-card">
        <svg class="login-mark" viewBox="0 0 32 32" aria-hidden="true">
          <path d="M4 26 L16 6 L28 26 Z" />
          <path d="M10 26 V18 M22 26 V18" />
        </svg>
        <h1>Inloggen</h1>
        <p class="hint">Met je account zie je je eigen projecten en die van je groepen, op al je apparaten.</p>
        <form class="login-form" (submit)="submit($event)">
          <label class="field field--text" for="login-user">
            <span class="field-label">Gebruikersnaam</span>
            <input id="login-user" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" required [value]="username()" (input)="username.set($any($event.target).value)" />
          </label>
          <label class="field field--text" for="login-pass">
            <span class="field-label">Wachtwoord</span>
            <input id="login-pass" type="password" autocomplete="current-password" required [value]="password()" (input)="password.set($any($event.target).value)" />
          </label>
          @if (error(); as e) {
            <p class="status status--error" role="alert">{{ e }}</p>
          }
          <button type="submit" class="btn btn--primary" [disabled]="busy() || !username().trim() || !password()">
            {{ busy() ? 'Bezig…' : 'Inloggen' }}
          </button>
        </form>
        <button type="button" class="btn btn--quiet login-skip" (click)="skip.emit()">Verder zonder inloggen (alleen op dit apparaat)</button>
        <p class="hint login-help">Nog geen account? Vraag de beheerder van deze server er een aan te maken.</p>
      </div>
    </section>
  `,
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  readonly skip = output<void>();
  protected readonly username = signal('');
  protected readonly password = signal('');
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    this.busy.set(true);
    this.error.set(await this.auth.login(this.username(), this.password()));
    this.busy.set(false);
    if (!this.error()) this.password.set('');
  }
}

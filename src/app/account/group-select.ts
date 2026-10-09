import { Component, computed, inject, input, output } from '@angular/core';
import { AuthService } from '../api/auth.service';

let nextId = 0;

/** Choose the group a project belongs to. Only shown when logged in. */
@Component({
  selector: 'app-group-select',
  template: `
    <label class="field field--text" [for]="id">
      <span class="field-label">{{ label() }}</span>
      <select [id]="id" (change)="changed.emit($any($event.target).value)">
        @if (!value()) {
          <option value="" selected disabled>Kies een groep…</option>
        }
        @for (g of options(); track g.id) {
          <option [value]="g.id" [selected]="g.id === value()">{{ g.label }}</option>
        }
        @if (unknown()) {
          <option [value]="value()" selected disabled>Groep waar je geen lid meer van bent</option>
        }
      </select>
    </label>
  `,
})
export class GroupSelect {
  private readonly auth = inject(AuthService);
  readonly value = input<string | undefined>(undefined);
  readonly label = input('Groep');
  readonly changed = output<string>();
  protected readonly id = `group-select-${++nextId}`;

  protected readonly options = computed(() =>
    this.auth.groups().map((g) => ({ id: g.id, label: g.personal ? 'Privé (alleen jij)' : `${g.name} (${g.memberCount} ${g.memberCount === 1 ? 'lid' : 'leden'})` })),
  );
  protected readonly unknown = computed(() => !!this.value() && !this.auth.groups().some((g) => g.id === this.value()));
}

import { Component, computed, input, output } from '@angular/core';
import { formatLength } from '../geometry/units';
import { computeMaten } from '../model/compute';
import { MaatEntry, MatenItem } from '../model/models';
import { MeasureField } from '../ui/measure-field';

@Component({
  selector: 'app-maten-editor',
  imports: [MeasureField],
  template: `
    <p class="lead">Een lijst met losse maten, bijvoorbeeld balkafstanden, kozijnmaten of hoogtes. Geef elke maat een herkenbare naam.</p>
    <div class="maten">
      @for (e of item().entries; track $index; let i = $index) {
        <div class="maat-row">
          <label class="field field--text">
            <span class="field-label">Omschrijving</span>
            <input type="text" [value]="e.label" placeholder="bijv. balk A tot B" (input)="setEntry(i, 'label', $any($event.target).value)" />
          </label>
          <app-measure-field label="Maat" [value]="e.value" (valueChange)="setEntry(i, 'value', $event)" />
          <button type="button" class="icon-btn" (click)="remove(i)" [attr.aria-label]="'Maat ' + (i + 1) + ' verwijderen'">×</button>
        </div>
      }
    </div>
    <div class="maten-foot">
      <button type="button" class="btn" (click)="add()">+ Maat</button>
      @if (total(); as t) {
        <span class="maten-total">Opgeteld <strong>{{ t }}</strong></span>
      }
    </div>
    @if (error(); as err) {
      <p class="status status--error" role="status">{{ err }}</p>
    }
  `,
})
export class MatenEditor {
  readonly item = input.required<MatenItem>();
  readonly changed = output<MatenItem>();

  private readonly outcome = computed(() => computeMaten(this.item()));
  protected readonly error = computed(() => {
    const o = this.outcome();
    return o.status === 'error' ? o.message : null;
  });
  protected readonly total = computed(() => {
    const o = this.outcome();
    if (o.status !== 'ok') return null;
    const filled = o.value.values.filter((v) => v !== null).length;
    return filled > 1 ? formatLength(o.value.total) : null;
  });

  protected setEntry(i: number, field: keyof MaatEntry, value: string): void {
    const entries = this.item().entries.map((e, j) => (j === i ? { ...e, [field]: value } : e));
    this.changed.emit({ ...this.item(), entries });
  }

  protected add(): void {
    this.changed.emit({ ...this.item(), entries: [...this.item().entries, { label: '', value: '' }] });
  }

  protected remove(i: number): void {
    this.changed.emit({ ...this.item(), entries: this.item().entries.filter((_, j) => j !== i) });
  }
}

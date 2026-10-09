import { Component, computed, input, model } from '@angular/core';
import { formatLength, parseAngle, parseLength } from '../geometry/units';

let nextId = 0;

/**
 * Text field for a length or an angle. Accepts what you read off the meter ("3,456"),
 * and also "345 cm" / "3456 mm"; shows the value it understood underneath.
 */
@Component({
  selector: 'app-measure-field',
  template: `
    <label class="field" [class.field--bad]="invalid()" [attr.for]="fieldId">
      <span class="field-label">
        <span class="field-tag">{{ tag() }}</span>
        {{ label() }}
      </span>
      <span class="field-box">
        <input
          [id]="fieldId"
          type="text"
          inputmode="decimal"
          autocomplete="off"
          [placeholder]="placeholder()"
          [value]="value()"
          (input)="value.set($any($event.target).value)"
        />
        <span class="field-unit">{{ kind() === 'angle' ? '°' : 'm' }}</span>
      </span>
      <span class="field-note">{{ note() }}</span>
    </label>
  `,
})
export class MeasureField {
  readonly value = model('');
  readonly label = input('');
  /** Short code shown before the label, matching the drawing (a, b, 1, 2–3 …). */
  readonly tag = input('');
  readonly kind = input<'length' | 'angle'>('length');
  readonly placeholder = input('');
  readonly hint = input('');

  protected readonly fieldId = `mf-${++nextId}`;

  private readonly parsed = computed(() => (this.kind() === 'angle' ? parseAngle(this.value()) : parseLength(this.value())));
  protected readonly invalid = computed(() => Number.isNaN(this.parsed() as number));

  protected readonly note = computed(() => {
    const v = this.parsed();
    if (v === null) return this.hint();
    if (Number.isNaN(v)) return this.kind() === 'angle' ? 'Geen hoek' : 'Geen maat';
    const text = this.value().trim().toLowerCase();
    if (this.kind() === 'length' && /(mm|cm)$/.test(text)) return '= ' + formatLength(v);
    return this.hint();
  });
}

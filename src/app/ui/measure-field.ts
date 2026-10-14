import { Component, computed, input, model } from '@angular/core';
import { formatLength, lengthInput, lengthUnit, parseAngle, parseLength, unitOf } from '../geometry/units';

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
          [placeholder]="shownPlaceholder()"
          [value]="value()"
          (input)="value.set($any($event.target).value)"
        />
        <span class="field-unit">{{ kind() === 'angle' ? '°' : unit() }}</span>
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

  protected readonly unit = lengthUnit;

  /** Placeholders are given in metres ("0,100"); show them in the project's unit. */
  protected readonly shownPlaceholder = computed(() => {
    const ph = this.placeholder();
    if (this.kind() !== 'length' || !/^-?\d+(?:[.,]\d+)?$/.test(ph.trim())) return ph;
    return lengthInput(Number(ph.trim().replace(',', '.')), this.unit());
  });

  protected readonly fieldId = `mf-${++nextId}`;

  private readonly parsed = computed(() => (this.kind() === 'angle' ? parseAngle(this.value()) : parseLength(this.value())));
  protected readonly invalid = computed(() => Number.isNaN(this.parsed() as number));

  protected readonly note = computed(() => {
    const v = this.parsed();
    if (v === null) return this.hint();
    if (Number.isNaN(v)) return this.kind() === 'angle' ? 'Geen hoek' : 'Geen maat';
    const text = this.value().trim().toLowerCase();
    // Typed in another unit than the project's: show what it is in the project's unit.
    const typed = this.kind() === 'length' ? unitOf(text) : null;
    if (typed && typed !== this.unit()) return '= ' + formatLength(v);
    return this.hint();
  });
}

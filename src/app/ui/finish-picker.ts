import { Component, computed, input, output } from '@angular/core';
import { isHex, MaterialType, NamedColour } from '../geometry/finishes';
import { FinishEntry } from '../model/models';

let nextId = 0;

/**
 * Choice of a material and its colour: a list of materials, colour swatches and a free colour.
 * Without `types` it chooses a colour only (window frames).
 */
@Component({
  selector: 'app-finish-picker',
  template: `
    <div class="finish">
      @if (types().length) {
        <label class="field field--text">
          <span class="field-label">{{ label() }}</span>
          <select [id]="id + '-type'" [value]="value()?.type ?? ''" (change)="setType($any($event.target).value)">
            <option value="">{{ emptyLabel() }}</option>
            @for (t of types(); track t.id) {
              <option [value]="t.id" [selected]="t.id === value()?.type">{{ t.label }}</option>
            }
          </select>
        </label>
      } @else {
        <span class="field-label">{{ label() }}</span>
      }
      @if (showColours()) {
        <div class="swatches" role="radiogroup" [attr.aria-label]="(types().length ? 'Kleur ' : '') + label()">
          @if (!types().length) {
            <button type="button" class="swatch swatch--none" role="radio" [attr.aria-checked]="!current()" (click)="setColour('')" title="Standaard">
              <span class="sr-only">Standaard</span>
            </button>
          }
          @for (c of colours(); track c.hex) {
            <button
              type="button"
              class="swatch"
              role="radio"
              [style.background]="c.hex"
              [attr.aria-checked]="current() === c.hex"
              [attr.aria-label]="c.name"
              [title]="c.name"
              (click)="setColour(c.hex)"
            ></button>
          }
          <label class="swatch swatch--own" [class.swatch--on]="own()" [title]="'Eigen kleur'">
            <input type="color" [value]="current() || '#888888'" (input)="setColour($any($event.target).value)" aria-label="Eigen kleur" />
            <span aria-hidden="true">+</span>
          </label>
          <span class="swatch-name">{{ colourLabel() }}</span>
        </div>
      }
    </div>
  `,
})
export class FinishPicker {
  readonly label = input.required<string>();
  /** Materials to choose from; empty = colour only. */
  readonly types = input<MaterialType[]>([]);
  readonly colours = input.required<NamedColour[]>();
  readonly value = input<FinishEntry | null | undefined>(null);
  readonly emptyLabel = input('Standaard');
  readonly valueChange = output<FinishEntry>();

  protected readonly id = `finish-${nextId++}`;

  private readonly type = computed(() => this.types().find((t) => t.id === this.value()?.type) ?? null);
  protected readonly showColours = computed(() => !this.types().length || !!this.type());
  /** The colour shown as chosen: the stored one, otherwise the material's own. */
  protected readonly current = computed(() => {
    const c = this.value()?.colour;
    return isHex(c) ? c.toLowerCase() : (this.type()?.colour ?? '');
  });
  protected readonly own = computed(() => !!this.current() && !this.colours().some((c) => c.hex === this.current()));
  protected readonly colourLabel = computed(() => {
    const c = this.current();
    if (!c) return 'Standaard';
    return this.colours().find((x) => x.hex === c)?.name ?? c;
  });

  protected setType(type: string): void {
    // A new material starts with its own colour.
    this.valueChange.emit({ type, colour: '' });
  }

  protected setColour(colour: string): void {
    this.valueChange.emit({ type: this.value()?.type ?? '', colour });
  }
}

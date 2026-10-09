import { Component, computed, input, output } from '@angular/core';
import { centroid, Drawing, DrawingSpec } from '../drawing/drawing';
import { toRad } from '../geometry/geometry';
import { formatAngle, formatArea, formatLength } from '../geometry/units';
import { computeDriehoek } from '../model/compute';
import { DriehoekItem } from '../model/models';
import { MeasureField } from '../ui/measure-field';
import { ResultRow, Results } from '../ui/results';

type Field = 'a' | 'b' | 'c' | 'A' | 'B' | 'C';

@Component({
  selector: 'app-driehoek-editor',
  imports: [MeasureField, Results, Drawing],
  template: `
    <p class="lead">
      Vul drie waarden in, waarvan minstens één zijde. Zijde a ligt tegenover hoek A, enzovoort.
      Handig voor een spant, een schoor of een schuine gevelrand.
    </p>
    <div class="fields fields--3">
      <app-measure-field tag="a" label="Zijde a" [value]="item().a" (valueChange)="set('a', $event)" />
      <app-measure-field tag="b" label="Zijde b" [value]="item().b" (valueChange)="set('b', $event)" />
      <app-measure-field tag="c" label="Zijde c" [value]="item().c" (valueChange)="set('c', $event)" />
      <app-measure-field tag="A" label="Hoek A" kind="angle" [value]="item().A" (valueChange)="set('A', $event)" />
      <app-measure-field tag="B" label="Hoek B" kind="angle" [value]="item().B" (valueChange)="set('B', $event)" />
      <app-measure-field tag="C" label="Hoek C" kind="angle" [value]="item().C" (valueChange)="set('C', $event)" />
    </div>
    @if (solutions().length === 2) {
      <div class="segmented" role="radiogroup" aria-label="Oplossing">
        <span class="segmented-label">Met deze maten passen twee driehoeken:</span>
        @for (s of [0, 1]; track s) {
          <button type="button" role="radio" [attr.aria-checked]="index() === s" (click)="pick(s)">
            Hoek {{ otherAngleName() }} = {{ angleText(s) }}
          </button>
        }
      </div>
    }
    <div class="split">
      <app-results [rows]="rows()" [message]="message()" [state]="outcome().status" />
      <app-drawing [spec]="drawing()" ariaLabel="Schets van de driehoek" />
    </div>
  `,
})
export class DriehoekEditor {
  readonly item = input.required<DriehoekItem>();
  readonly changed = output<DriehoekItem>();

  protected readonly outcome = computed(() => computeDriehoek(this.item()));
  protected readonly solutions = computed(() => {
    const o = this.outcome();
    return o.status === 'ok' ? o.value : [];
  });
  protected readonly index = computed(() => Math.min(this.item().solution, Math.max(0, this.solutions().length - 1)));
  protected readonly triangle = computed(() => this.solutions()[this.index()] ?? null);
  protected readonly message = computed(() => {
    const o = this.outcome();
    return o.status === 'ok' ? null : o.message;
  });

  /** In the two-solution case, the angle that differs between them (the one not filled in). */
  protected readonly otherAngleName = computed(() => {
    const [s0, s1] = this.solutions();
    if (!s0 || !s1) return '';
    return (['A', 'B', 'C'] as const).find((k) => Math.abs(s0[k] - s1[k]) > 1e-6 && !this.item()[k]) ?? 'C';
  });

  protected angleText(i: number): string {
    const t = this.solutions()[i];
    const k = this.otherAngleName() as 'A' | 'B' | 'C';
    return t && k ? formatAngle(t[k], 1) : '';
  }

  protected readonly rows = computed<ResultRow[]>(() => {
    const t = this.triangle();
    if (!t) return [];
    return [
      { label: 'Zijde a', value: formatLength(t.a) },
      { label: 'Zijde b', value: formatLength(t.b) },
      { label: 'Zijde c', value: formatLength(t.c) },
      { label: 'Hoek A', value: formatAngle(t.A, 2) },
      { label: 'Hoek B', value: formatAngle(t.B, 2) },
      { label: 'Hoek C', value: formatAngle(t.C, 2) },
      { label: 'Hoogte op c', value: formatLength(t.hc) },
      { label: 'Oppervlakte', value: formatArea(t.area), main: true },
    ];
  });

  protected readonly drawing = computed<DrawingSpec | null>(() => {
    const t = this.triangle();
    if (!t) return null;
    const B = { x: 0, y: 0 };
    const C = { x: t.a, y: 0 };
    const A = { x: t.c * Math.cos(toRad(t.B)), y: t.c * Math.sin(toRad(t.B)) };
    const m = centroid([A, B, C]);
    return {
      fill: [A, B, C],
      segments: [
        { from: B, to: C, label: 'a', style: 'wall', awayFrom: m },
        { from: C, to: A, label: 'b', style: 'wall', awayFrom: m },
        { from: A, to: B, label: 'c', style: 'wall', awayFrom: m },
      ],
      marks: [
        { at: A, text: `A ${formatAngle(t.A, 1)}`, kind: 'angle', toward: m },
        { at: B, text: `B ${formatAngle(t.B, 1)}`, kind: 'angle', toward: m },
        { at: C, text: `C ${formatAngle(t.C, 1)}`, kind: 'angle', toward: m },
      ],
    };
  });

  protected set(field: Field, value: string): void {
    this.changed.emit({ ...this.item(), [field]: value });
  }

  protected pick(solution: number): void {
    this.changed.emit({ ...this.item(), solution });
  }
}

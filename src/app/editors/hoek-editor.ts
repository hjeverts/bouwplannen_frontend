import { Component, computed, input, output } from '@angular/core';
import { Drawing, DrawingSpec } from '../drawing/drawing';
import { toRad } from '../geometry/geometry';
import { formatAngle, formatLength, formatMm, parseLength } from '../geometry/units';
import { computeHoek } from '../model/compute';
import { HoekItem } from '../model/models';
import { MeasureField } from '../ui/measure-field';
import { ResultRow, Results } from '../ui/results';

@Component({
  selector: 'app-hoek-editor',
  imports: [MeasureField, Results, Drawing],
  template: `
    <p class="lead">
      Zet vanuit de hoek een streep op elke muur, meet beide afstanden tot de hoek en daarna de afstand tussen de twee strepen.
      Hoe verder van de hoek, hoe nauwkeuriger. Bij 3, 4 en 5 meter is de hoek precies haaks.
    </p>
    <div class="fields fields--3">
      <app-measure-field tag="a" label="Hoek tot streep op muur 1" [value]="item().a" (valueChange)="set('a', $event)" />
      <app-measure-field tag="b" label="Hoek tot streep op muur 2" [value]="item().b" (valueChange)="set('b', $event)" />
      <app-measure-field tag="c" label="Tussen de twee strepen" [value]="item().c" (valueChange)="set('c', $event)" />
    </div>
    <div class="split">
      <app-results [rows]="rows()" [message]="message()" [state]="outcome().status" />
      <app-drawing [spec]="drawing()" ariaLabel="Schets van de gemeten hoek" />
    </div>
  `,
})
export class HoekEditor {
  readonly item = input.required<HoekItem>();
  readonly changed = output<HoekItem>();

  protected readonly outcome = computed(() => computeHoek(this.item()));
  protected readonly message = computed(() => {
    const o = this.outcome();
    return o.status === 'ok' ? null : o.message;
  });

  protected readonly rows = computed<ResultRow[]>(() => {
    const o = this.outcome();
    if (o.status !== 'ok') return [];
    const r = o.value;
    const square = Math.abs(r.deviationFromSquare) < 0.05;
    return [
      { label: 'Hoek', value: formatAngle(r.angle, 2), main: true },
      {
        label: 'Afwijking van haaks',
        value: square ? 'Haaks' : `${r.deviationFromSquare > 0 ? '+' : '−'}${formatAngle(Math.abs(r.deviationFromSquare), 2)}`,
        tone: square ? 'ok' : 'warn',
      },
      { label: 'c bij precies 90°', value: formatLength(r.squareDiagonal) },
      { label: 'Uit het haaks over b', value: formatMm(Math.abs(r.offsetOverB)) },
    ];
  });

  protected readonly drawing = computed<DrawingSpec | null>(() => {
    const o = this.outcome();
    if (o.status !== 'ok') return null;
    const r = o.value;
    // Status 'ok' guarantees both lengths parse.
    const a = parseLength(this.item().a)!;
    const b = parseLength(this.item().b)!;
    const rad = toRad(r.angle);
    const O = { x: 0, y: 0 };
    const A = { x: a, y: 0 };
    const B = { x: b * Math.cos(rad), y: b * Math.sin(rad) };
    const ext = 1.35;
    const inside = { x: (A.x + B.x) / 4, y: (A.y + B.y) / 4 };
    return {
      segments: [
        { from: O, to: { x: A.x * ext, y: 0 }, style: 'wall' },
        { from: O, to: { x: B.x * ext, y: B.y * ext }, style: 'wall' },
        { from: O, to: A, label: 'a', style: 'mark', awayFrom: inside },
        { from: O, to: B, label: 'b', style: 'mark', awayFrom: inside },
        { from: A, to: B, label: 'c', style: 'dashed', awayFrom: O },
      ],
      marks: [{ at: O, text: formatAngle(r.angle, 1), kind: 'angle', toward: { x: A.x + B.x, y: A.y + B.y } }],
    };
  });

  protected set(field: 'a' | 'b' | 'c', value: string): void {
    this.changed.emit({ ...this.item(), [field]: value });
  }
}

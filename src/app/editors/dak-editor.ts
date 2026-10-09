import { Component, computed, input, output } from '@angular/core';
import { centroid, Drawing, DrawingSpec, Segment } from '../drawing/drawing';
import { formatAngle, formatArea, formatLength, formatPercent } from '../geometry/units';
import { computeDak } from '../model/compute';
import { DakItem } from '../model/models';
import { MeasureField } from '../ui/measure-field';
import { ResultRow, Results } from '../ui/results';

type Field = 'span' | 'rise' | 'pitch' | 'rafter' | 'ridgeOffset' | 'overhang' | 'length';

@Component({
  selector: 'app-dak-editor',
  imports: [MeasureField, Results, Drawing],
  template: `
    <div class="toolbar">
      <div class="segmented" role="radiogroup" aria-label="Daktype">
        <button type="button" role="radio" [attr.aria-checked]="item().roofType === 'zadeldak'" (click)="setType('zadeldak')">Zadeldak</button>
        <button type="button" role="radio" [attr.aria-checked]="item().roofType === 'lessenaarsdak'" (click)="setType('lessenaarsdak')">
          Lessenaarsdak
        </button>
      </div>
    </div>
    <p class="lead">
      Meet de overspanning van muur tot muur en vul daarna <strong>één</strong> van de drie in: nokhoogte, dakhelling of sparlengte.
      De andere twee rekent de app uit.
    </p>
    <div class="fields fields--4">
      <app-measure-field tag="S" label="Overspanning" [value]="item().span" (valueChange)="set('span', $event)" />
      @if (item().roofType === 'zadeldak') {
        <app-measure-field tag="N" label="Muur links tot nok" [value]="item().ridgeOffset" (valueChange)="set('ridgeOffset', $event)" hint="Leeg = in het midden" />
      }
    </div>
    <h3 class="group-title">Eén van deze drie</h3>
    <div class="fields fields--3">
      <app-measure-field tag="h" label="Nokhoogte boven muurplaat" [value]="item().rise" (valueChange)="set('rise', $event)" [placeholder]="computed('rise')" />
      <app-measure-field tag="α" label="Dakhelling" kind="angle" [value]="item().pitch" (valueChange)="set('pitch', $event)" [placeholder]="computed('pitch')" />
      <app-measure-field tag="L" label="Sparlengte tot nok" [value]="item().rafter" (valueChange)="set('rafter', $event)" [placeholder]="computed('rafter')" />
    </div>
    @if (tooMany()) {
      <p class="status status--error" role="status">Laat er twee van de drie leeg; de app rekent ze uit.</p>
    }
    <h3 class="group-title">Optioneel</h3>
    <div class="fields fields--3">
      <app-measure-field tag="o" label="Overstek (horizontaal)" [value]="item().overhang" (valueChange)="set('overhang', $event)" />
      <app-measure-field tag="D" label="Daklengte langs de nok" [value]="item().length" (valueChange)="set('length', $event)" hint="Voor het dakoppervlak" />
    </div>
    <div class="split">
      <app-results [rows]="rows()" [message]="tooMany() ? null : message()" [state]="outcome().status" />
      <app-drawing [spec]="drawing()" ariaLabel="Doorsnede van het dak" />
    </div>
  `,
})
export class DakEditor {
  readonly item = input.required<DakItem>();
  readonly changed = output<DakItem>();

  protected readonly outcome = computed(() => computeDak(this.item()));
  protected readonly message = computed(() => {
    const o = this.outcome();
    return o.status === 'ok' ? null : o.message;
  });
  protected readonly tooMany = computed(() => [this.item().rise, this.item().pitch, this.item().rafter].filter((v) => v.trim()).length > 1);

  /** Show the computed value as placeholder in the two empty fields. */
  protected computed(field: 'rise' | 'pitch' | 'rafter'): string {
    const o = this.outcome();
    if (o.status !== 'ok') return '';
    const r = o.value.roof;
    const v = field === 'rise' ? r.rise : field === 'pitch' ? r.left.pitch : r.left.rafter;
    return '≈ ' + (field === 'pitch' ? formatAngle(v, 2) : formatLength(v));
  }

  protected readonly rows = computed<ResultRow[]>(() => {
    const o = this.outcome();
    if (o.status !== 'ok') return [];
    const { roof, surfaceLeft, surfaceRight } = o.value;
    const both = roof.right !== null && Math.abs(roof.left.pitch - roof.right.pitch) > 1e-6;
    const rows: ResultRow[] = [
      { label: both ? 'Dakhelling links' : 'Dakhelling', value: `${formatAngle(roof.left.pitch, 2)}`, main: true },
      { label: 'Helling in procent', value: formatPercent(roof.left.pitchPercent) },
      { label: 'Nokhoogte', value: formatLength(roof.rise) },
      { label: both ? 'Spar links' : 'Sparlengte', value: formatLength(roof.left.rafter) },
      { label: both ? 'Spar links met overstek' : 'Spar met overstek', value: formatLength(roof.left.rafterWithOverhang) },
    ];
    if (both && roof.right) {
      rows.push(
        { label: 'Dakhelling rechts', value: formatAngle(roof.right.pitch, 2) },
        { label: 'Spar rechts', value: formatLength(roof.right.rafter) },
        { label: 'Spar rechts met overstek', value: formatLength(roof.right.rafterWithOverhang) },
      );
    }
    rows.push({ label: roof.type === 'zadeldak' ? 'Gevelvlak (driehoek)' : 'Gevelvlak boven muurplaat', value: formatArea(roof.gableArea) });
    if (surfaceLeft !== null) {
      const total = surfaceLeft + (surfaceRight ?? 0);
      rows.push({ label: 'Dakoppervlak totaal', value: formatArea(total) });
    }
    return rows;
  });

  protected readonly drawing = computed<DrawingSpec | null>(() => {
    const o = this.outcome();
    if (o.status !== 'ok') return null;
    const { roof } = o.value;
    const [p0, top, p2] = roof.outline;
    const m = centroid(roof.outline);
    const foot = { x: top.x, y: 0 };
    const segments: Segment[] = [
      { from: p0, to: p2, label: `S ${formatLength(roof.span, 2)}`, style: 'wall', awayFrom: m },
      { from: p0, to: top, label: formatLength(roof.left.rafter, 2), style: 'wall', awayFrom: m },
      { from: top, to: foot, label: `h ${formatLength(roof.rise, 2)}`, style: 'dashed', awayFrom: p0 },
    ];
    if (roof.right) segments.push({ from: top, to: p2, label: formatLength(roof.right.rafter, 2), style: 'wall', awayFrom: m });
    else segments.push({ from: top, to: p2, style: 'wall' });
    const overhang = roof.left.rafterWithOverhang - roof.left.rafter;
    if (overhang > 1e-9) {
      const ux = (p0.x - top.x) / roof.left.rafter;
      const uy = (p0.y - top.y) / roof.left.rafter;
      segments.push({ from: p0, to: { x: p0.x + ux * overhang, y: p0.y + uy * overhang }, style: 'mark' });
      if (roof.right) {
        const vx = (p2.x - top.x) / roof.right.rafter;
        const vy = (p2.y - top.y) / roof.right.rafter;
        const ov = roof.right.rafterWithOverhang - roof.right.rafter;
        segments.push({ from: p2, to: { x: p2.x + vx * ov, y: p2.y + vy * ov }, style: 'mark' });
      }
    }
    return {
      fill: roof.outline,
      segments,
      marks: [{ at: p0, text: formatAngle(roof.left.pitch, 1), kind: 'angle', toward: m }],
    };
  });

  protected set(field: Field, value: string): void {
    this.changed.emit({ ...this.item(), [field]: value });
  }

  protected setType(roofType: DakItem['roofType']): void {
    this.changed.emit({ ...this.item(), roofType });
  }
}

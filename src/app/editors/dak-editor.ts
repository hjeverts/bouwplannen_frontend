import { Component, computed, input, output } from '@angular/core';
import { centroid, Drawing, DrawingSpec, Segment } from '../drawing/drawing';
import { Point, RoofResult } from '../geometry/geometry';
import { formatAngle, formatArea, formatLength, formatPercent } from '../geometry/units';
import { computeDak } from '../model/compute';
import { DakItem } from '../model/models';
import { MeasureField } from '../ui/measure-field';
import { ResultRow, Results } from '../ui/results';

type Field = 'span' | 'rise' | 'pitch' | 'rafter' | 'ridgeOffset' | 'overhang' | 'length' | 'lowerRun' | 'lowerRise' | 'lowerPitch' | 'lowerRafter';
type Computed = 'rise' | 'pitch' | 'rafter' | 'lowerRun' | 'lowerRise' | 'lowerPitch' | 'lowerRafter';

@Component({
  selector: 'app-dak-editor',
  imports: [MeasureField, Results, Drawing],
  template: `
    <div class="toolbar">
      <div class="segmented" role="radiogroup" aria-label="Daktype">
        <button type="button" role="radio" [attr.aria-checked]="type() === 'zadeldak'" (click)="setType('zadeldak')">Zadeldak</button>
        <button type="button" role="radio" [attr.aria-checked]="type() === 'lessenaarsdak'" (click)="setType('lessenaarsdak')">Lessenaarsdak</button>
        <button type="button" role="radio" [attr.aria-checked]="type() === 'mansardekap'" (click)="setType('mansardekap')">Mansardekap</button>
      </div>
    </div>

    @if (type() === 'mansardekap') {
      <p class="lead">
        Een mansardekap heeft per kant een steil onderdak en een flauwer bovendak, met een knik ertussen.
        Vul voor het onderdak <strong>twee</strong> waarden in en voor het bovendak <strong>één</strong>. Beide kanten zijn gelijk.
      </p>
      <div class="fields fields--4">
        <app-measure-field tag="S" label="Overspanning" [value]="item().span" (valueChange)="set('span', $event)" />
      </div>
      <h3 class="group-title">Onderdak: twee van deze vier</h3>
      <div class="fields fields--4">
        <app-measure-field tag="i" label="Inzet knik" hint="Horizontaal vanaf de muur" [value]="item().lowerRun ?? ''" (valueChange)="set('lowerRun', $event)" [placeholder]="computed('lowerRun')" />
        <app-measure-field tag="k" label="Knikhoogte" hint="Boven de muurplaat" [value]="item().lowerRise ?? ''" (valueChange)="set('lowerRise', $event)" [placeholder]="computed('lowerRise')" />
        <app-measure-field tag="α" label="Helling onderdak" kind="angle" [value]="item().lowerPitch ?? ''" (valueChange)="set('lowerPitch', $event)" [placeholder]="computed('lowerPitch')" />
        <app-measure-field tag="L₁" label="Spar onderdak" [value]="item().lowerRafter ?? ''" (valueChange)="set('lowerRafter', $event)" [placeholder]="computed('lowerRafter')" />
      </div>
      @if (lowerTooMany()) {
        <p class="status status--error" role="status">Vul voor het onderdak precies twee waarden in; laat de andere twee leeg.</p>
      }
      <h3 class="group-title">Bovendak: één van deze drie</h3>
      <div class="fields fields--3">
        <app-measure-field tag="h" label="Nok boven de knik" [value]="item().rise" (valueChange)="set('rise', $event)" [placeholder]="computed('rise')" />
        <app-measure-field tag="β" label="Helling bovendak" kind="angle" [value]="item().pitch" (valueChange)="set('pitch', $event)" [placeholder]="computed('pitch')" />
        <app-measure-field tag="L₂" label="Spar bovendak" [value]="item().rafter" (valueChange)="set('rafter', $event)" [placeholder]="computed('rafter')" />
      </div>
    } @else {
      <p class="lead">
        Meet de overspanning van muur tot muur en vul daarna <strong>één</strong> van de drie in: nokhoogte, dakhelling of sparlengte.
        De andere twee rekent de app uit.
      </p>
      <div class="fields fields--4">
        <app-measure-field tag="S" label="Overspanning" [value]="item().span" (valueChange)="set('span', $event)" />
        @if (type() === 'zadeldak') {
          <app-measure-field tag="N" label="Muur links tot nok" [value]="item().ridgeOffset" (valueChange)="set('ridgeOffset', $event)" hint="Leeg = in het midden" />
        }
      </div>
      <h3 class="group-title">Eén van deze drie</h3>
      <div class="fields fields--3">
        <app-measure-field tag="h" label="Nokhoogte boven muurplaat" [value]="item().rise" (valueChange)="set('rise', $event)" [placeholder]="computed('rise')" />
        <app-measure-field tag="α" label="Dakhelling" kind="angle" [value]="item().pitch" (valueChange)="set('pitch', $event)" [placeholder]="computed('pitch')" />
        <app-measure-field tag="L" label="Sparlengte tot nok" [value]="item().rafter" (valueChange)="set('rafter', $event)" [placeholder]="computed('rafter')" />
      </div>
    }
    @if (upperTooMany()) {
      <p class="status status--error" role="status">Laat er twee van de drie leeg; de app rekent ze uit.</p>
    }

    <h3 class="group-title">Optioneel</h3>
    <div class="fields fields--3">
      <app-measure-field tag="o" label="Overstek (horizontaal)" [value]="item().overhang" (valueChange)="set('overhang', $event)" />
      <app-measure-field tag="D" label="Daklengte langs de nok" [value]="item().length" (valueChange)="set('length', $event)" hint="Voor het dakoppervlak" />
    </div>
    <div class="split">
      <app-results [rows]="rows()" [message]="upperTooMany() || lowerTooMany() ? null : message()" [state]="outcome().status" />
      <app-drawing [spec]="drawing()" ariaLabel="Doorsnede van het dak" />
    </div>
  `,
})
export class DakEditor {
  readonly item = input.required<DakItem>();
  readonly changed = output<DakItem>();

  protected readonly type = computed(() => this.item().roofType);
  protected readonly outcome = computed(() => computeDak(this.item()));
  private readonly roof = computed<RoofResult | null>(() => {
    const o = this.outcome();
    return o.status === 'ok' ? o.value.roof : null;
  });
  protected readonly message = computed(() => {
    const o = this.outcome();
    return o.status === 'ok' ? null : o.message;
  });
  protected readonly upperTooMany = computed(() => [this.item().rise, this.item().pitch, this.item().rafter].filter((v) => v.trim()).length > 1);
  protected readonly lowerTooMany = computed(
    () =>
      this.type() === 'mansardekap' &&
      [this.item().lowerRun, this.item().lowerRise, this.item().lowerPitch, this.item().lowerRafter].filter((v) => v?.trim()).length > 2,
  );

  /** Show the computed value as placeholder in the fields that were left empty. */
  protected computed(field: Computed): string {
    const r = this.roof();
    if (!r) return '';
    const upperOrMain = r.upper ?? r.left;
    const values: Record<Computed, [number, boolean]> = {
      rise: [r.knee ? r.rise - r.knee.y : r.rise, false],
      pitch: [upperOrMain.pitch, true],
      rafter: [upperOrMain.rafter, false],
      lowerRun: [r.left.run, false],
      lowerRise: [r.knee?.y ?? 0, false],
      lowerPitch: [r.left.pitch, true],
      lowerRafter: [r.left.rafter, false],
    };
    const [v, isAngle] = values[field];
    return '≈ ' + (isAngle ? formatAngle(v, 2) : formatLength(v));
  }

  protected readonly rows = computed<ResultRow[]>(() => {
    const o = this.outcome();
    if (o.status !== 'ok') return [];
    const { roof, surfaceLeft, surfaceRight } = o.value;
    const surface: ResultRow[] = surfaceLeft !== null ? [{ label: 'Dakoppervlak totaal', value: formatArea(surfaceLeft + (surfaceRight ?? 0)) }] : [];

    if (roof.upper && roof.knee) {
      return [
        { label: 'Nokhoogte', value: formatLength(roof.rise), main: true },
        { label: 'Knikhoogte', value: formatLength(roof.knee.y) },
        { label: 'Breedte op kniklijn', value: formatLength(roof.span - 2 * roof.knee.x) },
        { label: 'Helling onderdak', value: `${formatAngle(roof.left.pitch, 2)} · ${formatPercent(roof.left.pitchPercent)}` },
        { label: 'Spar onderdak', value: formatLength(roof.left.rafter) },
        { label: 'Spar onderdak met overstek', value: formatLength(roof.left.rafterWithOverhang) },
        { label: 'Helling bovendak', value: `${formatAngle(roof.upper.pitch, 2)} · ${formatPercent(roof.upper.pitchPercent)}` },
        { label: 'Spar bovendak', value: formatLength(roof.upper.rafter) },
        { label: 'Knikhoek', value: formatAngle(180 - roof.left.pitch + roof.upper.pitch, 2) },
        { label: 'Gevelvlak', value: formatArea(roof.gableArea) },
        ...surface,
      ];
    }

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
    rows.push({ label: roof.type === 'zadeldak' ? 'Gevelvlak (driehoek)' : 'Gevelvlak boven muurplaat', value: formatArea(roof.gableArea) }, ...surface);
    return rows;
  });

  protected readonly drawing = computed<DrawingSpec | null>(() => {
    const roof = this.roof();
    if (!roof) return null;
    const pts = roof.outline;
    const m = centroid(pts);
    const first = pts[0];
    const last = pts[pts.length - 1];
    const top = roof.upper ? pts[2] : pts[1];
    const segments: Segment[] = [
      { from: first, to: last, label: `S ${formatLength(roof.span, 2)}`, style: 'wall', awayFrom: m },
      { from: top, to: { x: top.x, y: 0 }, label: `h ${formatLength(roof.rise, 2)}`, style: 'dashed', awayFrom: first },
    ];
    // Roof edges with their lengths.
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      segments.push({ from: a, to: b, label: formatLength(length, 2), style: 'wall', awayFrom: m });
    }
    if (roof.type === 'lessenaarsdak') segments.pop(); // the vertical wall needs no length label twice
    if (roof.knee && roof.upper) {
      // Knee line across the attic: the usable width at knee height.
      // Two halves, labelled on the left one only, so the label stays clear of the height line in the middle.
      const k2 = pts[3];
      const mid = { x: (roof.knee.x + k2.x) / 2, y: roof.knee.y };
      segments.push(
        { from: roof.knee, to: mid, label: formatLength(k2.x - roof.knee.x, 2), style: 'dashed', awayFrom: { x: mid.x, y: 0 } },
        { from: mid, to: k2, style: 'dashed' },
      );
    }
    segments.push(...overhangs(roof));
    const marks = [{ at: first, text: formatAngle(roof.left.pitch, 1), kind: 'angle' as const, toward: m }];
    if (roof.knee && roof.upper) {
      // Upper pitch, measured against the horizontal knee line: place it just above that line.
      const above = { x: (roof.knee.x + top.x) / 2, y: roof.knee.y + (top.y - roof.knee.y) * 0.25 };
      marks.push({ at: roof.knee, text: formatAngle(roof.upper.pitch, 1), kind: 'angle', toward: above });
    }
    return { fill: pts, segments, marks };
  });

  protected set(field: Field, value: string): void {
    this.changed.emit({ ...this.item(), [field]: value });
  }

  protected setType(roofType: DakItem['roofType']): void {
    this.changed.emit({ ...this.item(), roofType });
  }
}

/** Short extensions past the wall plate, along the lowest slope, to show the overhang. */
function overhangs(roof: RoofResult): Segment[] {
  const extra = roof.left.rafterWithOverhang - roof.left.rafter;
  if (extra <= 1e-9) return [];
  const pts = roof.outline;
  const ext = (foot: Point, from: Point, len: number): Segment => {
    const d = Math.hypot(foot.x - from.x, foot.y - from.y);
    return { from: foot, to: { x: foot.x + ((foot.x - from.x) / d) * len, y: foot.y + ((foot.y - from.y) / d) * len }, style: 'mark' };
  };
  const out = [ext(pts[0], pts[1], extra)];
  if (roof.right && roof.type !== 'lessenaarsdak') {
    const n = pts.length;
    out.push(ext(pts[n - 1], pts[n - 2], roof.right.rafterWithOverhang - roof.right.rafter));
  }
  return out;
}

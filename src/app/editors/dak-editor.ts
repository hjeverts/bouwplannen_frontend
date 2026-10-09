import { Component, computed, input, output } from '@angular/core';
import { centroid, Drawing, DrawingSpec, Mark, Segment } from '../drawing/drawing';
import { Point, RoofResult } from '../geometry/geometry';
import { formatAngle, formatArea, formatLength, formatPercent } from '../geometry/units';
import { computeDak } from '../model/compute';
import { DakItem } from '../model/models';
import { MeasureField } from '../ui/measure-field';
import { ResultRow, Results } from '../ui/results';

type Field =
  | 'span'
  | 'rise'
  | 'pitch'
  | 'rafter'
  | 'pitchRight'
  | 'rafterRight'
  | 'ridgeOffset'
  | 'wallLeft'
  | 'wallRight'
  | 'overhang'
  | 'gableOverhang'
  | 'length'
  | 'lowerRun'
  | 'lowerRise'
  | 'lowerPitch'
  | 'lowerRafter';

const GABLE_VALUES: Field[] = ['pitch', 'pitchRight', 'rafter', 'rafterRight', 'ridgeOffset', 'rise'];

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

    @switch (type()) {
      @case ('zadeldak') {
        <p class="lead">
          Vul de overspanning in en <strong>twee</strong> van de zes waarden hieronder, bijvoorbeeld de dakhelling links en rechts.
          Zijn de muren even hoog en vul je er maar één in, dan ligt de nok in het midden.
        </p>
        <div class="fields fields--3">
          <app-measure-field tag="S" label="Overspanning" [value]="item().span" (valueChange)="set('span', $event)" />
          <app-measure-field tag="m₁" label="Muurhoogte links" [value]="v('wallLeft')" (valueChange)="set('wallLeft', $event)" hint="Vanaf de vloer, optioneel" />
          <app-measure-field tag="m₂" label="Muurhoogte rechts" [value]="v('wallRight')" (valueChange)="set('wallRight', $event)" hint="Leeg = gelijk aan links" />
        </div>
        <h3 class="group-title">Twee van deze zes</h3>
        <div class="fields fields--3">
          <app-measure-field tag="α₁" label="Dakhelling links" kind="angle" [value]="v('pitch')" (valueChange)="set('pitch', $event)" [placeholder]="computed('pitch')" />
          <app-measure-field tag="α₂" label="Dakhelling rechts" kind="angle" [value]="v('pitchRight')" (valueChange)="set('pitchRight', $event)" [placeholder]="computed('pitchRight')" />
          <app-measure-field tag="N" label="Muur links tot nok" [value]="v('ridgeOffset')" (valueChange)="set('ridgeOffset', $event)" [placeholder]="computed('ridgeOffset')" />
          <app-measure-field tag="L₁" label="Spar links" [value]="v('rafter')" (valueChange)="set('rafter', $event)" [placeholder]="computed('rafter')" />
          <app-measure-field tag="L₂" label="Spar rechts" [value]="v('rafterRight')" (valueChange)="set('rafterRight', $event)" [placeholder]="computed('rafterRight')" />
          <app-measure-field
            tag="h"
            [label]="walls() ? 'Nokhoogte vanaf vloer' : 'Nokhoogte boven muurplaat'"
            [value]="v('rise')"
            (valueChange)="set('rise', $event)"
            [placeholder]="computed('rise')"
          />
        </div>
        @if (gableCount() > 2) {
          <p class="status status--error" role="status">Vul precies twee van de zes in en laat de rest leeg; de app rekent ze uit.</p>
        }
      }
      @case ('lessenaarsdak') {
        <p class="lead">
          Vul de overspanning in. Weet je de hoogte van beide muren, dan volgt de helling daaruit. Anders vul je één van de drie
          waarden hieronder in.
        </p>
        <div class="fields fields--3">
          <app-measure-field tag="S" label="Overspanning" [value]="item().span" (valueChange)="set('span', $event)" />
          <app-measure-field tag="m₁" label="Muurhoogte links" [value]="v('wallLeft')" (valueChange)="set('wallLeft', $event)" hint="Vanaf de vloer, optioneel" />
          <app-measure-field tag="m₂" label="Muurhoogte rechts" [value]="v('wallRight')" (valueChange)="set('wallRight', $event)" />
        </div>
        @if (!wallsDiffer()) {
          <h3 class="group-title">Eén van deze drie</h3>
          <div class="fields fields--3">
            <app-measure-field tag="h" label="Hoogteverschil" [value]="v('rise')" (valueChange)="set('rise', $event)" [placeholder]="computed('rise')" />
            <app-measure-field tag="α" label="Dakhelling" kind="angle" [value]="v('pitch')" (valueChange)="set('pitch', $event)" [placeholder]="computed('pitch')" />
            <app-measure-field tag="L" label="Sparlengte" [value]="v('rafter')" (valueChange)="set('rafter', $event)" [placeholder]="computed('rafter')" />
          </div>
        }
      }
      @case ('mansardekap') {
        <p class="lead">
          Een mansardekap heeft per kant een steil onderdak en een flauwer bovendak, met een knik ertussen.
          Vul voor het onderdak <strong>twee</strong> waarden in en voor het bovendak <strong>één</strong>. Beide kanten zijn gelijk.
        </p>
        <div class="fields fields--4">
          <app-measure-field tag="S" label="Overspanning" [value]="item().span" (valueChange)="set('span', $event)" />
        </div>
        <h3 class="group-title">Onderdak: twee van deze vier</h3>
        <div class="fields fields--4">
          <app-measure-field tag="i" label="Inzet knik" hint="Horizontaal vanaf de muur" [value]="v('lowerRun')" (valueChange)="set('lowerRun', $event)" [placeholder]="computed('lowerRun')" />
          <app-measure-field tag="k" label="Knikhoogte" hint="Boven de muurplaat" [value]="v('lowerRise')" (valueChange)="set('lowerRise', $event)" [placeholder]="computed('lowerRise')" />
          <app-measure-field tag="α" label="Helling onderdak" kind="angle" [value]="v('lowerPitch')" (valueChange)="set('lowerPitch', $event)" [placeholder]="computed('lowerPitch')" />
          <app-measure-field tag="L₁" label="Spar onderdak" [value]="v('lowerRafter')" (valueChange)="set('lowerRafter', $event)" [placeholder]="computed('lowerRafter')" />
        </div>
        @if (lowerCount() > 2) {
          <p class="status status--error" role="status">Vul voor het onderdak precies twee waarden in; laat de andere twee leeg.</p>
        }
        <h3 class="group-title">Bovendak: één van deze drie</h3>
        <div class="fields fields--3">
          <app-measure-field tag="h" label="Nok boven de knik" [value]="v('rise')" (valueChange)="set('rise', $event)" [placeholder]="computed('rise')" />
          <app-measure-field tag="β" label="Helling bovendak" kind="angle" [value]="v('pitch')" (valueChange)="set('pitch', $event)" [placeholder]="computed('pitch')" />
          <app-measure-field tag="L₂" label="Spar bovendak" [value]="v('rafter')" (valueChange)="set('rafter', $event)" [placeholder]="computed('rafter')" />
        </div>
        @if (upperCount() > 1) {
          <p class="status status--error" role="status">Vul voor het bovendak één waarde in; laat de andere twee leeg.</p>
        }
      }
    }

    <h3 class="group-title">Overstek en lengte</h3>
    <div class="fields fields--3">
      <app-measure-field tag="o" label="Overstek goot" [value]="item().overhang" (valueChange)="set('overhang', $event)" hint="Horizontaal, maakt de spar langer" />
      <app-measure-field tag="o₂" label="Overstek kopgevels" [value]="v('gableOverhang')" (valueChange)="set('gableOverhang', $event)" hint="Per gevel, maakt gordingen langer" />
      <app-measure-field tag="D" label="Daklengte" [value]="item().length" (valueChange)="set('length', $event)" hint="Gevel tot gevel, zonder overstek" />
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

  private filled(fields: Field[]): number {
    return fields.filter((f) => this.v(f).trim()).length;
  }
  protected readonly walls = computed(() => !!(this.v('wallLeft').trim() || this.v('wallRight').trim()));
  protected readonly wallsDiffer = computed(() => {
    const l = this.v('wallLeft').trim();
    const r = this.v('wallRight').trim();
    return !!l && !!r && l !== r;
  });
  protected readonly gableCount = computed(() => this.filled(GABLE_VALUES));
  protected readonly lowerCount = computed(() => this.filled(['lowerRun', 'lowerRise', 'lowerPitch', 'lowerRafter']));
  protected readonly upperCount = computed(() => this.filled(['rise', 'pitch', 'rafter']));
  protected readonly tooMany = computed(() => {
    switch (this.type()) {
      case 'zadeldak':
        return this.gableCount() > 2;
      case 'mansardekap':
        return this.lowerCount() > 2 || this.upperCount() > 1;
      default:
        return false;
    }
  });

  /** Current text of a field; fields missing on older saved items read as empty. */
  protected v(field: Field): string {
    return (this.item()[field] as string | undefined) ?? '';
  }

  /** Computed value as placeholder in fields left empty, so you see what the app derived. */
  protected computed(field: Field): string {
    const r = this.roof();
    if (!r) return '';
    const len = (m: number | undefined) => (m === undefined ? '' : '≈ ' + formatLength(m));
    const ang = (d: number | undefined) => (d === undefined ? '' : '≈ ' + formatAngle(d, 2));
    if (r.type === 'mansardekap') {
      switch (field) {
        case 'lowerRun':
          return len(r.left.run);
        case 'lowerRise':
          return len(r.left.rise);
        case 'lowerPitch':
          return ang(r.left.pitch);
        case 'lowerRafter':
          return len(r.left.rafter);
        case 'rise':
          return len(r.upper?.rise);
        case 'pitch':
          return ang(r.upper?.pitch);
        case 'rafter':
          return len(r.upper?.rafter);
        default:
          return '';
      }
    }
    switch (field) {
      case 'pitch':
        return ang(r.left.pitch);
      case 'pitchRight':
        return ang(r.right?.pitch);
      case 'rafter':
        return len(r.left.rafter);
      case 'rafterRight':
        return len(r.right?.rafter);
      case 'ridgeOffset':
        return len(r.ridge.x);
      case 'rise':
        return len(r.type === 'lessenaarsdak' ? r.left.rise : r.ridge.y);
      default:
        return '';
    }
  }

  protected readonly rows = computed<ResultRow[]>(() => {
    const o = this.outcome();
    if (o.status !== 'ok') return [];
    const { roof, surfaceLeft, surfaceRight, purlinLength } = o.value;
    const pct = (p: number) => formatPercent(p);
    const tail: ResultRow[] = [];
    if (purlinLength !== null) tail.push({ label: 'Gordingen en nok', value: formatLength(purlinLength) });
    tail.push({ label: roof.fromFloor ? 'Gevelvlak vanaf vloer' : roof.type === 'zadeldak' ? 'Gevelvlak (driehoek)' : 'Gevelvlak', value: formatArea(roof.gableArea) });
    if (surfaceLeft !== null) {
      if (roof.right && roof.type === 'zadeldak') {
        tail.push({ label: 'Dakvlak links', value: formatArea(surfaceLeft) }, { label: 'Dakvlak rechts', value: formatArea(surfaceRight) });
      }
      tail.push({ label: 'Dakoppervlak totaal', value: formatArea(surfaceLeft + (surfaceRight ?? 0)) });
    }

    if (roof.upper && roof.knee) {
      return [
        { label: 'Nokhoogte', value: formatLength(roof.rise), main: true },
        { label: 'Knikhoogte', value: formatLength(roof.knee.y) },
        { label: 'Breedte op kniklijn', value: formatLength(roof.span - 2 * roof.knee.x) },
        { label: 'Helling onderdak', value: `${formatAngle(roof.left.pitch, 2)} · ${pct(roof.left.pitchPercent)}` },
        { label: 'Spar onderdak', value: formatLength(roof.left.rafter) },
        { label: 'Spar onderdak met overstek', value: formatLength(roof.left.rafterWithOverhang) },
        { label: 'Helling bovendak', value: `${formatAngle(roof.upper.pitch, 2)} · ${pct(roof.upper.pitchPercent)}` },
        { label: 'Spar bovendak', value: formatLength(roof.upper.rafter) },
        { label: 'Knikhoek', value: formatAngle(180 - roof.left.pitch + roof.upper.pitch, 2) },
        ...tail,
      ];
    }

    if (roof.type === 'lessenaarsdak') {
      return [
        { label: 'Dakhelling', value: formatAngle(roof.left.pitch, 2), main: true },
        { label: 'Helling in procent', value: pct(roof.left.pitchPercent) },
        { label: 'Hoogteverschil', value: formatLength(roof.left.rise) },
        { label: 'Sparlengte', value: formatLength(roof.left.rafter) },
        { label: 'Spar met overstek', value: formatLength(roof.left.rafterWithOverhang) },
        ...tail,
      ];
    }

    const right = roof.right!;
    const rows: ResultRow[] = [
      { label: 'Dakhelling links', value: formatAngle(roof.left.pitch, 2), main: true },
      { label: 'Dakhelling rechts', value: formatAngle(right.pitch, 2), main: true },
      { label: 'In procent links · rechts', value: `${pct(roof.left.pitchPercent)} · ${pct(right.pitchPercent)}` },
      { label: roof.fromFloor ? 'Nokhoogte vanaf vloer' : 'Nokhoogte boven muurplaat', value: formatLength(roof.ridge.y) },
    ];
    if (roof.fromFloor) {
      rows.push({ label: 'Nok boven muurplaat links', value: formatLength(roof.left.rise) }, { label: 'Nok boven muurplaat rechts', value: formatLength(right.rise) });
    }
    rows.push(
      { label: roof.ridgeAssumedCentre ? 'Nok vanaf muur links (midden)' : 'Nok vanaf muur links', value: formatLength(roof.ridge.x) },
      { label: 'Spar links · met overstek', value: `${formatLength(roof.left.rafter)} · ${formatLength(roof.left.rafterWithOverhang)}` },
      { label: 'Spar rechts · met overstek', value: `${formatLength(right.rafter)} · ${formatLength(right.rafterWithOverhang)}` },
      ...tail,
    );
    return rows;
  });

  protected readonly drawing = computed<DrawingSpec | null>(() => {
    const roof = this.roof();
    if (!roof) return null;
    const pts = roof.outline;
    const m = centroid(pts);
    const segments: Segment[] = [];
    // Base line: floor or wall-plate level.
    segments.push({ from: { x: 0, y: 0 }, to: { x: roof.span, y: 0 }, label: `S ${formatLength(roof.span, 2)}`, style: 'wall', awayFrom: m });
    // Everything above the base, edge by edge, with its length.
    const top = roof.fromFloor ? pts.slice(1, -1) : pts.filter((p) => p.y > 1e-9 || p.x === 0 || p.x === roof.span);
    const upperPts = roof.fromFloor ? [pts[0], ...top, pts[pts.length - 1]] : top;
    for (let i = 0; i < upperPts.length - 1; i++) {
      const a = upperPts[i];
      const b = upperPts[i + 1];
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      if (length < 1e-9) continue;
      segments.push({ from: a, to: b, label: formatLength(length, 2), style: 'wall', awayFrom: m });
    }
    // Ridge height line.
    const ridge = roof.ridge;
    if (ridge.x > 1e-9 && ridge.x < roof.span - 1e-9) {
      segments.push({ from: ridge, to: { x: ridge.x, y: 0 }, label: `h ${formatLength(ridge.y, 2)}`, style: 'dashed', awayFrom: { x: 0, y: ridge.y / 2 } });
    }
    if (roof.knee && roof.upper) {
      const k2 = pts[3];
      const mid = { x: (roof.knee.x + k2.x) / 2, y: roof.knee.y };
      segments.push(
        { from: roof.knee, to: mid, label: formatLength(k2.x - roof.knee.x, 2), style: 'dashed', awayFrom: { x: mid.x, y: 0 } },
        { from: mid, to: k2, style: 'dashed' },
      );
    }
    segments.push(...overhangs(roof));

    const plateL = { x: 0, y: roof.plateLeft };
    const plateR = { x: roof.span, y: roof.plateRight };
    const marks: Mark[] = [];
    if (roof.type === 'lessenaarsdak') {
      const low = roof.plateLeft <= roof.plateRight ? plateL : plateR;
      marks.push({ at: low, text: formatAngle(roof.left.pitch, 1), kind: 'angle', toward: m });
    } else {
      marks.push({ at: plateL, text: formatAngle(roof.left.pitch, 1), kind: 'angle', toward: m });
      if (roof.right && roof.type === 'zadeldak') marks.push({ at: plateR, text: formatAngle(roof.right.pitch, 1), kind: 'angle', toward: m });
      if (roof.knee && roof.upper) {
        const above = { x: (roof.knee.x + ridge.x) / 2, y: roof.knee.y + (ridge.y - roof.knee.y) * 0.25 };
        marks.push({ at: roof.knee, text: formatAngle(roof.upper.pitch, 1), kind: 'angle', toward: above });
      }
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

/** Short extensions past the wall plates, along the slopes, to show the eaves overhang. */
function overhangs(roof: RoofResult): Segment[] {
  const out: Segment[] = [];
  const ext = (foot: Point, toward: Point, len: number): Segment | null => {
    const d = Math.hypot(foot.x - toward.x, foot.y - toward.y);
    if (len <= 1e-9 || d <= 1e-9) return null;
    return { from: foot, to: { x: foot.x + ((foot.x - toward.x) / d) * len, y: foot.y + ((foot.y - toward.y) / d) * len }, style: 'mark' };
  };
  const plateL = { x: 0, y: roof.plateLeft };
  const plateR = { x: roof.span, y: roof.plateRight };
  const extra = roof.left.rafterWithOverhang - roof.left.rafter;
  if (roof.type === 'lessenaarsdak') {
    // Both ends of the single slope get the overhang.
    const a = ext(plateL, plateR, extra);
    const b = ext(plateR, plateL, extra);
    if (roof.fromFloor) {
      if (a) out.push(a);
      if (b) out.push(b);
    } else if (a) out.push(a);
    return out;
  }
  const firstUp = roof.knee ?? roof.ridge;
  const l = ext(plateL, firstUp, extra);
  if (l) out.push(l);
  if (roof.right) {
    const kneeR = roof.knee ? { x: roof.span - roof.knee.x, y: roof.knee.y } : roof.ridge;
    const r = ext(plateR, kneeR, roof.right.rafterWithOverhang - roof.right.rafter);
    if (r) out.push(r);
  }
  return out;
}

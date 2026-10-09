import { Component, computed, input, output } from '@angular/core';
import { Drawing, DrawingSpec, polygonSpec, Segment } from '../drawing/drawing';
import { formatAngle, formatArea, formatLength, formatMm, formatVolume } from '../geometry/units';
import { computeVorm } from '../model/compute';
import { OpeningEntry, resizeVorm, VormItem } from '../model/models';
import { MeasureField } from '../ui/measure-field';
import { ResultRow, Results } from '../ui/results';

@Component({
  selector: 'app-vorm-editor',
  imports: [MeasureField, Results, Drawing],
  template: `
    <div class="toolbar">
      <div class="stepper" role="group" aria-label="Aantal hoekpunten">
        <span class="stepper-label">Hoekpunten</span>
        <button type="button" (click)="resize(n() - 1)" [disabled]="n() <= 3" aria-label="Eén hoekpunt minder">−</button>
        <output>{{ n() }}</output>
        <button type="button" (click)="resize(n() + 1)" [disabled]="n() >= 24" aria-label="Eén hoekpunt meer">+</button>
      </div>
      <div class="segmented" role="radiogroup" aria-label="Meetmethode">
        <button type="button" role="radio" [attr.aria-checked]="item().method === 'diagonalen'" (click)="setMethod('diagonalen')">
          Met diagonalen
        </button>
        <button type="button" role="radio" [attr.aria-checked]="item().method === 'hoeken'" (click)="setMethod('hoeken')">Met hoeken</button>
      </div>
    </div>

    @if (item().method === 'diagonalen') {
      <p class="lead">
        Nummer de hoekpunten rondom (1, 2, 3 …). Meet elke zijde en vanaf hoekpunt 1 de diagonalen naar hoekpunt 3, 4 enzovoort.
        Daarmee liggen alle hoeken vast, ook als niets haaks is.
      </p>
    } @else {
      <p class="lead">
        Meet elke zijde en de hoek op hoekpunt 2 tot en met {{ n() - 1 }}, bijvoorbeeld met de hoekmeting (a, b, c).
        De laatste zijde is dan een controlemaat: de app rekent uit hoeveel je meting afwijkt.
      </p>
    }

    <h3 class="group-title">Zijden</h3>
    <div class="fields fields--4">
      @for (s of item().sides; track $index; let i = $index) {
        <app-measure-field
          [tag]="sideTag(i)"
          [label]="item().method === 'hoeken' && i === n() - 1 ? 'Controlemaat' : 'Zijde'"
          [value]="s"
          (valueChange)="setAt('sides', i, $event)"
        />
      }
    </div>

    @if (item().method === 'diagonalen') {
      @if (n() > 3) {
        <h3 class="group-title">Diagonalen vanaf hoekpunt 1</h3>
        <div class="fields fields--4">
          @for (d of item().diagonals; track $index; let i = $index) {
            <app-measure-field [tag]="'1–' + (i + 3)" label="Diagonaal" [value]="d" (valueChange)="setAt('diagonals', i, $event)" />
          }
        </div>
      }
      @if (n() > 3) {
        <details class="more">
          <summary>Inspringende hoeken</summary>
          <p class="hint">
            Klopt de schets niet bij een inspringende hoek? Vink het hoekpunt aan dat aan de verkeerde kant van de diagonaal is beland.
          </p>
          <div class="checks">
            @for (k of flipCorners(); track k) {
              <label class="check"><input type="checkbox" [checked]="item().flips[k]" (change)="toggleFlip(k)" /> Hoekpunt {{ k + 1 }}</label>
            }
          </div>
        </details>
      }
    } @else {
      <h3 class="group-title">Hoeken (binnenkant)</h3>
      <div class="fields fields--4">
        @for (a of item().angles; track $index; let i = $index) {
          <app-measure-field [tag]="'' + (i + 2)" label="Hoek" kind="angle" [value]="a" (valueChange)="setAt('angles', i, $event)" />
        }
      </div>
    }

    <details class="more" [open]="!!item().height || item().openings.length > 0">
      <summary>Ruimte: hoogte en openingen</summary>
      <div class="fields fields--4">
        <app-measure-field tag="h" label="Wandhoogte" [value]="item().height" (valueChange)="setField('height', $event)" />
      </div>
      @for (o of item().openings; track $index; let i = $index) {
        <div class="opening">
          <label class="field field--text">
            <span class="field-label">Opening</span>
            <input type="text" [value]="o.name" placeholder="deur, raam …" (input)="setOpening(i, 'name', $any($event.target).value)" />
          </label>
          <app-measure-field label="Breedte" [value]="o.width" (valueChange)="setOpening(i, 'width', $event)" />
          <app-measure-field label="Hoogte" [value]="o.height" (valueChange)="setOpening(i, 'height', $event)" />
          <button type="button" class="icon-btn" (click)="removeOpening(i)" [attr.aria-label]="'Opening ' + (i + 1) + ' verwijderen'">×</button>
        </div>
      }
      <button type="button" class="btn btn--quiet" (click)="addOpening()">+ Deur of raam</button>
    </details>

    <div class="split">
      <app-results [rows]="rows()" [message]="message()" [state]="outcome().status" />
      <app-drawing [spec]="drawing()" ariaLabel="Plattegrond op schaal" />
    </div>
  `,
})
export class VormEditor {
  readonly item = input.required<VormItem>();
  readonly changed = output<VormItem>();

  protected readonly n = computed(() => this.item().sides.length);
  protected readonly outcome = computed(() => computeVorm(this.item()));
  protected readonly message = computed(() => {
    const o = this.outcome();
    return o.status === 'ok' ? null : o.message;
  });
  /** Corners 3..n can fall on either side of the previous diagonal. */
  protected readonly flipCorners = computed(() => Array.from({ length: this.n() - 2 }, (_, i) => i + 2));

  protected sideTag(i: number): string {
    return `${i + 1}–${((i + 1) % this.n()) + 1}`;
  }

  protected readonly rows = computed<ResultRow[]>(() => {
    const o = this.outcome();
    if (o.status !== 'ok') return [];
    const { shape, room } = o.value;
    const rows: ResultRow[] = [{ label: 'Oppervlakte', value: formatArea(room.floorArea), main: true }];
    shape.angles.forEach((a, i) => {
      const square = Math.abs(a - 90) < 0.05 || Math.abs(a - 270) < 0.05;
      rows.push({ label: `Hoek ${i + 1}`, value: formatAngle(a, 2), tone: square ? 'ok' : undefined });
    });
    rows.push({ label: 'Omtrek', value: formatLength(shape.perimeter) });
    if ('closingLength' in shape) {
      rows.push({ label: `Zijde ${this.sideTag(this.n() - 1)} berekend`, value: formatLength(shape.closingLength) });
      if (shape.misclosure !== null) {
        const ok = Math.abs(shape.misclosure) < 0.005;
        rows.push({ label: 'Verschil met controlemaat', value: formatMm(shape.misclosure), tone: ok ? 'ok' : 'warn' });
      }
    }
    if (room.volume !== null) {
      rows.push({ label: 'Inhoud', value: formatVolume(room.volume) });
      rows.push({ label: 'Wandoppervlak', value: formatArea(room.wallArea) });
      if (room.openingsArea > 0) rows.push({ label: 'Wand min openingen', value: formatArea(room.netWallArea) });
    }
    return rows;
  });

  protected readonly drawing = computed<DrawingSpec | null>(() => {
    const o = this.outcome();
    if (o.status !== 'ok') return null;
    const { points, sides, angles } = o.value.shape;
    const diagonals: Segment[] =
      this.item().method === 'diagonalen' ? points.slice(2, -1).map((p) => ({ from: points[0], to: p, style: 'dashed' as const })) : [];
    return polygonSpec(
      points,
      sides.map((s) => formatLength(s, 2)),
      angles.map((a) => formatAngle(a, 1)),
      diagonals,
    );
  });

  protected resize(n: number): void {
    this.changed.emit(resizeVorm(this.item(), n));
  }

  protected setMethod(method: VormItem['method']): void {
    this.changed.emit({ ...this.item(), method });
  }

  protected setField(field: 'height', value: string): void {
    this.changed.emit({ ...this.item(), [field]: value });
  }

  protected setAt(field: 'sides' | 'diagonals' | 'angles', index: number, value: string): void {
    const arr = [...this.item()[field]];
    arr[index] = value;
    this.changed.emit({ ...this.item(), [field]: arr });
  }

  protected toggleFlip(k: number): void {
    const flips = [...this.item().flips];
    flips[k] = !flips[k];
    this.changed.emit({ ...this.item(), flips });
  }

  protected addOpening(): void {
    this.changed.emit({ ...this.item(), openings: [...this.item().openings, { name: '', width: '', height: '' }] });
  }

  protected setOpening(i: number, field: keyof OpeningEntry, value: string): void {
    const openings = this.item().openings.map((o, j) => (j === i ? { ...o, [field]: value } : o));
    this.changed.emit({ ...this.item(), openings });
  }

  protected removeOpening(i: number): void {
    this.changed.emit({ ...this.item(), openings: this.item().openings.filter((_, j) => j !== i) });
  }
}

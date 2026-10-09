import { Component, computed, input, output, signal } from '@angular/core';
import { Drawing, DrawingSpec, polygonSpec, Segment } from '../drawing/drawing';
import { Room3d } from '../drawing/room3d';
import { formatAngle, formatArea, formatLength, formatMm, formatVolume } from '../geometry/units';
import { computeVorm } from '../model/compute';
import { OpeningEntry, resizeVorm, VormItem } from '../model/models';
import { MeasureField } from '../ui/measure-field';
import { ResultRow, Results } from '../ui/results';

@Component({
  selector: 'app-vorm-editor',
  imports: [MeasureField, Results, Drawing, Room3d],
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
        De laatste zijde is dan een controlemaat: de app rekent uit hoeveel je meting afwijkt. Een punt midden op een rechte wand heeft 180°.
      </p>
    }

    <h3 class="group-title">Zijden</h3>
    <div class="fields fields--4">
      @for (s of item().sides; track $index; let i = $index) {
        <app-measure-field
          [tag]="wallTag(i)"
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

    <details class="more" [open]="roomOpen()">
      <summary>Ruimte: hoogtes, wanden en openingen</summary>
      <div class="segmented" role="radiogroup" aria-label="Hoogte">
        <button type="button" role="radio" [attr.aria-checked]="heightMode() === 'gelijk'" (click)="setHeightMode('gelijk')">Overal even hoog</button>
        <button type="button" role="radio" [attr.aria-checked]="heightMode() === 'per-hoek'" (click)="setHeightMode('per-hoek')">
          Hoogte per hoekpunt
        </button>
      </div>
      @if (heightMode() === 'gelijk') {
        <div class="fields fields--4 room-fields">
          <app-measure-field tag="h" label="Wandhoogte" [value]="item().height" (valueChange)="setField('height', $event)" />
        </div>
      } @else {
        <p class="hint room-hint">
          Hoogte van vloer tot plafond of muurplaat bij elk hoekpunt. Een schuin plafond of een nok? Zet een hoekpunt onder de nok
          (op de gevelwand, met 180°) en vul daar de nokhoogte in.
        </p>
        <div class="fields fields--4">
          @for (h of heights(); track $index; let i = $index) {
            <app-measure-field [tag]="'' + (i + 1)" label="Hoogte bij hoekpunt" [value]="h" (valueChange)="setHeight(i, $event)" />
          }
        </div>
      }

      <h3 class="group-title">Deuren en ramen</h3>
      @if (item().openings.length === 0) {
        <p class="hint">Voeg openingen toe om het netto wandoppervlak te krijgen en ze in 3D op de juiste plek te zien.</p>
      }
      @for (o of item().openings; track $index; let i = $index) {
        <div class="opening-card">
          <div class="opening-head">
            <label class="field field--text">
              <span class="field-label">Naam</span>
              <input type="text" [value]="o.name" placeholder="deur, raam …" (input)="setOpening(i, 'name', $any($event.target).value)" />
            </label>
            <label class="field field--text">
              <span class="field-label">Op wand</span>
              <select [value]="o.wall ?? ''" (change)="setOpening(i, 'wall', $any($event.target).value)">
                <option value="">Niet geplaatst</option>
                @for (w of wallOptions(); track w.value) {
                  <option [value]="w.value" [selected]="w.value === (o.wall ?? '')">{{ w.label }}</option>
                }
              </select>
            </label>
            <button type="button" class="icon-btn" (click)="removeOpening(i)" [attr.aria-label]="'Opening ' + (i + 1) + ' verwijderen'">×</button>
          </div>
          <div class="fields fields--4 opening-fields">
            @if (o.wall) {
              <app-measure-field
                tag="↔"
                [label]="'Vanaf hoekpunt ' + (+o.wall + 1)"
                [value]="o.offset ?? ''"
                (valueChange)="setOpening(i, 'offset', $event)"
                hint="Tot de zijkant van de opening"
              />
            }
            <app-measure-field label="Breedte" [value]="o.width" (valueChange)="setOpening(i, 'width', $event)" />
            <app-measure-field label="Hoogte" [value]="o.height" (valueChange)="setOpening(i, 'height', $event)" />
            @if (o.wall) {
              <app-measure-field label="Borstwering" [value]="o.sill ?? ''" (valueChange)="setOpening(i, 'sill', $event)" hint="Vloer tot onderkant, deur = 0" />
            }
          </div>
        </div>
      }
      <div class="opening-actions">
        <button type="button" class="btn btn--quiet" (click)="addOpening('deur')">+ Deur</button>
        <button type="button" class="btn btn--quiet" (click)="addOpening('raam')">+ Raam</button>
      </div>
      @if (roomMessage(); as m) {
        <p class="status" [class.status--error]="roomError()" role="status">{{ m }}</p>
      }
    </details>

    <div class="split">
      <div class="result-col">
        <app-results [rows]="rows()" [message]="message()" [state]="outcome().status" />
        @if (room(); as r) {
          <div class="table-wrap">
            <table class="walls">
              <caption>Wanden</caption>
              <thead>
                <tr>
                  <th scope="col">Wand</th>
                  <th scope="col">Lengte</th>
                  <th scope="col">Hoogte</th>
                  <th scope="col">Netto</th>
                </tr>
              </thead>
              <tbody>
                @for (w of r.walls; track w.index) {
                  <tr>
                    <th scope="row">{{ wallTag(w.index) }}</th>
                    <td>{{ len(w.length) }}</td>
                    <td>{{ heightText(w.heightFrom, w.heightTo) }}</td>
                    <td>
                      {{ area(w.netArea) }}
                      @if (w.openings.length) {
                        <span class="sub">−{{ w.openings.length }} opening{{ w.openings.length > 1 ? 'en' : '' }}</span>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </div>
      <div class="drawing-col">
        @if (room()) {
          <div class="segmented segmented--small" role="radiogroup" aria-label="Weergave">
            <button type="button" role="radio" [attr.aria-checked]="view() === 'plan'" (click)="view.set('plan')">Plattegrond</button>
            <button type="button" role="radio" [attr.aria-checked]="view() === '3d'" (click)="view.set('3d')">3D</button>
          </div>
        }
        @if (view() === '3d' && room() && points()) {
          <app-room3d [points]="points()!" [room]="room()!" />
        } @else {
          <app-drawing [spec]="drawing()" ariaLabel="Plattegrond op schaal" />
        }
      </div>
    </div>
  `,
})
export class VormEditor {
  readonly item = input.required<VormItem>();
  readonly changed = output<VormItem>();

  protected readonly view = signal<'plan' | '3d'>('plan');
  protected readonly n = computed(() => this.item().sides.length);
  protected readonly heightMode = computed(() => this.item().heightMode ?? 'gelijk');
  protected readonly heights = computed(() => resizeVorm(this.item(), this.n()).heights ?? []);
  protected readonly outcome = computed(() => computeVorm(this.item()));
  protected readonly ok = computed(() => {
    const o = this.outcome();
    return o.status === 'ok' ? o.value : null;
  });
  protected readonly room = computed(() => this.ok()?.room ?? null);
  protected readonly points = computed(() => this.ok()?.shape.points ?? null);
  protected readonly roomMessage = computed(() => this.ok()?.roomMessage ?? null);
  protected readonly roomError = computed(() => this.ok()?.roomError ?? false);
  protected readonly message = computed(() => {
    const o = this.outcome();
    return o.status === 'ok' ? null : o.message;
  });
  protected readonly roomOpen = computed(
    () => !!this.item().height || this.heightMode() === 'per-hoek' || this.item().openings.length > 0,
  );
  /** Corners 3..n can fall on either side of the previous diagonal. */
  protected readonly flipCorners = computed(() => Array.from({ length: this.n() - 2 }, (_, i) => i + 2));

  protected readonly wallOptions = computed(() => {
    const sides = this.ok()?.shape.sides;
    return Array.from({ length: this.n() }, (_, i) => ({
      value: String(i),
      label: `Wand ${this.wallTag(i)}` + (sides ? ` (${formatLength(sides[i], 2)})` : ''),
    }));
  });

  protected wallTag(i: number): string {
    return `${i + 1}–${((i + 1) % this.n()) + 1}`;
  }

  protected len(m: number): string {
    return formatLength(m, 2);
  }

  protected area(m2: number): string {
    return formatArea(m2);
  }

  protected heightText(a: number, b: number): string {
    return Math.abs(a - b) < 0.0005 ? formatLength(a, 2) : `${formatLength(a, 2).replace(' m', '')}–${formatLength(b, 2)}`;
  }

  protected readonly rows = computed<ResultRow[]>(() => {
    const v = this.ok();
    if (!v) return [];
    const { shape, room } = v;
    const rows: ResultRow[] = [{ label: 'Vloeroppervlak', value: formatArea(shape.area), main: true }];
    if (room) {
      rows.push({ label: room.ceiling === 'dakvorm' ? 'Inhoud (dakvorm)' : 'Inhoud', value: formatVolume(room.volume) });
      rows.push({ label: 'Wandoppervlak', value: formatArea(room.wallArea) });
      if (room.openingsArea > 0) rows.push({ label: 'Wand min openingen', value: formatArea(room.netWallArea) });
      if (room.sloped) {
        rows.push({ label: 'Hoogte', value: `${formatLength(room.minHeight, 2).replace(' m', '')} tot ${formatLength(room.maxHeight, 2)}` });
        rows.push({ label: 'Plafond langs de helling', value: formatArea(room.ceilingArea) });
      }
    }
    shape.angles.forEach((a, i) => {
      const square = Math.abs(a - 90) < 0.05 || Math.abs(a - 270) < 0.05;
      rows.push({ label: `Hoek ${i + 1}`, value: formatAngle(a, 2), tone: square ? 'ok' : undefined });
    });
    rows.push({ label: 'Omtrek', value: formatLength(shape.perimeter) });
    if ('closingLength' in shape) {
      rows.push({ label: `Zijde ${this.wallTag(this.n() - 1)} berekend`, value: formatLength(shape.closingLength) });
      if (shape.misclosure !== null) {
        const ok = Math.abs(shape.misclosure) < 0.005;
        rows.push({ label: 'Verschil met controlemaat', value: formatMm(shape.misclosure), tone: ok ? 'ok' : 'warn' });
      }
    }
    return rows;
  });

  protected readonly drawing = computed<DrawingSpec | null>(() => {
    const v = this.ok();
    if (!v) return null;
    const { points, sides, angles } = v.shape;
    const diagonals: Segment[] =
      this.item().method === 'diagonalen' ? points.slice(2, -1).map((p) => ({ from: points[0], to: p, style: 'dashed' as const })) : [];
    // Placed openings as marks on their wall.
    const openings: Segment[] = (v.room?.walls ?? []).flatMap((w) =>
      w.openings.map((o) => {
        const ux = (w.to.x - w.from.x) / w.length;
        const uy = (w.to.y - w.from.y) / w.length;
        const a = o.offset ?? 0;
        return {
          from: { x: w.from.x + ux * a, y: w.from.y + uy * a },
          to: { x: w.from.x + ux * (a + o.width), y: w.from.y + uy * (a + o.width) },
          style: 'mark' as const,
        };
      }),
    );
    const spec = polygonSpec(
      points,
      sides.map((s) => formatLength(s, 2)),
      angles.map((a) => formatAngle(a, 1)),
      diagonals,
    );
    return { ...spec, segments: [...spec.segments, ...openings] };
  });

  protected resize(n: number): void {
    this.changed.emit(resizeVorm(this.item(), n));
  }

  protected setMethod(method: VormItem['method']): void {
    this.changed.emit({ ...this.item(), method });
  }

  protected setHeightMode(heightMode: 'gelijk' | 'per-hoek'): void {
    const item = resizeVorm(this.item(), this.n());
    // Switching to per-corner: start from the single height so nothing has to be typed twice.
    const heights = heightMode === 'per-hoek' && item.height && (item.heights ?? []).every((h) => !h) ? item.heights!.map(() => item.height) : item.heights;
    this.changed.emit({ ...item, heightMode, heights });
  }

  protected setField(field: 'height', value: string): void {
    this.changed.emit({ ...this.item(), [field]: value });
  }

  protected setHeight(i: number, value: string): void {
    const heights = [...this.heights()];
    heights[i] = value;
    this.changed.emit({ ...this.item(), heights });
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

  protected addOpening(kind: 'deur' | 'raam'): void {
    const count = this.item().openings.filter((o) => o.name.startsWith(kind)).length;
    const opening: OpeningEntry = {
      name: count ? `${kind} ${count + 1}` : kind,
      width: '',
      height: '',
      wall: '',
      offset: '',
      sill: kind === 'deur' ? '0' : '',
    };
    this.changed.emit({ ...this.item(), openings: [...this.item().openings, opening] });
  }

  protected setOpening(i: number, field: keyof OpeningEntry, value: string): void {
    const openings = this.item().openings.map((o, j) => (j === i ? { ...o, [field]: value } : o));
    this.changed.emit({ ...this.item(), openings });
  }

  protected removeOpening(i: number): void {
    this.changed.emit({ ...this.item(), openings: this.item().openings.filter((_, j) => j !== i) });
  }
}

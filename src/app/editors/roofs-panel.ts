import { Component, computed, input, output } from '@angular/core';
import { FloorPlan, PlacedRoof } from '../geometry/floorplan';
import { formatLength } from '../geometry/units';
import { computeDak } from '../model/compute';
import { PlattegrondResult } from '../model/compute-plan';
import { DakItem, DormerEntry, RoofEntry, RoofWindowEntry } from '../model/models';
import { MeasureField } from '../ui/measure-field';

interface RoomRef {
  id: string;
  name: string;
}

/** Roofs of a floor: which roof over which rooms, its direction, dormers and roof windows. */
@Component({
  selector: 'app-roofs-panel',
  imports: [MeasureField],
  template: `
    @if (daks().length === 0) {
      <p class="hint">Voeg een Dak & spant toe om een kap op deze verdieping te zetten. Ruimtes zonder kap krijgen een plat dak.</p>
    } @else {
      <p class="hint">
        Een kap ligt over de hele verdieping, of alleen over de ruimtes die je aanvinkt (bijvoorbeeld een uitbouw met een eigen lessenaarsdak). Ruimtes zonder
        kap en zonder verdieping erboven krijgen een plat dak.
      </p>
    }
    @for (e of entries(); track $index; let i = $index) {
      <div class="plan-room roof-card">
        <div class="plan-room-head">
          <span class="plan-room-nr">K</span>
          <label class="field field--text field--grow">
            <span class="field-label">Kap</span>
            <select [value]="e.roofId" (change)="patch(i, { roofId: $any($event.target).value })">
              <option value="">Kies een Dak & spant</option>
              @for (d of daks(); track d.id) {
                <option [value]="d.id" [selected]="d.id === e.roofId">{{ d.name }}</option>
              }
            </select>
          </label>
          <button type="button" class="icon-btn" (click)="remove(i)" [attr.aria-label]="'Kap ' + (i + 1) + ' weghalen'">×</button>
        </div>

        <fieldset class="roof-rooms">
          <legend>Over {{ e.rooms.length ? 'deze ruimtes' : 'de hele verdieping' }}</legend>
          @for (r of rooms(); track r.id) {
            <label class="check"><input type="checkbox" [checked]="e.rooms.includes(r.id)" (change)="toggleRoom(i, r.id)" /> {{ r.name }}</label>
          }
        </fieldset>

        <div class="segmented" role="radiogroup" aria-label="Richting van de nok">
          <button type="button" role="radio" [attr.aria-checked]="e.ridge === 'x'" (click)="patch(i, { ridge: 'x' })">Nok evenwijdig aan voorgevel</button>
          <button type="button" role="radio" [attr.aria-checked]="e.ridge === 'y'" (click)="patch(i, { ridge: 'y' })">Nok van voor naar achter</button>
        </div>
        <label class="check"><input type="checkbox" [checked]="e.flip" (change)="patch(i, { flip: !e.flip })" /> Kap omdraaien (links en rechts van de spant wisselen)</label>
        @if (e.roofId && !fromFloor(e.roofId)) {
          <div class="fields fields--3">
            <app-measure-field
              label="Hoogte muurplaat"
              [value]="e.plateHeight"
              (valueChange)="patch(i, { plateHeight: $event })"
              [placeholder]="platePlaceholder(i)"
              hint="Vanaf deze vloer; leeg = hoogste ruimte eronder"
            />
          </div>
        }
        @if (info()?.roofInfo?.[i]?.problem; as prob) {
          <p class="status status--error">{{ prob }}</p>
        }

        <h4 class="sub-title">Dakkapellen</h4>
        @for (d of e.dormers; track $index; let j = $index) {
          <div class="sub-card">
            <div class="plan-room-head">
              <label class="field field--text field--grow">
                <span class="field-label">Naam</span>
                <input type="text" [value]="d.name" (input)="patchDormer(i, j, { name: $any($event.target).value })" />
              </label>
              <label class="field field--text field--grow">
                <span class="field-label">Dakvlak</span>
                <select [value]="d.plane" (change)="patchDormer(i, j, { plane: $any($event.target).value })">
                  <option value="">Kies</option>
                  @for (pl of planes(i); track pl.value) {
                    <option [value]="pl.value" [selected]="pl.value === d.plane">{{ pl.label }}</option>
                  }
                </select>
              </label>
              <button type="button" class="icon-btn" (click)="removeDormer(i, j)" aria-label="Dakkapel weghalen">×</button>
            </div>
            <div class="fields fields--4">
              <app-measure-field [label]="fromLabel(e)" [value]="d.offset" (valueChange)="patchDormer(i, j, { offset: $event })" hint="Buitenkant gevel tot zijkant" placeholder="0" />
              <app-measure-field label="Breedte" [value]="d.width" (valueChange)="patchDormer(i, j, { width: $event })" />
              <app-measure-field label="Hoogte voorkant" [value]="d.frontHeight" (valueChange)="patchDormer(i, j, { frontHeight: $event })" hint="Van het dak tot de bovenkant" />
              <app-measure-field label="Terugligging" [value]="d.setback" (valueChange)="patchDormer(i, j, { setback: $event })" hint="Muurplaat tot voorkant, horizontaal" placeholder="0" />
              <app-measure-field label="Raam breedte" [value]="d.windowWidth" (valueChange)="patchDormer(i, j, { windowWidth: $event })" hint="Leeg = geen raam" />
              <app-measure-field label="Raam hoogte" [value]="d.windowHeight" (valueChange)="patchDormer(i, j, { windowHeight: $event })" />
            </div>
          </div>
        }
        <h4 class="sub-title">Dakramen</h4>
        @for (w of e.windows; track $index; let j = $index) {
          <div class="sub-card">
            <div class="plan-room-head">
              <label class="field field--text field--grow">
                <span class="field-label">Naam</span>
                <input type="text" [value]="w.name" (input)="patchWindow(i, j, { name: $any($event.target).value })" />
              </label>
              <label class="field field--text field--grow">
                <span class="field-label">Dakvlak</span>
                <select [value]="w.plane" (change)="patchWindow(i, j, { plane: $any($event.target).value })">
                  <option value="">Kies</option>
                  @for (pl of planes(i); track pl.value) {
                    <option [value]="pl.value" [selected]="pl.value === w.plane">{{ pl.label }}</option>
                  }
                </select>
              </label>
              <button type="button" class="icon-btn" (click)="removeWindow(i, j)" aria-label="Dakraam weghalen">×</button>
            </div>
            <div class="fields fields--4">
              <app-measure-field [label]="fromLabel(e)" [value]="w.offset" (valueChange)="patchWindow(i, j, { offset: $event })" hint="Buitenkant gevel tot zijkant" placeholder="0" />
              <app-measure-field label="Vanaf muurplaat" [value]="w.up" (valueChange)="patchWindow(i, j, { up: $event })" hint="Langs de helling" placeholder="0" />
              <app-measure-field label="Breedte" [value]="w.width" (valueChange)="patchWindow(i, j, { width: $event })" />
              <app-measure-field label="Lengte" [value]="w.length" (valueChange)="patchWindow(i, j, { length: $event })" hint="Langs de helling" />
            </div>
          </div>
        }
        <div class="opening-actions">
          <button type="button" class="btn btn--quiet" (click)="addDormer(i)">+ Dakkapel</button>
          <button type="button" class="btn btn--quiet" (click)="addWindow(i)">+ Dakraam</button>
        </div>
      </div>
    }
    @if (daks().length > 0) {
      <button type="button" class="btn btn--quiet" (click)="add()">+ Kap</button>
    }
  `,
})
export class RoofsPanel {
  readonly entries = input.required<RoofEntry[]>();
  readonly rooms = input.required<RoomRef[]>();
  readonly daks = input.required<DakItem[]>();
  readonly plan = input<FloorPlan | null>(null);
  readonly info = input<PlattegrondResult | null>(null);
  readonly changed = output<RoofEntry[]>();

  private readonly sections = computed(() => {
    const out = new Map<string, { fromFloor: boolean; planes: number }>();
    for (const d of this.daks()) {
      const r = computeDak(d);
      if (r.status === 'ok') out.set(d.id, { fromFloor: r.value.roof.fromFloor, planes: r.value.roof.type === 'mansardekap' ? 4 : r.value.roof.type === 'lessenaarsdak' ? 1 : 2 });
    }
    return out;
  });

  protected fromFloor(id: string): boolean {
    return this.sections().get(id)?.fromFloor ?? false;
  }

  private placed(i: number): PlacedRoof | null {
    return this.plan()?.roofs.find((r) => r.key === String(i)) ?? null;
  }

  protected planes(i: number): { value: string; label: string }[] {
    const placed = this.placed(i);
    if (placed) {
      return placed.planes.map((p) => ({
        value: String(p.index),
        label: `${p.label} (${formatLength(Math.hypot(p.upper.c - p.lower.c, p.upper.z - p.lower.z), 2)} langs de helling)`,
      }));
    }
    const n = this.sections().get(this.entries()[i]?.roofId)?.planes ?? 0;
    return Array.from({ length: n }, (_, k) => ({ value: String(k), label: `Dakvlak ${k + 1}` }));
  }

  protected fromLabel(e: RoofEntry): string {
    return e.ridge === 'x' ? 'Vanaf linkergevel' : 'Vanaf voorgevel';
  }

  protected platePlaceholder(i: number): string {
    const ri = this.info()?.roofInfo[i];
    return ri?.assumed && ri.plateHeight !== null ? formatLength(ri.plateHeight).replace(' m', '') : '';
  }

  private emit(entries: RoofEntry[]): void {
    this.changed.emit(entries);
  }

  protected patch(i: number, patch: Partial<RoofEntry>): void {
    this.emit(this.entries().map((e, k) => (k === i ? { ...e, ...patch } : e)));
  }

  protected toggleRoom(i: number, id: string): void {
    const rooms = this.entries()[i].rooms;
    this.patch(i, { rooms: rooms.includes(id) ? rooms.filter((r) => r !== id) : [...rooms, id] });
  }

  protected add(): void {
    const first = this.daks().find((d) => !this.entries().some((e) => e.roofId === d.id)) ?? this.daks()[0];
    this.emit([...this.entries(), { roofId: first?.id ?? '', rooms: [], ridge: 'x', flip: false, plateHeight: '', dormers: [], windows: [] }]);
  }

  protected remove(i: number): void {
    this.emit(this.entries().filter((_, k) => k !== i));
  }

  protected addDormer(i: number): void {
    const e = this.entries()[i];
    const d: DormerEntry = {
      name: e.dormers.length ? `dakkapel ${e.dormers.length + 1}` : 'dakkapel',
      plane: '0',
      offset: '',
      width: '',
      frontHeight: '',
      setback: '',
      windowWidth: '',
      windowHeight: '',
    };
    this.patch(i, { dormers: [...e.dormers, d] });
  }

  protected patchDormer(i: number, j: number, patch: Partial<DormerEntry>): void {
    const e = this.entries()[i];
    this.patch(i, { dormers: e.dormers.map((d, k) => (k === j ? { ...d, ...patch } : d)) });
  }

  protected removeDormer(i: number, j: number): void {
    const e = this.entries()[i];
    this.patch(i, { dormers: e.dormers.filter((_, k) => k !== j) });
  }

  protected addWindow(i: number): void {
    const e = this.entries()[i];
    const w: RoofWindowEntry = { name: e.windows.length ? `dakraam ${e.windows.length + 1}` : 'dakraam', plane: '0', offset: '', up: '', width: '', length: '' };
    this.patch(i, { windows: [...e.windows, w] });
  }

  protected patchWindow(i: number, j: number, patch: Partial<RoofWindowEntry>): void {
    const e = this.entries()[i];
    this.patch(i, { windows: e.windows.map((w, k) => (k === j ? { ...w, ...patch } : w)) });
  }

  protected removeWindow(i: number, j: number): void {
    const e = this.entries()[i];
    this.patch(i, { windows: e.windows.filter((_, k) => k !== j) });
  }
}

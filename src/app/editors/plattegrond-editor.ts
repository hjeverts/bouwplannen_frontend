import { Component, computed, inject, input, output } from '@angular/core';
import { HouseViewer } from '../drawing/house-viewer';
import { formatArea, formatLength, formatMm, formatVolume } from '../geometry/units';
import { computeDak, computeVorm } from '../model/compute';
import { computeBuilding, computePlattegrond, possibleBelow } from '../model/compute-plan';
import { DakItem, PlanRoomEntry, PlattegrondItem, RoofEntry, roofEntries, VoidEntry, VormItem } from '../model/models';
import { ProjectStore } from '../model/project-store';
import { MeasureField } from '../ui/measure-field';
import { RoofsPanel } from './roofs-panel';
import { ResultRow, Results } from '../ui/results';

interface RoomChoice {
  id: string;
  name: string;
  sides: number[] | null;
}

@Component({
  selector: 'app-plattegrond-editor',
  imports: [MeasureField, Results, HouseViewer, RoofsPanel],
  template: `
    <p class="lead">
      Meet eerst elke ruimte als <strong>Vorm</strong>, met hoogte en deuren en ramen. Hier leg je ze tegen elkaar: kies per ruimte tegen welke
      wand van een andere ruimte hij ligt en hoe dik de muur ertussen is. Een deur in die muur zet je maar in één van de twee ruimtes.
      Een toilet in de garage of een meterkast in de hal? Kies dan <strong>Ligt in</strong>.
    </p>

    <h3 class="group-title">Ruimtes</h3>
    @if (vorms().length === 0) {
      <p class="status">Er zijn nog geen ruimtes in dit project. Voeg eerst een Vorm toe per ruimte.</p>
    }
    @for (r of item().rooms; track $index; let i = $index) {
      <div class="plan-room">
        <div class="plan-room-head">
          <span class="plan-room-nr">{{ i + 1 }}</span>
          <label class="field field--text field--grow">
            <span class="field-label">Ruimte</span>
            <select [value]="r.roomId" (change)="setRoom(i, { roomId: $any($event.target).value })">
              @for (v of choicesFor(i); track v.id) {
                <option [value]="v.id" [selected]="v.id === r.roomId">{{ v.name }}</option>
              }
            </select>
          </label>
          <button type="button" class="icon-btn" (click)="removeRoom(i)" [attr.aria-label]="'Ruimte ' + (i + 1) + ' weghalen'">×</button>
        </div>
        @if (i === 0) {
          <p class="hint">Uitgangspunt: de andere ruimtes worden hiertegen gelegd.</p>
        } @else {
          <div class="segmented segmented--small plan-mode" role="radiogroup" aria-label="Ligging">
            <button type="button" role="radio" [attr.aria-checked]="!r.inside" (click)="setRoom(i, { inside: false })">Ligt tegen</button>
            <button type="button" role="radio" [attr.aria-checked]="!!r.inside" (click)="setRoom(i, { inside: true, thickness: r.thickness || '0,100', distance: r.distance || '0' })">
              Ligt in
            </button>
          </div>
          <div class="fields fields--3 plan-link">
            <label class="field field--text">
              <span class="field-label">{{ r.inside ? 'Ligt in' : 'Ligt tegen' }}</span>
              <select [value]="r.to ?? ''" (change)="setRoom(i, { to: $any($event.target).value, toWall: '' })">
                <option value="">Kies een ruimte</option>
                @for (o of others(i); track o.id) {
                  <option [value]="o.id" [selected]="o.id === r.to">{{ o.name }}</option>
                }
              </select>
            </label>
            <label class="field field--text">
              <span class="field-label">Met wand</span>
              <select [value]="r.wall ?? ''" (change)="setRoom(i, { wall: $any($event.target).value })">
                <option value="">Kies</option>
                @for (w of walls(r.roomId); track w.value) {
                  <option [value]="w.value" [selected]="w.value === r.wall">{{ w.label }}</option>
                }
              </select>
            </label>
            <label class="field field--text">
              <span class="field-label">{{ r.inside ? 'Langs wand van' : 'Tegen wand van' }} {{ nameOf(r.to) }}</span>
              <select [value]="r.toWall ?? ''" (change)="setRoom(i, { toWall: $any($event.target).value })">
                <option value="">Kies</option>
                @for (w of walls(r.to); track w.value) {
                  <option [value]="w.value" [selected]="w.value === r.toWall">{{ w.label }}</option>
                }
              </select>
            </label>
          </div>
          @if (r.inside) {
            <div class="fields fields--3">
              <app-measure-field label="Eigen wanddikte" [value]="r.thickness ?? ''" (valueChange)="setRoom(i, { thickness: $event })" placeholder="0,100" hint="Wanden die vrij in de ruimte staan" />
              <app-measure-field label="Langs de wand" [value]="r.offset ?? ''" (valueChange)="setRoom(i, { offset: $event })" placeholder="0" [hint]="shiftHint(i)" />
              <app-measure-field label="Uit de wand" [value]="r.distance ?? ''" (valueChange)="setRoom(i, { distance: $event })" placeholder="0" hint="0 = gebruikt die wand als eigen wand" />
            </div>
          } @else {
            <div class="fields fields--3">
              <app-measure-field label="Muurdikte ertussen" [value]="r.thickness ?? ''" (valueChange)="setRoom(i, { thickness: $event })" placeholder="0,100" />
              <app-measure-field label="Verschuiving" [value]="r.offset ?? ''" (valueChange)="setRoom(i, { offset: $event })" placeholder="0" [hint]="shiftHint(i)" />
            </div>
          }
        }
        <label class="check"><input type="checkbox" [checked]="!!r.mirror" (change)="setRoom(i, { mirror: !r.mirror })" /> Spiegelen (hoekpunten met de klok mee genummerd)</label>
        @if (roomStatus(r.roomId); as s) {
          <p class="status status--error">{{ s }}</p>
        }
      </div>
    }
    @if (unusedVorms().length > 0) {
      <button type="button" class="btn btn--quiet" (click)="addRoom()">+ Ruimte toevoegen</button>
    }

    <details class="more" [open]="(item().voids ?? []).length > 0">
      <summary>Trapgat</summary>
      <p class="hint">
        Zet het trapgat op de verdieping waar het gat in de vloer zit. Meet in de ruimte vanaf een wand: hoe ver langs de wand vanaf de hoek, en hoe ver
        uit de wand. Op de verdieping eronder verschijnt het gestippeld.
      </p>
      @for (v of item().voids ?? []; track $index; let i = $index) {
        <div class="plan-room">
          <div class="plan-room-head">
            <span class="plan-room-nr">T</span>
            <label class="field field--text field--grow">
              <span class="field-label">Naam</span>
              <input type="text" [value]="v.name" placeholder="trapgat" (input)="setVoid(i, { name: $any($event.target).value })" />
            </label>
            <button type="button" class="icon-btn" (click)="removeVoid(i)" [attr.aria-label]="'Trapgat ' + (i + 1) + ' weghalen'">×</button>
          </div>
          <div class="fields fields--3 plan-link">
            <label class="field field--text">
              <span class="field-label">In ruimte</span>
              <select [value]="v.roomId" (change)="setVoid(i, { roomId: $any($event.target).value, wall: '' })">
                <option value="">Kies</option>
                @for (o of placedRooms(); track o.id) {
                  <option [value]="o.id" [selected]="o.id === v.roomId">{{ o.name }}</option>
                }
              </select>
            </label>
            <label class="field field--text">
              <span class="field-label">Gemeten vanaf wand</span>
              <select [value]="v.wall" (change)="setVoid(i, { wall: $any($event.target).value })">
                <option value="">Kies</option>
                @for (w of walls(v.roomId); track w.value) {
                  <option [value]="w.value" [selected]="w.value === v.wall">{{ w.label }}</option>
                }
              </select>
            </label>
          </div>
          <div class="fields fields--4">
            <app-measure-field [label]="'Vanaf hoekpunt ' + (v.wall === '' ? '…' : +v.wall + 1)" [value]="v.offset" (valueChange)="setVoid(i, { offset: $event })" hint="Langs de wand" placeholder="0" />
            <app-measure-field label="Uit de wand" [value]="v.distance" (valueChange)="setVoid(i, { distance: $event })" hint="0 = tegen de wand" placeholder="0" />
            <app-measure-field label="Breedte" [value]="v.width" (valueChange)="setVoid(i, { width: $event })" hint="Langs de wand" />
            <app-measure-field label="Lengte" [value]="v.length" (valueChange)="setVoid(i, { length: $event })" hint="De ruimte in" />
          </div>
        </div>
      }
      <button type="button" class="btn btn--quiet" (click)="addVoid()" [disabled]="item().rooms.length === 0">+ Trapgat</button>
    </details>

    <details class="more" [open]="!!item().measuredWidth || !!item().measuredDepth">
      <summary>Buitenmuren en buitenmaat</summary>
      <div class="fields fields--3">
        <app-measure-field label="Dikte buitenmuur" [value]="item().outerWall" (valueChange)="set('outerWall', $event)" hint="Inclusief spouw en isolatie" />
        <app-measure-field label="Gemeten breedte voorgevel" [value]="item().measuredWidth" (valueChange)="set('measuredWidth', $event)" hint="Buitenwerks, links–rechts" />
        <app-measure-field label="Gemeten diepte" [value]="item().measuredDepth" (valueChange)="set('measuredDepth', $event)" hint="Buitenwerks, voor–achter" />
        <app-measure-field label="Dikte plat dak" [value]="item().flatThickness ?? ''" (valueChange)="set('flatThickness', $event)" placeholder="0,300" hint="Boven ruimtes zonder kap of verdieping" />
      </div>
      <button type="button" class="btn btn--quiet" (click)="set('turn', (item().turn + 1) % 4)">Plattegrond een kwartslag draaien ↻</button>
      <p class="hint">De onderkant van de plattegrond is de voorgevel.</p>
    </details>

    <details class="more" [open]="!!item().below">
      <summary>Verdieping</summary>
      <div class="fields fields--3">
        <label class="field field--text">
          <span class="field-label">Staat op</span>
          <select [value]="item().below" (change)="set('below', $any($event.target).value)">
            <option value="">Niets (begane grond)</option>
            @for (b of belowChoices(); track b.id) {
              <option [value]="b.id" [selected]="b.id === item().below">{{ b.name }}</option>
            }
          </select>
        </label>
        @if (item().below) {
          <app-measure-field label="Vloerdikte" [value]="item().floorThickness" (valueChange)="set('floorThickness', $event)" hint="Plafond beneden tot vloer hier" />
          <app-measure-field label="Verschuiving naar rechts" [value]="item().shiftX" (valueChange)="set('shiftX', $event)" hint="Buitenkant t.o.v. de verdieping eronder" />
          <app-measure-field label="Verschuiving naar achter" [value]="item().shiftY" (valueChange)="set('shiftY', $event)" />
        }
      </div>
    </details>

    <details class="more" [open]="roofList().length > 0">
      <summary>Kap, dakkapellen en dakramen</summary>
      <app-roofs-panel [entries]="roofList()" [rooms]="placedRooms()" [daks]="roofs()" [plan]="plan()" [info]="result()" (changed)="setRoofs($event)" />
    </details>

    <app-results [rows]="rows()" [message]="message()" [state]="outcome().status" />
    @for (w of notes(); track w) {
      <p class="status status--warn">{{ w }}</p>
    }

    @if (plan(); as p) {
      @if (p.rooms.length > 0) {
        <app-house-viewer [plan]="p" [levels]="levels()" [levelId]="item().id" [projectName]="projectName()" [itemName]="item().name" />
      }
    }
  `,
})
export class PlattegrondEditor {
  readonly item = input.required<PlattegrondItem>();
  readonly changed = output<PlattegrondItem>();

  private readonly store = inject(ProjectStore);
  private readonly items = computed(() => this.store.currentProject()?.items ?? []);
  protected readonly projectName = computed(() => this.store.currentProject()?.name ?? '');

  protected readonly vorms = computed<RoomChoice[]>(() =>
    this.items()
      .filter((i): i is VormItem => i.kind === 'vorm')
      .map((v) => {
        const r = computeVorm(v);
        return { id: v.id, name: v.name, sides: r.status === 'ok' ? r.value.shape.sides : null };
      }),
  );
  protected readonly roofs = computed(() => this.items().filter((i): i is DakItem => i.kind === 'dak'));
  protected readonly belowChoices = computed(() => possibleBelow(this.item(), this.items()));
  protected readonly unusedVorms = computed(() => this.vorms().filter((v) => !this.item().rooms.some((r) => r.roomId === v.id)));

  protected readonly outcome = computed(() => computePlattegrond(this.item(), this.items()));
  protected readonly result = computed(() => {
    const o = this.outcome();
    return o.status === 'ok' ? o.value : null;
  });
  protected readonly plan = computed(() => this.result()?.plan ?? null);
  protected readonly levels = computed(() => (this.plan() ? computeBuilding(this.item(), this.items()) : []));
  protected readonly message = computed(() => {
    const o = this.outcome();
    return o.status === 'ok' ? null : o.message;
  });

  protected readonly roofList = computed(() => roofEntries(this.item()));

  protected setRoofs(roofs: RoofEntry[]): void {
    // The list replaces the single roof of older items.
    this.changed.emit({ ...this.item(), roofs, roofId: '' });
  }

  protected choicesFor(i: number): RoomChoice[] {
    const current = this.item().rooms[i]?.roomId;
    return this.vorms().filter((v) => v.id === current || !this.item().rooms.some((r) => r.roomId === v.id));
  }

  protected others(i: number): RoomChoice[] {
    const own = this.item().rooms[i]?.roomId;
    const ids = this.item().rooms.map((r) => r.roomId).filter((id) => id !== own);
    return this.vorms().filter((v) => ids.includes(v.id));
  }

  protected nameOf(id: string | undefined): string {
    return this.vorms().find((v) => v.id === id)?.name ?? 'die ruimte';
  }

  protected walls(id: string | undefined): { value: string; label: string }[] {
    const v = this.vorms().find((x) => x.id === id);
    const item = this.items().find((x) => x.id === id) as VormItem | undefined;
    if (!v || !item) return [];
    const n = item.sides.length;
    return Array.from({ length: n }, (_, i) => ({
      value: String(i),
      label: `${i + 1}–${((i + 1) % n) + 1}` + (v.sides ? ` (${formatLength(v.sides[i], 2)})` : ''),
    }));
  }

  protected shiftHint(i: number): string {
    const entry = this.item().rooms[i];
    const placed = this.plan()?.rooms.find((r) => r.id === entry.roomId);
    if (!entry.to || entry.toWall === undefined || entry.toWall === '') return 'Langs de muur, vanaf de hoek';
    const from = `hoekpunt ${+entry.toWall + 1} van ${this.nameOf(entry.to)}`;
    if (!placed || placed.shiftCorner === null) return `Vanaf ${from}`;
    return `Van ${from} tot hoekpunt ${placed.shiftCorner + 1} hier`;
  }

  protected roomStatus(id: string): string | null {
    const r = this.result();
    if (!r) return null;
    const name = this.vorms().find((v) => v.id === id)?.name;
    const incomplete = r.incompleteRooms.find((x) => x.name === name);
    if (incomplete) return `Nog niet compleet: ${incomplete.reason}`;
    const unplaced = r.plan.unplaced.find((x) => x.name === name);
    return unplaced ? unplaced.reason : null;
  }

  protected readonly notes = computed(() => {
    const r = this.result();
    if (!r) return [];
    const out = [...r.plan.warnings];
    if (r.roofProblem) out.push(r.roofProblem);
    if (r.assumedHeight.length) out.push(`Geen hoogte bij ${r.assumedHeight.join(', ')}: voor de tekening is 2,600 m aangenomen.`);
    return out;
  });

  protected readonly rows = computed<ResultRow[]>(() => {
    const r = this.result();
    if (!r) return [];
    const p = r.plan;
    const rows: ResultRow[] = [
      { label: 'Netto vloeroppervlak', value: formatArea(p.netArea), main: true },
      { label: 'Bruto (buitenwerks)', value: formatArea(p.grossArea) },
    ];
    if (p.voidArea > 0) rows.push({ label: 'Waarvan trapgat', value: formatArea(p.voidArea) }, { label: 'Vloer zonder trapgat', value: formatArea(p.netArea - p.voidArea) });
    if (p.volume !== null) rows.push({ label: 'Inhoud ruimtes', value: formatVolume(p.volume) });
    rows.push({ label: 'Binnenmuren', value: formatLength(p.partitionLength, 2) });
    const dim = (label: string, c: typeof p.width) => {
      rows.push({ label: `${label} berekend`, value: formatLength(c.computed) });
      if (c.diff !== null) {
        const ok = Math.abs(c.diff) <= 0.01;
        rows.push({ label: `${label} gemeten − berekend`, value: (c.diff > 0 ? '+' : '') + formatMm(c.diff), tone: ok ? 'ok' : 'warn' });
        if (!ok) rows.push({ label: `Dan is de buitenmuur`, value: `${formatLength(c.impliedWall)} dik` });
      }
    };
    dim('Breedte', p.width);
    dim('Diepte', p.depth);
    for (const roof of p.roofs) {
      const name = p.roofs.length > 1 ? ` (${roof.name})` : '';
      rows.push({ label: `Nok boven deze vloer${name}`, value: formatLength(roof.ridgeHeight) });
      if (roof.lengthDiff !== null && Math.abs(roof.lengthDiff) > 0.01) {
        rows.push({ label: `Lengte eronder min daklengte${name}`, value: formatMm(roof.lengthDiff), tone: 'warn' });
      }
      if (roof.dormers.length) rows.push({ label: `Dakkapellen${name}`, value: String(roof.dormers.length) });
      if (roof.windows.length) rows.push({ label: `Dakramen${name}`, value: String(roof.windows.length) });
    }
    const level = this.levels().find((l) => l.id === this.item().id);
    if (level && level.base > 0) rows.push({ label: 'Vloer boven begane grond', value: formatLength(level.base) });
    return rows;
  });

  protected set<K extends keyof PlattegrondItem>(field: K, value: PlattegrondItem[K]): void {
    this.changed.emit({ ...this.item(), [field]: value });
  }

  protected setRoom(i: number, patch: Partial<PlanRoomEntry>): void {
    const rooms = this.item().rooms.map((r, j) => (j === i ? { ...r, ...patch } : r));
    this.changed.emit({ ...this.item(), rooms });
  }

  protected addRoom(): void {
    const next = this.unusedVorms()[0];
    if (!next) return;
    const rooms = this.item().rooms;
    const entry: PlanRoomEntry =
      rooms.length === 0 ? { roomId: next.id } : { roomId: next.id, to: rooms[rooms.length - 1].roomId, wall: '', toWall: '', thickness: '0,100', offset: '0' };
    this.changed.emit({ ...this.item(), rooms: [...rooms, entry] });
  }

  protected readonly placedRooms = computed(() => this.vorms().filter((v) => this.item().rooms.some((r) => r.roomId === v.id)));

  protected setVoid(i: number, patch: Partial<VoidEntry>): void {
    const voids = (this.item().voids ?? []).map((v, j) => (j === i ? { ...v, ...patch } : v));
    this.changed.emit({ ...this.item(), voids });
  }

  protected addVoid(): void {
    const voids = this.item().voids ?? [];
    const entry: VoidEntry = { name: voids.length ? `trapgat ${voids.length + 1}` : 'trapgat', roomId: this.item().rooms[0]?.roomId ?? '', wall: '', offset: '', distance: '0', width: '', length: '' };
    this.changed.emit({ ...this.item(), voids: [...voids, entry] });
  }

  protected removeVoid(i: number): void {
    this.changed.emit({ ...this.item(), voids: (this.item().voids ?? []).filter((_, j) => j !== i) });
  }

  protected removeRoom(i: number): void {
    const removed = this.item().rooms[i].roomId;
    // Rooms that were placed against the removed one lose their link.
    const rooms = this.item()
      .rooms.filter((_, j) => j !== i)
      .map((r) => (r.to === removed ? { ...r, to: '', toWall: '' } : r));
    this.changed.emit({ ...this.item(), rooms });
  }

}

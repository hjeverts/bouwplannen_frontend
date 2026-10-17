import { Component, computed, inject, input, output } from '@angular/core';
import { roofSheet } from '../drawing/roof-sheet';
import { ProjectStore } from '../model/project-store';
import { PrintService } from '../ui/print';
import { centroid, Drawing, DrawingSpec, Mark, Segment } from '../drawing/drawing';
import { Point, RoofResult } from '../geometry/geometry';
import { formatAngle, formatArea, formatLength, formatMm, formatPercent } from '../geometry/units';
import { computeDak } from '../model/compute';
import { BuildupEntry, DakItem, emptyBuildup, emptyTiles, TileEntry } from '../model/models';
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
  | 'overhangRight'
  | 'gableOverhang'
  | 'gableOverhangEnd'
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
      <app-measure-field tag="o" [label]="eavesLabel('links')" [value]="item().overhang" (valueChange)="set('overhang', $event)" hint="Horizontaal, maakt de spar langer" />
      <app-measure-field
        tag="o"
        [label]="eavesLabel('rechts')"
        [value]="v('overhangRight')"
        (valueChange)="set('overhangRight', $event)"
        [placeholder]="item().overhang"
        hint="Leeg = als links; 0 = geen overstek"
      />
      <app-measure-field tag="D" label="Daklengte" [value]="item().length" (valueChange)="set('length', $event)" hint="Gevel tot gevel, zonder overstek" />
      <app-measure-field
        tag="o₂"
        label="Overstek kopgevel links / voor"
        [value]="v('gableOverhang')"
        (valueChange)="set('gableOverhang', $event)"
        hint="Links bij een nok evenwijdig aan de voorgevel, voor bij een nok van voor naar achter"
      />
      <app-measure-field
        tag="o₂"
        label="Overstek kopgevel rechts / achter"
        [value]="v('gableOverhangEnd')"
        (valueChange)="set('gableOverhangEnd', $event)"
        [placeholder]="v('gableOverhang')"
        hint="Leeg = als de andere kopgevel; 0 = geen overstek"
      />
    </div>
    <div class="split">
      <app-results [rows]="rows()" [message]="tooMany() ? null : message()" [state]="outcome().status" />
      <app-drawing [spec]="drawing()" ariaLabel="Doorsnede van het dak" />
    </div>
    @if (outcome().status === 'ok') {
      <div class="opening-actions">
        <button type="button" class="btn" (click)="printSheet()">Spant printen (A4)</button>
        <span class="hint">Doorsnede op schaal met alle maten, hoogtes, zaagsneden, latverdeling en materiaal.</span>
      </div>
    }

    <details class="more" [open]="hasBuildup()">
      <summary>Dakopbouw en hoogtes</summary>
      <p class="hint">
        Diktes haaks op het dak. De app rekent uit hoe hoog elke laag komt bij de muur, aan het einde van de overstek en in de nok: tot waar de muurplaat,
        sparren en nokbalk moeten komen, en hoeveel hoogte je onder de overstek overhoudt.
      </p>
      <div class="segmented segmented--small" role="radiogroup" aria-label="De dakmaten hierboven zijn">
        <button type="button" role="radio" [attr.aria-checked]="reference() === 'boven'" (click)="setBuildup('reference', 'boven')">Dakmaten = bovenkant pannen</button>
        <button type="button" role="radio" [attr.aria-checked]="reference() === 'onder'" (click)="setBuildup('reference', 'onder')">Dakmaten = onderkant spar</button>
      </div>
      <div class="fields fields--4 buildup-fields">
        <app-measure-field label="Hoogte spar / gording" [value]="b('rafter')" (valueChange)="setBuildup('rafter', $event)" hint="Balkhoogte haaks op het dak" />
        <app-measure-field label="Dakbeschot" [value]="b('deck')" (valueChange)="setBuildup('deck', $event)" hint="Of dakplaat / isolerend dakelement" />
        <app-measure-field label="Tengel" [value]="b('counter')" (valueChange)="setBuildup('counter', $event)" hint="Dikte" />
        <app-measure-field label="Panlat" [value]="b('batten')" (valueChange)="setBuildup('batten', $event)" hint="Dikte" />
        <app-measure-field label="Pan" [value]="b('tile')" (valueChange)="setBuildup('tile', $event)" hint="Hoogte van de pan, gelegd" />
      </div>
      @if (buildupMessage(); as m) {
        <p class="status status--error">{{ m }}</p>
      }
      @if (buildup(); as bu) {
        <p class="hint">{{ heightNote() }}</p>
        <app-results [rows]="buildupRows()" />
        <div class="table-scroll">
          <table class="buildup-table">
            <thead>
              <tr>
                <th scope="col">Hoogte van</th>
                @for (pt of bu.points; track pt.label) {
                  <th scope="col">{{ pt.label }}</th>
                }
              </tr>
            </thead>
            <tbody>
              @for (l of bu.lines.slice().reverse(); track l.name; let i = $index) {
                <tr>
                  <th scope="row">{{ l.name }}</th>
                  @for (pt of bu.points; track pt.label) {
                    <td>{{ fmt(pt.z[bu.lines.length - 1 - i]) }}</td>
                  }
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </details>

    <details class="more" [open]="hasTiles()">
      <summary>Dakpannen, panlatten en tengels</summary>
      <p class="hint">
        Neem de maten over van het blad van de fabrikant. Per dakvlak, langs de spar gemeten: de bovenste lat ligt een klein stukje onder de nok, dan
        volgen gelijke latafstanden, en onderaan de laatste latafstand tot het einde van de spar (met overstek), waar de gootlat ligt.
      </p>
      <h3 class="group-title">Pan</h3>
      <div class="fields fields--4">
        <app-measure-field label="Breedte pan" [value]="t('width')" (valueChange)="setTile('width', $event)" hint="b, van het blad" />
        <app-measure-field label="Lengte pan" [value]="t('length')" (valueChange)="setTile('length', $event)" hint="l, van het blad" />
        <app-measure-field label="Dekkende breedte" [value]="t('cover')" (valueChange)="setTile('cover', $event)" />
        <app-measure-field label="Latafstand" [value]="t('gauge')" (valueChange)="setTile('gauge', $event)" hint="Grootste latafstand" />
        <app-measure-field label="Kleinste latafstand" [value]="t('gaugeMin')" (valueChange)="setTile('gaugeMin', $event)" hint="Alleen bij een verschuifpan; leeg = vaste latafstand" />
        <app-measure-field label="Minimale dakhelling" kind="angle" [value]="t('minPitch')" (valueChange)="setTile('minPitch', $event)" />
        <label class="field field--text">
          <span class="field-label">Gewicht per pan</span>
          <span class="field-box">
            <input type="text" inputmode="decimal" [value]="t('weight')" (input)="setTile('weight', $any($event.target).value)" placeholder="" />
            <span class="field-unit">kg</span>
          </span>
        </label>
      </div>
      <h3 class="group-title">Latten en tengels</h3>
      <div class="fields fields--4">
        <app-measure-field label="Bovenste lat tot nok" [value]="t('ridgeGap')" (valueChange)="setTile('ridgeGap', $event)" placeholder="0,035" hint="Langs de spar, meestal 30–40 mm" />
        <app-measure-field label="Laatste latafstand" [value]="t('eavesGap')" (valueChange)="setTile('eavesGap', $event)" hint="Onderste lat tot het einde van de spar, bij de goot" />
        @if (tiles()?.counter === false) {
          <p class="hint">Geen tengels in de dakopbouw: de panlatten komen direct op de sporen.</p>
        } @else {
          <app-measure-field label="Tengels h.o.h." [value]="t('counterSpacing')" (valueChange)="setTile('counterSpacing', $event)" placeholder="0,600" hint="Meestal op elke spar" />
        }
      </div>
      <h3 class="group-title">Gevelpannen (als die er zijn)</h3>
      <div class="fields fields--4">
        <app-measure-field label="Gevelpan links / voor" [value]="t('vergeStart')" (valueChange)="setTile('vergeStart', $event)" hint="Dekkende breedte; leeg = geen" />
        <app-measure-field label="Gevelpan rechts / achter" [value]="t('vergeEnd')" (valueChange)="setTile('vergeEnd', $event)" hint="Dekkende breedte; leeg = geen" />
      </div>
      @if (hasTiles()) {
        <app-results [rows]="tileRows()" [message]="tileMessage()" [state]="tileMessage() ? 'incomplete' : 'ok'" />
        @for (w of tileWarnings(); track w) {
          <p class="status status--warn">{{ w }}</p>
        }
      }
    </details>
  `,
})
export class DakEditor {
  readonly item = input.required<DakItem>();
  readonly changed = output<DakItem>();

  private readonly printer = inject(PrintService);
  private readonly store = inject(ProjectStore);

  /** The work drawing of the truss on A4, for building from. */
  sheet(): string | null {
    const o = this.outcome();
    if (o.status !== 'ok') return null;
    return roofSheet(o.value, { project: this.store.currentProject()?.name ?? '', subject: this.item().name || 'Kap' });
  }

  protected printSheet(): void {
    const svg = this.sheet();
    if (svg) this.printer.print(svg);
  }

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

  protected b(field: keyof BuildupEntry): string {
    return (this.item().buildup?.[field] as string | undefined) ?? '';
  }

  protected readonly reference = computed(() => (this.item().buildup?.reference === 'onder' ? 'onder' : 'boven'));

  protected setBuildup(field: keyof BuildupEntry, value: string): void {
    this.changed.emit({ ...this.item(), buildup: { ...emptyBuildup(), ...this.item().buildup, [field]: value } as BuildupEntry });
  }

  protected readonly hasBuildup = computed(() => {
    const bu = this.item().buildup;
    return !!bu && (['rafter', 'deck', 'counter', 'batten', 'tile'] as const).some((k) => bu[k]?.trim());
  });

  protected readonly buildup = computed(() => {
    const o = this.outcome();
    return o.status === 'ok' ? o.value.buildup : null;
  });

  protected readonly buildupMessage = computed(() => {
    const o = this.outcome();
    return o.status === 'ok' ? o.value.buildupMessage : null;
  });

  protected fmt(m: number): string {
    return formatLength(m);
  }

  protected readonly heightNote = computed(() => {
    const r = this.roof();
    if (!r) return '';
    const what = this.reference() === 'boven' ? 'de bovenkant van de pannen' : 'de onderkant van de spar';
    return r.fromFloor
      ? `Hoogtes vanaf de vloer. De ingevoerde muurhoogtes en nok zijn ${what}.`
      : `Hoogtes vanaf de ingevoerde dakmaat bij de muur (${what} = 0). Vul de muurhoogtes in voor hoogtes vanaf de vloer.`;
  });

  protected readonly buildupRows = computed<ResultRow[]>(() => {
    const bu = this.buildup();
    if (!bu) return [];
    const rows: ResultRow[] = [{ label: 'Opbouw haaks op het dak', value: formatMm(bu.total) }];
    for (const p of bu.plumb) rows.push({ label: `${p.label}: opbouw verticaal gemeten`, value: formatMm(p.thickness) });
    const under = 0;
    const top = bu.lines.length - 1;
    for (const pt of bu.points) {
      if (pt.label.startsWith('Muur')) rows.push({ label: `${pt.label}: onderkant spar (muurplaat)`, value: formatLength(pt.z[under]), main: true });
      else if (pt.label.startsWith('Einde overstek')) rows.push({ label: `Onder het ${pt.label.toLowerCase()}`, value: formatLength(pt.z[under]) });
      else if (pt.label === 'Nok') {
        rows.push({ label: 'Nok: onderkant sparren (bovenkant nokbalk)', value: formatLength(pt.z[under]), main: true });
        if (this.reference() === 'onder') rows.push({ label: 'Nok: bovenkant pannen', value: formatLength(pt.z[top]) });
      }
    }
    return rows;
  });

  protected t(field: keyof TileEntry): string {
    return this.item().tiles?.[field] ?? '';
  }

  protected setTile(field: keyof TileEntry, value: string): void {
    this.changed.emit({ ...this.item(), tiles: { ...emptyTiles(), ...this.item().tiles, [field]: value } });
  }

  protected readonly hasTiles = computed(() => Object.values(this.item().tiles ?? {}).some((v) => String(v ?? '').trim()));

  protected readonly tiles = computed(() => {
    const o = this.outcome();
    return o.status === 'ok' ? o.value.tiles : null;
  });

  protected readonly tileMessage = computed(() => {
    const o = this.outcome();
    if (o.status !== 'ok') return 'Maak eerst het dak compleet.';
    return o.value.tilesMessage;
  });

  protected readonly tileWarnings = computed(() => this.tiles()?.warnings ?? []);

  protected readonly tileRows = computed<ResultRow[]>(() => {
    const t = this.tiles();
    if (!t || !t.planes.length) return [];
    const count = (n: number | null) => (n === null ? '–' : new Intl.NumberFormat('nl-NL').format(n));
    const rows: ResultRow[] = [];
    if (t.tiles !== null) {
      const verge = t.vergeTiles ? ` + ${count(t.vergeTiles)} gevelpannen` : '';
      rows.push({ label: 'Pannen', value: `${count(t.tiles)}${verge}`, main: true });
    } else {
      rows.push({ label: 'Pannen', value: 'vul de daklengte in', tone: 'warn' });
    }
    for (const p of t.planes) {
      const name = t.planes.length > 1 ? `${p.label.replace('Dakvlak ', '')}: ` : '';
      rows.push(
        { label: `${name}spar met overstek`, value: formatLength(p.slope) },
        { label: `${name}latafstand`, value: formatMm(p.gauge) },
        { label: `${name}bovenste lat tot nok`, value: formatMm(p.ridgeGap) },
        { label: `${name}laatste latafstand`, value: formatMm(p.eavesGap), tone: Math.abs(p.eavesDiff) > 0.005 ? 'warn' : undefined },
        { label: `${name}panlatten + gootlat`, value: `${p.battens} + 1` },
        { label: `${name}rijen pannen`, value: String(p.rows) },
      );
    }
    if (t.normalPerRow !== null) {
      rows.push({ label: 'Pannen per rij', value: t.vergePerRow ? `${t.normalPerRow} + ${t.vergePerRow} gevelpan${t.vergePerRow > 1 ? 'nen' : ''}` : String(t.normalPerRow) });
      rows.push({ label: 'Dekking langs de nok', value: `${formatLength(t.covered)} (dak ${formatLength(t.width)})` });
    }
    if (t.battenLength !== null) rows.push({ label: 'Panlatten totaal', value: formatLength(t.battenLength, 1) });
    if (!t.counter) rows.push({ label: 'Tengels', value: 'geen: panlatten op de sporen' });
    else if (t.counterBattens !== null) rows.push({ label: 'Tengels', value: `${t.counterBattens} stuks · ${formatLength(t.counterLength, 1)}` });
    rows.push({ label: 'Pannen per m² (blad)', value: new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 1 }).format(t.perM2) });
    if (t.headLap !== null) rows.push({ label: 'Overlap in de lengte', value: formatMm(t.headLap) });
    if (t.sideLap !== null) rows.push({ label: 'Overlap opzij', value: formatMm(t.sideLap) });
    if (t.weight !== null) rows.push({ label: 'Gewicht pannen', value: `${new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 0 }).format(t.weight)} kg` });
    return rows;
  });

  /** "Overstek goot links", for a lean-to with which side is low or high. */
  protected eavesLabel(side: 'links' | 'rechts'): string {
    if (this.type() !== 'lessenaarsdak') return `Overstek goot ${side}`;
    const r = this.roof();
    if (!r) return `Overstek ${side}`;
    const leftLow = r.plateLeft <= r.plateRight;
    return `Overstek ${side} (${(side === 'links') === leftLow ? 'lage' : 'hoge'} kant)`;
  }

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
        roof.overhangLeft === roof.overhangRight
          ? { label: 'Spar onderdak met overstek', value: formatLength(roof.left.rafterWithOverhang) }
          : { label: 'Spar onderdak met overstek links · rechts', value: `${formatLength(roof.left.rafterWithOverhang)} · ${formatLength(roof.right!.rafterWithOverhang)}` },
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
        { label: 'Spar met overstek (beide kanten)', value: formatLength(roof.left.rafterWithOverhang) },
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
    // The underside and the top of the build-up.
    const bu = this.buildup();
    if (bu) {
      for (const line of [bu.lines[0], bu.lines[bu.lines.length - 1]]) {
        if (Math.abs(line.offset) < 1e-9) continue;
        for (let i = 0; i + 1 < line.pts.length; i++) segments.push({ from: line.pts[i], to: line.pts[i + 1], style: 'dashed' });
      }
    }

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
  /** Along a slope of `pitch` degrees, for a level overhang `o`. */
  const along = (o: number, pitch: number) => o / Math.cos((pitch * Math.PI) / 180);
  if (roof.type === 'lessenaarsdak') {
    // The single slope runs out past both walls, each by its own overhang.
    for (const s of [ext(plateL, plateR, along(roof.overhangLeft, roof.left.pitch)), ext(plateR, plateL, along(roof.overhangRight, roof.left.pitch))]) if (s) out.push(s);
    return out;
  }
  const firstUp = roof.knee ?? roof.ridge;
  const l = ext(plateL, firstUp, along(roof.overhangLeft, roof.left.pitch));
  if (l) out.push(l);
  if (roof.right) {
    const kneeR = roof.knee ? { x: roof.span - roof.knee.x, y: roof.knee.y } : roof.ridge;
    const r = ext(plateR, kneeR, along(roof.overhangRight, roof.right.pitch));
    if (r) out.push(r);
  }
  return out;
}

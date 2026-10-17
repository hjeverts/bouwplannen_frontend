import { Component, computed, inject, input, output } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { afdakPlanSheet, afdakPlanView, afdakRafterSheet, afdakRafterView } from '../drawing/afdak-views';
import { heightFor, renderFitted, View } from '../drawing/vector';
import { formatAngle, formatLength, formatMm, lengthInput } from '../geometry/units';
import { computeAfdakItem } from '../model/compute-afdak';
import { AfdakItem, AfdakRoofEntry, AfdakSide, emptyAfdakRoof } from '../model/models';
import { ProjectStore } from '../model/project-store';
import { MeasureField } from '../ui/measure-field';
import { PrintService } from '../ui/print';
import { ResultRow, Results } from '../ui/results';

type Field = 'width' | 'depth' | 'wallOffset' | 'postWidth' | 'postDepth' | 'postsFront' | 'postsBack' | 'overhangSide' | 'overhangFront' | 'overhangBack' | 'footing' | 'wallThickness';

@Component({
  selector: 'app-afdak-editor',
  imports: [MeasureField, Results],
  template: `
    <p class="lead">
      Een afdak of overkapping op staanders. Van bovenaf: links–rechts is de breedte (langs het gebouw), de diepte gaat van het gebouw (of de achterkant) naar
      voren. De app tekent waar het hart van elke staander en poer komt, met de diagonalen om haaks uit te zetten.
    </p>

    <h3 class="group-title">Afmeting</h3>
    <div class="fields fields--3">
      <app-measure-field label="Breedte" [value]="item().width" (valueChange)="set('width', $event)" hint="Langs het gebouw, rand tot rand dak" />
      <app-measure-field label="Diepte" [value]="item().depth" (valueChange)="set('depth', $event)" hint="Van het gebouw tot de voorrand van het dak" />
      @if (item().attached) {
        <app-measure-field label="Vanaf hoek gebouw" [value]="item().wallOffset" (valueChange)="set('wallOffset', $event)" hint="Hoek gebouw tot linkerrand dak; leeg = niet nodig" />
      }
    </div>
    <label class="check"><input type="checkbox" [checked]="item().attached" (change)="setAttached(!item().attached)" /> Vast aan een gebouw (achterkant, geen staanders daar)</label>

    <h3 class="group-title">Staanders en poeren</h3>
    <div class="fields fields--4">
      <app-measure-field label="Staander breedte" [value]="item().postWidth" (valueChange)="set('postWidth', $event)" hint="Bijvoorbeeld 150 mm" />
      <app-measure-field label="Staander diepte" [value]="item().postDepth" (valueChange)="set('postDepth', $event)" [placeholder]="item().postWidth" hint="Leeg = vierkant" />
      <label class="field field--text">
        <span class="field-label">Aantal voor</span>
        <input type="number" min="1" step="1" inputmode="numeric" [value]="item().postsFront" (input)="set('postsFront', $any($event.target).value)" />
      </label>
      @if (!item().attached) {
        <label class="field field--text">
          <span class="field-label">Aantal achter</span>
          <input type="number" min="1" step="1" inputmode="numeric" [value]="item().postsBack" (input)="set('postsBack', $any($event.target).value)" />
        </label>
      }
      <app-measure-field label="Overstek zijkanten" [value]="item().overhangSide" (valueChange)="set('overhangSide', $event)" hint="Buitenkant staander tot rand dak" placeholder="0" />
      <app-measure-field label="Overstek voor" [value]="item().overhangFront" (valueChange)="set('overhangFront', $event)" hint="Buitenkant staander tot voorrand" placeholder="0" />
      @if (!item().attached) {
        <app-measure-field label="Overstek achter" [value]="item().overhangBack" (valueChange)="set('overhangBack', $event)" placeholder="0" />
      }
      <app-measure-field label="Poer" [value]="item().footing" (valueChange)="set('footing', $event)" hint="Vierkant; leeg = niet tekenen" />
    </div>

    <h3 class="group-title">Wanden</h3>
    <div class="check-row">
      @for (s of sides(); track s.side) {
        <label class="check"><input type="checkbox" [checked]="item().walls.includes(s.side)" (change)="toggleWall(s.side)" /> {{ s.label }}</label>
      }
    </div>
    @if (item().walls.length) {
      <div class="fields fields--3">
        <app-measure-field label="Wanddikte" [value]="item().wallThickness" (valueChange)="set('wallThickness', $event)" hint="Op de lijn van de staanders, gelijk met de buitenkant" />
      </div>
    }

    <details class="more" [open]="hasRoof()">
      <summary>Dak: liggers, sporen en kepen</summary>
      <p class="hint">
        De sporen liggen met een horizontale zit (vogelbek) op de liggers. De keep wordt nooit dieper dan de gekozen deel van de spoorhoogte, zodat de spoor sterk
        genoeg blijft. Vul twee van deze drie in: dakhelling, hoogte voorligger, hoogte achter; de derde rekent de app uit.
      </p>
      <div class="fields fields--3">
        <app-measure-field label="Dakhelling" kind="angle" [value]="rf('pitch')" (valueChange)="setRoof('pitch', $event)" [placeholder]="placeholder('pitch')" />
        <app-measure-field label="Hoogte voorligger" [value]="rf('frontHeight')" (valueChange)="setRoof('frontHeight', $event)" [placeholder]="placeholder('front')" hint="Bovenkant ligger op de staanders, vanaf de vloer" />
        <app-measure-field
          [label]="item().attached ? 'Hoogte ligger tegen gebouw' : 'Hoogte achterligger'"
          [value]="rf('backHeight')"
          (valueChange)="setRoof('backHeight', $event)"
          [placeholder]="placeholder('back')"
          hint="Bovenkant, vanaf de vloer"
        />
      </div>
      <div class="fields fields--4">
        <app-measure-field label="Voorligger breed" [value]="rf('beamWidth')" (valueChange)="setRoof('beamWidth', $event)" [placeholder]="item().postDepth || item().postWidth" hint="Voor–achter; leeg = als de staander" />
        <app-measure-field label="Voorligger hoog" [value]="rf('beamHeight')" (valueChange)="setRoof('beamHeight', $event)" />
        <app-measure-field
          [label]="item().attached ? 'Ligger tegen gebouw breed' : 'Achterligger breed'"
          [value]="rf('backWidth')"
          (valueChange)="setRoof('backWidth', $event)"
          [placeholder]="item().attached ? '' : item().postDepth || item().postWidth"
          hint="Voor–achter: waar de spoor op ligt"
        />
      </div>
      <div class="segmented segmented--small" role="radiogroup" aria-label="Ligger op de staanders">
        <button type="button" role="radio" [attr.aria-checked]="(item().roof?.beamAlign ?? 'midden') === 'midden'" (click)="setRoof('beamAlign', 'midden')">Ligger midden op de staander</button>
        <button type="button" role="radio" [attr.aria-checked]="item().roof?.beamAlign === 'voor'" (click)="setRoof('beamAlign', 'voor')">Gelijk met voorkant</button>
        <button type="button" role="radio" [attr.aria-checked]="item().roof?.beamAlign === 'achter'" (click)="setRoof('beamAlign', 'achter')">Gelijk met achterkant</button>
      </div>
      @if (item().attached) {
        <div class="segmented segmented--small" role="radiogroup" aria-label="Sporen aan de muurkant">
          <button type="button" role="radio" [attr.aria-checked]="(item().roof?.backFix ?? 'op') === 'op'" (click)="setRoof('backFix', 'op')">Spoor op de ligger (keep)</button>
          <button type="button" role="radio" [attr.aria-checked]="item().roof?.backFix === 'tegen'" (click)="setRoof('backFix', 'tegen')">Spoor tegen de ligger, geschroefd</button>
        </div>
        @if (item().roof?.backFix === 'tegen') {
          <p class="hint">De spoor eindigt met een loodsnede tegen de voorkant van de ligger en wordt daaraan vastgezet (schuin schroeven of een balkdrager). Geen keep aan de muurkant.</p>
          <div class="fields fields--3">
            <app-measure-field label="Bovenkant spoor t.o.v. ligger" [value]="rf('backOffset')" (valueChange)="setRoof('backOffset', $event)" placeholder="0" hint="0 = gelijk met de bovenkant; negatief = lager" />
            <app-measure-field label="Ligger tegen gebouw hoog" [value]="rf('backBeamHeight')" (valueChange)="setRoof('backBeamHeight', $event)" hint="Om te controleren dat de spoor op de ligger blijft" />
          </div>
        }
      }
      <div class="fields fields--4">
        <app-measure-field label="Spoor breed" [value]="rf('rafterWidth')" (valueChange)="setRoof('rafterWidth', $event)" />
        <app-measure-field label="Spoor hoog" [value]="rf('rafterHeight')" (valueChange)="setRoof('rafterHeight', $event)" />
        <app-measure-field label="Sporen h.o.h." [value]="rf('rafterSpacing')" (valueChange)="setRoof('rafterSpacing', $event)" placeholder="0,600" hint="Grootste afstand; buitenste gelijk met de rand" />
      </div>
      <div class="segmented segmented--small" role="radiogroup" aria-label="Keep hoogstens">
        <button type="button" role="radio" [attr.aria-checked]="(item().roof?.notch ?? '3') === '3'" (click)="setRoof('notch', '3')">Keep hoogstens 1/3 van de spoor</button>
        <button type="button" role="radio" [attr.aria-checked]="item().roof?.notch === '4'" (click)="setRoof('notch', '4')">Hoogstens 1/4</button>
      </div>
      @if (roofMessage(); as m) {
        <p class="status">{{ m }}</p>
      }
    </details>

    <app-results [rows]="rows()" [message]="message()" [state]="outcome().status" />
    @for (w of warnings(); track w) {
      <p class="status status--warn">{{ w }}</p>
    }

    @if (planSvg(); as svg) {
      <div class="hv-svg afdak-svg" [innerHTML]="svg"></div>
      <div class="opening-actions">
        <button type="button" class="btn" (click)="printPlan()">Uitzettekening printen (A4)</button>
      </div>
    }
    @if (rafterSvg(); as svg) {
      <div class="hv-svg afdak-svg" [innerHTML]="svg"></div>
      <div class="opening-actions">
        <button type="button" class="btn" (click)="printRafter()">Zaagtekening spoor printen (A4)</button>
      </div>
    }
  `,
})
export class AfdakEditor {
  readonly item = input.required<AfdakItem>();
  readonly changed = output<AfdakItem>();

  private readonly sanitizer = inject(DomSanitizer);
  private readonly printer = inject(PrintService);
  private readonly store = inject(ProjectStore);

  protected readonly outcome = computed(() => computeAfdakItem(this.item()));
  private readonly value = computed(() => {
    const o = this.outcome();
    return o.status === 'ok' ? o.value : null;
  });
  protected readonly message = computed(() => {
    const o = this.outcome();
    return o.status === 'ok' ? null : o.message;
  });
  protected readonly roofMessage = computed(() => this.value()?.roofMessage ?? null);
  protected readonly warnings = computed(() => [...(this.value()?.plan.warnings ?? []), ...(this.value()?.rafters?.warnings ?? [])]);
  protected readonly hasRoof = computed(() => Object.entries(this.item().roof ?? {}).some(([k, v]) => k !== 'notch' && String(v ?? '').trim()));

  protected readonly sides = computed(() =>
    (['links', 'rechts', 'voor', 'achter'] as AfdakSide[])
      .filter((s) => s !== 'achter' || !this.item().attached)
      .map((side) => ({ side, label: { links: 'Links', rechts: 'Rechts', voor: 'Voor', achter: 'Achter' }[side] })),
  );

  private svg(view: View | null): SafeHtml | null {
    if (!view) return null;
    const w = 800;
    const k = 3.8;
    return this.sanitizer.bypassSecurityTrustHtml(renderFitted(view, w, Math.max(240, heightFor(view, w, k, 3, 620)), k));
  }
  protected readonly planSvg = computed(() => {
    const v = this.value();
    return v ? this.svg(afdakPlanView(v)) : null;
  });
  protected readonly rafterSvg = computed(() => {
    const v = this.value();
    return v ? this.svg(afdakRafterView(v)) : null;
  });

  protected readonly rows = computed<ResultRow[]>(() => {
    const v = this.value();
    if (!v) return [];
    const { plan, rafters: r } = v;
    const rows: ResultRow[] = [{ label: 'Staanders', value: String(plan.posts.length), main: true }];
    if (plan.spacingFront !== null) rows.push({ label: 'Hart op hart (voor)', value: formatLength(plan.spacingFront) });
    if (plan.spacingBack !== null) rows.push({ label: 'Hart op hart (achter)', value: formatLength(plan.spacingBack) });
    rows.push({ label: plan.attached ? 'Muur tot hart staanders' : 'Hart achter tot hart voor', value: formatLength(plan.frontRow - (plan.backRow ?? 0)) });
    for (const d of plan.diagonals) rows.push({ label: `Diagonaal ${d.from.label}–${d.to.label}`, value: formatLength(d.length) });
    if (r) {
      rows.push(
        { label: 'Dakhelling', value: formatAngle(r.pitch, 1), main: true },
        { label: 'Sporen', value: `${r.xs.length} × ${formatLength(r.length)}` },
        { label: 'Sporen h.o.h.', value: formatLength(r.spacing) },
        { label: 'Bovenkant voorligger', value: formatLength(r.frontHeight) },
        { label: plan.attached ? 'Bovenkant ligger tegen gebouw' : 'Bovenkant achterligger', value: formatLength(r.backHeight) },
        { label: 'Staanders voor, lengte', value: formatLength(r.frontPost) },
      );
      if (r.backPost !== null) rows.push({ label: 'Staanders achter, lengte', value: formatLength(r.backPost) });
      for (const st of r.seats) {
        if (st.against) rows.push({ label: `Spoor tegen ${st.name.toLowerCase()}`, value: `loodsnede ${formatMm(st.plumb)} hoog` });
        else rows.push({ label: `Keep ${st.name.toLowerCase()}`, value: `zit ${formatMm(st.length)} · ${formatMm(st.depth)} diep · ${formatMm(st.left)} over` });
      }
    }
    return rows;
  });

  /** What the app works out for the field left empty. */
  protected placeholder(which: 'pitch' | 'front' | 'back'): string {
    const r = this.value()?.rafters;
    if (!r) return '';
    if (which === 'pitch') return `≈ ${formatAngle(r.pitch, 1)}`;
    return lengthInput(which === 'front' ? r.frontHeight : r.backHeight, 'm');
  }

  protected set(field: Field, value: string): void {
    this.changed.emit({ ...this.item(), [field]: value });
  }

  protected setAttached(attached: boolean): void {
    // A building at the back has no back wall of its own.
    this.changed.emit({ ...this.item(), attached, walls: attached ? this.item().walls.filter((w) => w !== 'achter') : this.item().walls });
  }

  protected toggleWall(side: AfdakSide): void {
    const walls = this.item().walls.includes(side) ? this.item().walls.filter((w) => w !== side) : [...this.item().walls, side];
    this.changed.emit({ ...this.item(), walls });
  }

  protected rf(field: keyof AfdakRoofEntry): string {
    return (this.item().roof?.[field] as string | undefined) ?? '';
  }

  protected setRoof(field: keyof AfdakRoofEntry, value: string): void {
    this.changed.emit({ ...this.item(), roof: { ...emptyAfdakRoof(), ...this.item().roof, [field]: value } as AfdakRoofEntry });
  }

  private meta(subject: string) {
    return { project: this.store.currentProject()?.name ?? '', subject: `${this.item().name} · ${subject}` };
  }

  protected printPlan(): void {
    const v = this.value();
    if (v) this.printer.print(afdakPlanSheet(v, this.meta('uitzetten')));
  }

  protected printRafter(): void {
    const v = this.value();
    const svg = v && afdakRafterSheet(v, this.meta('spoor'));
    if (svg) this.printer.print(svg);
  }
}

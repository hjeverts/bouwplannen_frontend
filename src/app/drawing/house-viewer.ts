import { Component, computed, DestroyRef, ElementRef, inject, input, signal } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Level } from '../geometry/building';
import { FloorPlan } from '../geometry/floorplan';
import { planContext, voidsFromAbove } from '../model/compute-plan';
import { PrintService } from '../ui/print';
import { safeFilename } from '../ui/transfer';
import { cutawayView, elevationView, exteriorView, planView, Side, SIDE_LABELS } from './house-views';
import { overviewSheet, singleSheet } from './sheet';
import { heightFor, renderFitted, View } from './vector';

type Tab = 'plan' | '3d' | 'gevels';
const SIDES: Side[] = ['voor', 'rechts', 'achter', 'links'];

/**
 * Floor plan, 3D view and elevations of a floor (and the floors above and below it), with
 * printing on A4 at scale.
 */
@Component({
  selector: 'app-house-viewer',
  template: `
    <div class="hv">
      <div class="hv-bar">
        <div class="segmented segmented--small" role="radiogroup" aria-label="Weergave">
          <button type="button" role="radio" [attr.aria-checked]="tab() === 'plan'" (click)="tab.set('plan')">Plattegrond</button>
          <button type="button" role="radio" [attr.aria-checked]="tab() === '3d'" (click)="tab.set('3d')">3D</button>
          <button type="button" role="radio" [attr.aria-checked]="tab() === 'gevels'" (click)="tab.set('gevels')">Gevels</button>
        </div>
        <div class="hv-actions">
          <button type="button" class="btn btn--quiet" (click)="printCurrent()">{{ tab() === 'gevels' ? 'Gevels printen' : 'Printen' }}</button>
          <button type="button" class="btn" (click)="printOverview()">A4-overzicht</button>
        </div>
      </div>

      @switch (tab()) {
        @case ('plan') {
          <div class="hv-svg" [innerHTML]="planSvg()"></div>
          <label class="check hv-check"><input type="checkbox" [checked]="roomDims()" (change)="roomDims.set(!roomDims())" /> Maten in de ruimtes</label>
        }
        @case ('3d') {
          <div
            class="hv-svg hv-svg--3d"
            [innerHTML]="svg3d()"
            (pointerdown)="start($event)"
            (pointermove)="move($event)"
            (pointerup)="end($event)"
            (pointercancel)="end($event)"
            role="img"
            aria-label="3D-weergave, draai door te slepen"
          ></div>
          <div class="hv-3dbar">
            <div class="segmented segmented--small" role="radiogroup" aria-label="3D">
              <button type="button" role="radio" [attr.aria-checked]="mode() === 'buiten'" (click)="mode.set('buiten')">Buiten{{ levels().length > 1 ? ' (gebouw)' : '' }}</button>
              <button type="button" role="radio" [attr.aria-checked]="mode() === 'binnen'" (click)="mode.set('binnen')">Binnen (deze verdieping)</button>
            </div>
            <label class="r3d-range" for="hv-az">
              <span>Draaien</span>
              <input id="hv-az" type="range" min="-180" max="180" step="1" [value]="azimuth()" (input)="azimuth.set(+$any($event.target).value)" />
            </label>
            <label class="r3d-range" for="hv-el">
              <span>Kantelen</span>
              <input id="hv-el" type="range" min="0" max="85" step="1" [value]="elevation()" (input)="elevation.set(+$any($event.target).value)" />
            </label>
          </div>
        }
        @case ('gevels') {
          <div class="hv-grid">
            @for (e of elevationSvgs(); track e.side) {
              <figure class="hv-fig">
                <figcaption>
                  <span>{{ e.label }}</span>
                  <button type="button" class="btn btn--quiet btn--small" (click)="printSide(e.side)">Printen</button>
                </figcaption>
                <div class="hv-svg" [innerHTML]="e.svg"></div>
              </figure>
            }
          </div>
          <p class="hint">Voorgevel = onderkant van de plattegrond. Een andere kant als voorkant? Draai de plattegrond.</p>
        }
      }
    </div>
  `,
})
export class HouseViewer {
  readonly plan = input.required<FloorPlan>();
  readonly levels = input.required<Level[]>();
  readonly levelId = input.required<string>();
  readonly projectName = input('');
  readonly itemName = input('');

  private readonly sanitizer = inject(DomSanitizer);
  private readonly printer = inject(PrintService);
  private readonly host = inject(ElementRef<HTMLElement>);

  protected readonly tab = signal<Tab>('plan');
  protected readonly mode = signal<'buiten' | 'binnen'>('buiten');
  protected readonly roomDims = signal(true);
  protected readonly azimuth = signal(-35);
  protected readonly elevation = signal(28);
  protected readonly sides = SIDES;
  private readonly width = signal(640);
  private drag: { x: number; y: number; az: number; el: number; id: number } | null = null;

  constructor() {
    const el = this.host.nativeElement as HTMLElement;
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver((entries) => {
        const w = Math.round(entries[0]?.contentRect.width ?? 0);
        if (w > 0 && Math.abs(w - this.width()) > 4) this.width.set(w);
      });
      ro.observe(el);
      inject(DestroyRef).onDestroy(() => ro.disconnect());
    }
  }

  /** Pixels per paper millimetre: text stays readable on a phone without crowding a tablet. */
  private readonly k = computed(() => (this.width() < 520 ? 3.6 : 3.8));
  private readonly maxHeight = () => (typeof window !== 'undefined' ? Math.max(320, window.innerHeight * 0.72) : 600);

  private readonly level = computed(() => this.levels().find((l) => l.id === this.levelId()) ?? null);

  private svg(view: View, width: number): SafeHtml {
    const k = this.k();
    const h = Math.max(160, heightFor(view, width, k, 3, this.maxHeight()));
    return this.sanitizer.bypassSecurityTrustHtml(renderFitted(view, width, h, k));
  }

  private readonly fromAbove = computed(() => voidsFromAbove(this.levels(), this.levelId()));
  private readonly context = computed(() => planContext(this.levels(), this.levelId()));
  private readonly planViewModel = computed(() =>
    planView(this.plan(), { roomDims: this.roomDims(), fromAbove: this.fromAbove(), ...this.context(), title: `Plattegrond ${this.itemName()}` }),
  );
  protected readonly planSvg = computed(() => this.svg(this.planViewModel(), this.width()));

  private readonly view3d = computed<View>(() => {
    const cam = { azimuth: this.azimuth(), elevation: this.elevation() };
    const level = this.level();
    if (this.mode() === 'binnen' && level) {
      const host = level.open ? this.levels().find((l) => l.id === level.below) : undefined;
      return cutawayView(level, cam, `${this.itemName()} van binnen`, host);
    }
    return exteriorView(this.levels().length ? this.levels() : [], cam, '3D');
  });
  protected readonly svg3d = computed(() => {
    const view = this.view3d();
    const w = this.width();
    const h = Math.min(this.maxHeight(), Math.max(280, w * 0.68));
    return this.sanitizer.bypassSecurityTrustHtml(renderFitted(view, w, h, this.k(), 2));
  });

  private readonly elevations = computed(() => SIDES.map((side) => elevationView(this.levels(), side)));
  protected readonly elevationSvgs = computed(() => {
    const w = this.width() < 700 ? this.width() : Math.floor((this.width() - 16) / 2);
    return this.elevations().map((view, i) => ({ side: SIDES[i], label: SIDE_LABELS[SIDES[i]], svg: this.svg(view, w) }));
  });

  protected start(e: PointerEvent): void {
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    this.drag = { x: e.clientX, y: e.clientY, az: this.azimuth(), el: this.elevation(), id: e.pointerId };
  }

  protected move(e: PointerEvent): void {
    if (!this.drag || e.pointerId !== this.drag.id) return;
    const az = this.drag.az - (e.clientX - this.drag.x) * 0.5;
    this.azimuth.set(((((az + 180) % 360) + 360) % 360) - 180);
    this.elevation.set(Math.min(85, Math.max(0, this.drag.el + (e.clientY - this.drag.y) * 0.4)));
  }

  protected end(e: PointerEvent): void {
    if (this.drag?.id === e.pointerId) this.drag = null;
  }

  private meta(subject: string) {
    return { project: this.projectName(), subject };
  }

  /** The current tab on one A4 page (elevations: all four on one page). */
  protected printCurrent(): void {
    this.printer.print(this.currentSheet());
  }

  currentSheet(): string {
    switch (this.tab()) {
      case 'plan':
        return singleSheet(this.planViewModel(), this.meta(`Plattegrond ${this.itemName()}`));
      case '3d':
        return singleSheet(this.view3d(), this.meta(this.mode() === 'binnen' ? `${this.itemName()} van binnen` : '3D-overzicht'));
      case 'gevels':
        return this.overview(false);
    }
  }

  protected printSide(side: Side): void {
    const view = this.elevations()[SIDES.indexOf(side)];
    this.printer.print(singleSheet(view, this.meta(SIDE_LABELS[side])));
  }

  protected printOverview(): void {
    this.printer.print(this.overview(true));
  }

  /** A4 with the 3D view, the plan of this floor and the four elevations. */
  overview(withPlan: boolean): string {
    const view3d = exteriorView(this.levels(), { azimuth: -35, elevation: 25 }, '3D-overzicht');
    const plan = withPlan ? planView(this.plan(), { roomDims: false, fromAbove: this.fromAbove(), ...this.context(), title: `Plattegrond ${this.itemName()}` }) : null;
    // On the overview the elevations keep their main dimensions only, so they stay readable at 1:200.
    const elevations = SIDES.map((side) => elevationView(this.levels(), side, { chains: false }));
    const views = { view3d, plan, elevations };
    return overviewSheet(views, this.meta(withPlan ? `Overzicht ${this.itemName()}` : 'Gevels'));
  }

  /** File name for downloads of the sheet. */
  filename(): string {
    return `${safeFilename(this.projectName() || 'bouwplannen')}-${safeFilename(this.itemName() || 'plattegrond')}.svg`;
  }
}

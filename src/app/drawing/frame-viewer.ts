import { Component, computed, DestroyRef, ElementRef, inject, input, signal } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { buildFrame, MemberKind } from '../geometry/frame3d';
import { DakResult } from '../model/compute';
import { PrintService } from '../ui/print';
import { framePieces, frameView, FrameViewOptions, MEMBER_COLOURS, MEMBER_NAMES } from './frame-views';
import { singleSheet } from './sheet';
import { renderFitted, View } from './vector';

/**
 * The roof construction in 3D, to turn by dragging: every post, beam, rafter, counter batten and
 * batten as timber, with the tiles, decking and walls see-through or left out.
 */
@Component({
  selector: 'app-frame-viewer',
  styles: [':host { display: block; }'],
  template: `
    @if (notes().blocking; as m) {
      <p class="status status--incomplete">{{ m }}</p>
    } @else {
      <div
        class="hv-svg hv-svg--3d"
        [innerHTML]="svg()"
        (pointerdown)="start($event)"
        (pointermove)="move($event)"
        (pointerup)="end($event)"
        (pointercancel)="end($event)"
        role="img"
        aria-label="Constructie in 3D, draai door te slepen"
      ></div>
      <div class="hv-3dbar">
        <label class="r3d-range" for="f3d-az">
          <span>Draaien</span>
          <input id="f3d-az" type="range" min="-180" max="180" step="1" [value]="azimuth()" (input)="azimuth.set(+$any($event.target).value)" />
        </label>
        <label class="r3d-range" for="f3d-el">
          <span>Kantelen</span>
          <input id="f3d-el" type="range" min="-30" max="85" step="1" [value]="elevation()" (input)="elevation.set(+$any($event.target).value)" />
        </label>
      </div>
      <div class="check-row">
        <div class="segmented segmented--small" role="radiogroup" aria-label="Pannen en dakbeschot">
          <span class="seg-label">Pannen, beschot</span>
          <button type="button" role="radio" [attr.aria-checked]="cover() === 'doorzichtig'" (click)="cover.set('doorzichtig')">Doorzichtig</button>
          <button type="button" role="radio" [attr.aria-checked]="cover() === 'uit'" (click)="cover.set('uit')">Uit</button>
        </div>
        <div class="segmented segmented--small" role="radiogroup" aria-label="Wanden">
          <span class="seg-label">Wanden</span>
          <button type="button" role="radio" [attr.aria-checked]="walls() === 'doorzichtig'" (click)="walls.set('doorzichtig')">Doorzichtig</button>
          <button type="button" role="radio" [attr.aria-checked]="walls() === 'uit'" (click)="walls.set('uit')">Uit</button>
        </div>
        <label class="check"><input type="checkbox" [checked]="battens()" (change)="battens.set(!battens())" /> Panlatten en tengels</label>
      </div>
      <ul class="f3d-legend">
        @for (k of kinds(); track k) {
          <li><span class="f3d-swatch" [style.background]="colour(k)"></span>{{ label(k) }}</li>
        }
      </ul>
      @for (n of notes().info; track n) {
        <p class="hint">{{ n }}</p>
      }
      <div class="opening-actions">
        <button type="button" class="btn btn--quiet" (click)="print()">3D printen (A4)</button>
      </div>
    }
  `,
})
export class FrameViewer {
  readonly dak = input.required<DakResult>();
  readonly project = input('');
  readonly name = input('Kap');

  private readonly sanitizer = inject(DomSanitizer);
  private readonly printer = inject(PrintService);
  private readonly host = inject(ElementRef<HTMLElement>);

  protected readonly azimuth = signal(-35);
  protected readonly elevation = signal(28);
  protected readonly cover = signal<FrameViewOptions['cover']>('doorzichtig');
  protected readonly walls = signal<FrameViewOptions['walls']>('doorzichtig');
  protected readonly battens = signal(true);
  private readonly width = signal(640);
  /** While turning a big roof: without battens and counter battens, so it keeps up with the finger. */
  private readonly dragging = signal(false);
  private readonly heavy = computed(() => this.pieces().length > 1500);
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

  private readonly frame = computed(() => buildFrame(this.dak()));
  /** The blocks only change with the roof, not when the view turns. */
  private readonly pieces = computed(() => framePieces(this.frame()));

  protected readonly notes = computed(() => {
    const f = this.frame();
    return { blocking: f.members.length ? null : (f.notes[0] ?? 'Nog geen constructie om te tekenen.'), info: f.members.length ? f.notes : [] };
  });

  protected readonly kinds = computed(() => {
    const present = new Set(this.frame().members.map((m) => m.kind));
    return (Object.keys(MEMBER_NAMES) as MemberKind[]).filter((k) => present.has(k) && (this.battens() || (k !== 'batten' && k !== 'counter')));
  });
  protected colour(k: MemberKind): string {
    return `rgb(${MEMBER_COLOURS[k].join(',')})`;
  }
  protected label(k: MemberKind): string {
    return MEMBER_NAMES[k];
  }

  private view(title?: string, light = false): View {
    const battens = this.battens() && !light;
    return frameView(this.frame(), this.pieces(), { azimuth: this.azimuth(), elevation: this.elevation() }, { cover: this.cover(), walls: this.walls(), battens, title });
  }

  protected readonly svg = computed(() => {
    const w = this.width();
    const maxH = typeof window !== 'undefined' ? Math.max(320, window.innerHeight * 0.72) : 600;
    const h = Math.min(maxH, Math.max(280, w * 0.68));
    return this.sanitizer.bypassSecurityTrustHtml(renderFitted(this.view(undefined, this.dragging() && this.heavy()), w, h, w < 520 ? 3.6 : 3.8, 2));
  });

  /** The view as it is now, on A4 (for "Alles printen" too). */
  sheet(): string | null {
    if (!this.frame().members.length) return null;
    return singleSheet(this.view('Constructie in 3D'), { project: this.project(), subject: `${this.name()} · 3D-constructie` });
  }

  protected print(): void {
    const s = this.sheet();
    if (s) this.printer.print(s);
  }

  protected start(e: PointerEvent): void {
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    this.drag = { x: e.clientX, y: e.clientY, az: this.azimuth(), el: this.elevation(), id: e.pointerId };
    this.dragging.set(true);
  }

  protected move(e: PointerEvent): void {
    if (!this.drag || e.pointerId !== this.drag.id) return;
    const az = this.drag.az - (e.clientX - this.drag.x) * 0.5;
    this.azimuth.set(((((az + 180) % 360) + 360) % 360) - 180);
    this.elevation.set(Math.min(85, Math.max(-30, this.drag.el + (e.clientY - this.drag.y) * 0.4)));
  }

  protected end(e: PointerEvent): void {
    if (this.drag?.id === e.pointerId) {
      this.drag = null;
      this.dragging.set(false);
    }
  }
}

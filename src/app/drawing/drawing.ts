import { Component, computed, input } from '@angular/core';
import { Point } from '../geometry/geometry';

export interface Segment {
  from: Point;
  to: Point;
  label?: string;
  style?: 'wall' | 'dashed' | 'mark';
  /** Put the label on the side facing away from this point (e.g. the centroid of the shape). */
  awayFrom?: Point;
}

export interface Mark {
  at: Point;
  text: string;
  kind: 'vertex' | 'angle' | 'note';
  /** For angle marks: nudge the label from the vertex towards this point. */
  toward?: Point;
}

export interface DrawingSpec {
  fill?: Point[];
  segments: Segment[];
  marks: Mark[];
}

export function centroid(points: Point[]): Point {
  const n = points.length || 1;
  return { x: points.reduce((s, p) => s + p.x, 0) / n, y: points.reduce((s, p) => s + p.y, 0) / n };
}

/** Closed shape with side lengths, numbered corners and interior angles. */
export function polygonSpec(points: Point[], sideLabels: string[], angleLabels: string[], extra: Segment[] = []): DrawingSpec {
  const c = centroid(points);
  const segments: Segment[] = points.map((p, i) => ({
    from: p,
    to: points[(i + 1) % points.length],
    label: sideLabels[i],
    style: 'wall',
    awayFrom: c,
  }));
  const marks: Mark[] = [];
  points.forEach((p, i) => {
    marks.push({ at: p, text: String(i + 1), kind: 'vertex', toward: c });
    if (angleLabels[i]) marks.push({ at: p, text: angleLabels[i], kind: 'angle', toward: c });
  });
  return { fill: points, segments: [...extra, ...segments], marks };
}

const W = 640;
const H = 420;
const PAD = 56;

interface Placed {
  x: number;
  y: number;
}

/**
 * Scale drawing of a measured shape. Lengths are in metres, y points up;
 * the component fits everything into a fixed viewBox and keeps the proportions true.
 */
@Component({
  selector: 'app-drawing',
  template: `
    <svg [attr.viewBox]="'0 0 ' + W + ' ' + H" role="img" [attr.aria-label]="ariaLabel()" class="drawing">
      @if (view(); as v) {
        @if (v.fill) {
          <polygon [attr.points]="v.fill" class="d-fill" />
        }
        @for (s of v.segments; track $index) {
          <line [attr.x1]="s.x1" [attr.y1]="s.y1" [attr.x2]="s.x2" [attr.y2]="s.y2" [class]="'d-' + s.style" />
        }
        @for (s of v.segments; track $index) {
          @if (s.label) {
            <text [attr.x]="s.lx" [attr.y]="s.ly" class="d-dim" [attr.text-anchor]="s.anchor" dominant-baseline="middle">{{ s.label }}</text>
          }
        }
        @for (m of v.marks; track $index) {
          @if (m.kind === 'vertex') {
            <circle [attr.cx]="m.px" [attr.cy]="m.py" r="4" class="d-node" />
            <text [attr.x]="m.x" [attr.y]="m.y" class="d-vertex" text-anchor="middle" dominant-baseline="middle">{{ m.text }}</text>
          } @else {
            <text [attr.x]="m.x" [attr.y]="m.y" [class]="m.kind === 'angle' ? 'd-angle' : 'd-note'" text-anchor="middle" dominant-baseline="middle">
              {{ m.text }}
            </text>
          }
        }
      } @else {
        <text [attr.x]="W / 2" [attr.y]="H / 2" class="d-empty" text-anchor="middle">{{ emptyText() }}</text>
      }
    </svg>
  `,
})
export class Drawing {
  readonly spec = input<DrawingSpec | null>(null);
  readonly ariaLabel = input('Schets op schaal');
  readonly emptyText = input('De schets verschijnt zodra alle maten zijn ingevuld');
  protected readonly W = W;
  protected readonly H = H;

  protected readonly view = computed(() => {
    const spec = this.spec();
    if (!spec || spec.segments.length === 0) return null;
    const all = [...spec.segments.flatMap((s) => [s.from, s.to]), ...spec.marks.map((m) => m.at)];
    const minX = Math.min(...all.map((p) => p.x));
    const maxX = Math.max(...all.map((p) => p.x));
    const minY = Math.min(...all.map((p) => p.y));
    const maxY = Math.max(...all.map((p) => p.y));
    const w = Math.max(maxX - minX, 1e-6);
    const h = Math.max(maxY - minY, 1e-6);
    const scale = Math.min((W - 2 * PAD) / w, (H - 2 * PAD) / h);
    const ox = (W - w * scale) / 2;
    const oy = (H - h * scale) / 2;
    const tx = (p: Point): Placed => ({ x: ox + (p.x - minX) * scale, y: H - (oy + (p.y - minY) * scale) });

    const segments = spec.segments.map((s) => {
      const a = tx(s.from);
      const b = tx(s.to);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      let nx = -(b.y - a.y) / len;
      let ny = (b.x - a.x) / len;
      if (s.awayFrom) {
        const c = tx(s.awayFrom);
        if ((mx - c.x) * nx + (my - c.y) * ny < 0) {
          nx = -nx;
          ny = -ny;
        }
      }
      // Labels beside a steep line grow away from it (start/end anchor); beside a flat line they sit centred above/below.
      const anchor = nx > 0.4 ? 'start' : nx < -0.4 ? 'end' : 'middle';
      const off = anchor === 'middle' ? 18 : 10;
      return {
        x1: a.x,
        y1: a.y,
        x2: b.x,
        y2: b.y,
        style: s.style ?? 'wall',
        label: s.label,
        lx: mx + nx * off,
        ly: my + ny * (anchor === 'middle' ? off : off * 0.6),
        anchor,
      };
    });

    const marks = spec.marks.map((m) => {
      const p = tx(m.at);
      let x = p.x;
      let y = p.y;
      if (m.toward) {
        const t = tx(m.toward);
        const d = Math.hypot(t.x - p.x, t.y - p.y) || 1;
        const dist = m.kind === 'vertex' ? -16 : 34;
        x = p.x + ((t.x - p.x) / d) * dist;
        y = p.y + ((t.y - p.y) / d) * dist;
      }
      return { ...m, x, y, px: p.x, py: p.y };
    });

    const fill = spec.fill?.map((p) => tx(p)).map((p) => `${p.x},${p.y}`).join(' ');
    return { segments, marks, fill };
  });
}

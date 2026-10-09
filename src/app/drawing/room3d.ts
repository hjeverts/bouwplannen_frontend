import { Component, computed, input, signal } from '@angular/core';
import { Point } from '../geometry/geometry';
import { RoomResult, wallHeightAt } from '../geometry/room';

interface P3 {
  x: number;
  y: number;
  z: number;
}

interface Face {
  kind: 'floor' | 'wall-far' | 'wall-near' | 'ceiling';
  d: string;
  depth: number;
}

interface Label {
  x: number;
  y: number;
  text: string;
  kind: 'corner' | 'opening';
}

const W = 640;
const H = 440;
const PAD = 36;
const DEG = Math.PI / 180;

/**
 * Rotatable 3D view of a room: floor, walls with their openings cut out, sloped ceiling.
 * Walls between the viewer and the room are drawn as outlines only, like a doll's house,
 * so you always look into the room. Drag to rotate, or use the slider.
 */
@Component({
  selector: 'app-room3d',
  template: `
    <div class="r3d">
      <svg
        [attr.viewBox]="'0 0 ' + W + ' ' + H"
        class="drawing drawing--3d"
        role="img"
        aria-label="3D-weergave van de ruimte, draai door te slepen"
        (pointerdown)="start($event)"
        (pointermove)="move($event)"
        (pointerup)="end($event)"
        (pointercancel)="end($event)"
      >
        @for (f of scene().faces; track $index) {
          <path [attr.d]="f.d" [class]="'r3d-' + f.kind" fill-rule="evenodd" />
        }
        @for (l of scene().labels; track $index) {
          <text [attr.x]="l.x" [attr.y]="l.y" [class]="'r3d-label r3d-label--' + l.kind" text-anchor="middle" dominant-baseline="middle">{{ l.text }}</text>
        }
      </svg>
      <div class="r3d-controls">
        <label class="r3d-range" for="r3d-az">
          <span>Draaien</span>
          <input id="r3d-az" type="range" min="-180" max="180" step="1" [value]="azimuth()" (input)="azimuth.set(+$any($event.target).value)" />
        </label>
        <label class="r3d-range" for="r3d-el">
          <span>Kantelen</span>
          <input id="r3d-el" type="range" min="5" max="85" step="1" [value]="elevation()" (input)="elevation.set(+$any($event.target).value)" />
        </label>
      </div>
    </div>
  `,
})
export class Room3d {
  readonly points = input.required<Point[]>();
  readonly room = input.required<RoomResult>();

  protected readonly W = W;
  protected readonly H = H;
  protected readonly azimuth = signal(-30);
  protected readonly elevation = signal(32);
  private drag: { x: number; y: number; az: number; el: number; id: number } | null = null;

  protected start(e: PointerEvent): void {
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    this.drag = { x: e.clientX, y: e.clientY, az: this.azimuth(), el: this.elevation(), id: e.pointerId };
  }

  protected move(e: PointerEvent): void {
    if (!this.drag || e.pointerId !== this.drag.id) return;
    const az = this.drag.az - (e.clientX - this.drag.x) * 0.5;
    this.azimuth.set(((((az + 180) % 360) + 360) % 360) - 180);
    this.elevation.set(Math.min(85, Math.max(5, this.drag.el + (e.clientY - this.drag.y) * 0.4)));
  }

  protected end(e: PointerEvent): void {
    if (this.drag?.id === e.pointerId) this.drag = null;
  }

  protected readonly scene = computed(() => {
    const pts = this.points();
    const room = this.room();
    const az = this.azimuth() * DEG;
    const el = this.elevation() * DEG;
    const n = pts.length;
    const cx = pts.reduce((s, p) => s + p.x, 0) / n;
    const cy = pts.reduce((s, p) => s + p.y, 0) / n;

    // Orthographic camera: rotate around the vertical axis, then tilt towards the viewer.
    const view = (p: P3) => {
      const x = p.x - cx;
      const y = p.y - cy;
      const x1 = x * Math.cos(az) - y * Math.sin(az);
      const y1 = x * Math.sin(az) + y * Math.cos(az);
      return { sx: x1, sy: p.z * Math.cos(el) + y1 * Math.sin(el), depth: y1 * Math.cos(el) - p.z * Math.sin(el) };
    };
    // Direction from the room towards the camera, in floor coordinates (for front/back walls).
    const toCamera = { x: Math.sin(az), y: -Math.cos(az) };

    // Fit to the drawing area using every corner at floor and ceiling height.
    const heightAt = (i: number) => room.walls[i].heightFrom;
    const all = pts.flatMap((p, i) => [view({ ...p, z: 0 }), view({ ...p, z: heightAt(i) })]);
    const minX = Math.min(...all.map((v) => v.sx));
    const maxX = Math.max(...all.map((v) => v.sx));
    const minY = Math.min(...all.map((v) => v.sy));
    const maxY = Math.max(...all.map((v) => v.sy));
    const scale = Math.min((W - 2 * PAD) / Math.max(maxX - minX, 1e-6), (H - 2 * PAD) / Math.max(maxY - minY, 1e-6));
    const ox = (W - (maxX - minX) * scale) / 2;
    const oy = (H - (maxY - minY) * scale) / 2;
    const screen = (p: P3) => {
      const v = view(p);
      return { x: ox + (v.sx - minX) * scale, y: H - (oy + (v.sy - minY) * scale), depth: v.depth };
    };
    const path = (ring: P3[]) => ring.map((p, i) => `${i ? 'L' : 'M'}${screen(p).x.toFixed(1)} ${screen(p).y.toFixed(1)}`).join(' ') + ' Z';

    // Outward normals depend on the walking direction of the corners.
    let signed = 0;
    for (let i = 0; i < n; i++) signed += pts[i].x * pts[(i + 1) % n].y - pts[(i + 1) % n].x * pts[i].y;
    const ccw = signed > 0;

    const faces: Face[] = [];
    const labels: Label[] = [];
    faces.push({ kind: 'floor', d: path(pts.map((p) => ({ ...p, z: 0 }))), depth: Infinity });

    for (const w of room.walls) {
      const dx = w.to.x - w.from.x;
      const dy = w.to.y - w.from.y;
      const len = w.length || 1;
      const normal = ccw ? { x: dy / len, y: -dx / len } : { x: -dy / len, y: dx / len };
      const near = normal.x * toCamera.x + normal.y * toCamera.y > 0.02;
      const along = (t: number, z: number): P3 => ({ x: w.from.x + (dx * t) / len, y: w.from.y + (dy * t) / len, z });
      let d = path([along(0, 0), along(len, 0), along(len, w.heightTo), along(0, w.heightFrom)]);
      for (const o of w.openings) {
        const a = o.offset ?? 0;
        const b = a + o.width;
        const s = o.sill ?? 0;
        d += ' ' + path([along(a, s), along(b, s), along(b, s + o.height), along(a, s + o.height)]);
        const mid = screen(along((a + b) / 2, s + o.height / 2));
        if (o.name) labels.push({ x: mid.x, y: mid.y, text: o.name, kind: 'opening' });
      }
      const center = screen(along(len / 2, wallHeightAt(w, len / 2) / 2));
      faces.push({ kind: near ? 'wall-near' : 'wall-far', d, depth: center.depth });
    }

    for (const [a, b, c] of room.triangles) {
      faces.push({
        kind: 'ceiling',
        d: path([a, b, c].map((i) => ({ ...pts[i], z: heightAt(i) }))),
        depth: -Infinity,
      });
    }

    pts.forEach((p, i) => {
      const s = screen({ ...p, z: 0 });
      labels.push({ x: s.x, y: s.y + 16, text: String(i + 1), kind: 'corner' });
    });

    // Painter's order: floor, far walls (farthest first), near-wall outlines, ceiling lines on top.
    const rank = { floor: 0, 'wall-far': 1, 'wall-near': 2, ceiling: 3 } as const;
    faces.sort((f, g) => rank[f.kind] - rank[g.kind] || g.depth - f.depth);
    return { faces, labels };
  });
}

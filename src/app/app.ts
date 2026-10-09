import { Component, inject } from '@angular/core';
import { ProjectStore } from './model/project-store';
import { ProjectList } from './pages/project-list';
import { ProjectView } from './pages/project-view';

@Component({
  selector: 'app-root',
  imports: [ProjectList, ProjectView],
  template: `
    <header class="topbar">
      <button type="button" class="brand" (click)="store.openProject(null)" aria-label="Naar alle projecten">
        <svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
          <path d="M4 26 L16 6 L28 26 Z" />
          <path d="M10 26 V18 M22 26 V18" />
        </svg>
        <span>Bouwplannen</span>
      </button>
      @if (store.currentProject(); as p) {
        <nav class="crumbs" aria-label="Kruimelpad">
          <button type="button" class="crumb" (click)="store.openProject(null)">Projecten</button>
          <span aria-hidden="true">/</span>
          <span class="crumb crumb--current">{{ p.name }}</span>
        </nav>
      }
    </header>
    <main class="main">
      @if (store.currentProject()) {
        <app-project-view />
      } @else {
        <app-project-list />
      }
    </main>
  `,
})
export class App {
  protected readonly store = inject(ProjectStore);
}

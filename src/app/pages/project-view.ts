import { Component, computed, inject, signal } from '@angular/core';
import { DakEditor } from '../editors/dak-editor';
import { DriehoekEditor } from '../editors/driehoek-editor';
import { HoekEditor } from '../editors/hoek-editor';
import { MatenEditor } from '../editors/maten-editor';
import { VormEditor } from '../editors/vorm-editor';
import { outlineOf, outlineToDxf, projectToCsv, summarize, toJson } from '../model/export';
import { Item, ItemKind, KIND_HINTS, KIND_LABELS } from '../model/models';
import { ProjectStore } from '../model/project-store';
import { ExportOption, ExportPanel } from '../ui/export-panel';
import { safeFilename } from '../ui/transfer';

@Component({
  selector: 'app-project-view',
  imports: [HoekEditor, DriehoekEditor, VormEditor, DakEditor, MatenEditor, ExportPanel],
  template: `
    @if (project(); as p) {
      <div class="workspace" [class.workspace--item]="!!item()">
        <aside class="sidebar">
          <label class="field field--text field--title" for="project-name">
            <span class="field-label">Project</span>
            <input id="project-name" type="text" [value]="p.name" (change)="store.renameProject(p.id, $any($event.target).value)" />
          </label>

          @if (p.items.length > 0) {
            <ul class="items">
              @for (i of p.items; track i.id) {
                <li>
                  <button type="button" class="item" [class.item--active]="i.id === item()?.id" (click)="store.openItem(i.id)">
                    <span class="kind kind--{{ i.kind }}">{{ labels[i.kind] }}</span>
                    <span class="item-name">{{ i.name }}</span>
                    <span class="item-key">{{ keyResult(i) }}</span>
                  </button>
                </li>
              }
            </ul>
          } @else {
            <p class="hint">Nog niets gemeten. Kies hieronder wat je wilt vastleggen.</p>
          }

          <h3 class="group-title">Toevoegen</h3>
          <div class="add-grid">
            @for (k of kinds; track k) {
              <button type="button" class="add" (click)="store.addItem(k)">
                <span class="kind kind--{{ k }}">{{ labels[k] }}</span>
                <span class="add-hint">{{ hints[k] }}</span>
              </button>
            }
          </div>

          <details class="more">
            <summary>Project exporteren</summary>
            <app-export-panel [options]="projectExports()" />
          </details>
          <div class="danger">
            @if (confirmProject()) {
              <span>Project en alle maten verwijderen?</span>
              <button type="button" class="btn btn--danger" (click)="store.deleteProject(p.id)">Ja, verwijderen</button>
              <button type="button" class="btn btn--quiet" (click)="confirmProject.set(false)">Annuleren</button>
            } @else {
              <button type="button" class="btn btn--quiet" (click)="confirmProject.set(true)">Project verwijderen</button>
            }
          </div>
        </aside>

        <section class="editor" aria-live="polite">
          @if (item(); as it) {
            <div class="editor-head">
              <button type="button" class="back btn btn--quiet" (click)="store.openItem(null)">← Alle onderdelen</button>
              <span class="kind kind--{{ it.kind }}">{{ labels[it.kind] }}</span>
              <input class="item-title" type="text" aria-label="Naam" [value]="it.name" (input)="rename(it, $any($event.target).value)" />
            </div>

            @switch (it.kind) {
              @case ('hoek') {
                <app-hoek-editor [item]="it" (changed)="store.updateItem($event)" />
              }
              @case ('driehoek') {
                <app-driehoek-editor [item]="it" (changed)="store.updateItem($event)" />
              }
              @case ('vorm') {
                <app-vorm-editor [item]="it" (changed)="store.updateItem($event)" />
              }
              @case ('dak') {
                <app-dak-editor [item]="it" (changed)="store.updateItem($event)" />
              }
              @case ('maten') {
                <app-maten-editor [item]="it" (changed)="store.updateItem($event)" />
              }
            }

            <label class="field field--text notes" for="item-notes">
              <span class="field-label">Notities</span>
              <textarea id="item-notes" rows="2" placeholder="Waar, hoe gemeten, bijzonderheden" [value]="it.notes" (input)="setNotes(it, $any($event.target).value)"></textarea>
            </label>

            @if (itemExports().length > 0) {
              <details class="more">
                <summary>Naar CAD</summary>
                <app-export-panel [options]="itemExports()" />
              </details>
            }

            <div class="editor-actions">
              <button type="button" class="btn btn--quiet" (click)="store.duplicateItem(it.id)">Dupliceren</button>
              @if (confirmItem() === it.id) {
                <button type="button" class="btn btn--danger" (click)="store.deleteItem(it.id); confirmItem.set(null)">Ja, verwijderen</button>
                <button type="button" class="btn btn--quiet" (click)="confirmItem.set(null)">Annuleren</button>
              } @else {
                <button type="button" class="btn btn--quiet" (click)="confirmItem.set(it.id)">Verwijderen</button>
              }
            </div>
          } @else {
            <div class="empty empty--editor">
              <h2>Kies een onderdeel</h2>
              <p>Selecteer links een meting of voeg er een toe.</p>
            </div>
          }
        </section>
      </div>
    }
  `,
})
export class ProjectView {
  protected readonly store = inject(ProjectStore);
  protected readonly project = this.store.currentProject;
  protected readonly item = this.store.currentItem;
  protected readonly labels = KIND_LABELS;
  protected readonly hints = KIND_HINTS;
  protected readonly kinds: ItemKind[] = ['vorm', 'hoek', 'dak', 'driehoek', 'maten'];
  protected readonly confirmProject = signal(false);
  protected readonly confirmItem = signal<string | null>(null);

  protected keyResult(item: Item): string {
    const rows = summarize(item);
    if (rows.length === 0) return '';
    if (rows[0][0] === 'Status') return 'Nog niet compleet';
    if (item.kind === 'maten') return `${rows.length} maten`;
    if (item.kind === 'dak') {
      // Pitches of all slopes, e.g. "40,00° / 25,00°".
      return rows.filter((r) => r[0].startsWith('Helling')).map((r) => r[1].split(' (')[0]).join(' / ');
    }
    const pick: Partial<Record<ItemKind, string>> = { vorm: 'Oppervlakte', driehoek: 'Oppervlakte', hoek: 'Hoek' };
    const wanted = pick[item.kind];
    return ((wanted && rows.find((r) => r[0] === wanted)) || rows[0])[1];
  }

  protected readonly projectExports = computed<ExportOption[]>(() => {
    const p = this.project();
    if (!p) return [];
    const name = safeFilename(p.name);
    return [
      {
        label: 'Uitkomsten',
        description: 'Alle maten en resultaten als CSV, opent in Excel',
        filename: `${name}.csv`,
        mime: 'text/csv',
        content: () => '﻿' + projectToCsv(p),
      },
      {
        label: 'Project',
        description: 'Volledige back-up van dit project (JSON)',
        filename: `${name}.json`,
        mime: 'application/json',
        content: () => toJson([p]),
      },
    ];
  });

  protected readonly itemExports = computed<ExportOption[]>(() => {
    const it = this.item();
    const pts = it ? outlineOf(it) : null;
    if (!it || !pts) return [];
    return [
      {
        label: 'Omtrek als DXF',
        description: 'Lijnen in millimeters, voor AutoCAD, LibreCAD of FreeCAD',
        filename: `${safeFilename(it.name)}.dxf`,
        mime: 'application/dxf',
        content: () => outlineToDxf(pts),
      },
    ];
  });

  protected rename(item: Item, name: string): void {
    this.store.updateItem({ ...item, name });
  }

  protected setNotes(item: Item, notes: string): void {
    this.store.updateItem({ ...item, notes });
  }
}

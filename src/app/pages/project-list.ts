import { Component, computed, inject, signal } from '@angular/core';
import { parseImport, toJson } from '../model/export';
import { KIND_LABELS, Project } from '../model/models';
import { ProjectStore } from '../model/project-store';
import { ExportOption, ExportPanel } from '../ui/export-panel';

@Component({
  selector: 'app-project-list',
  imports: [ExportPanel],
  template: `
    <section class="page">
      <form class="create" (submit)="create($event)">
        <label class="field field--text field--grow" for="new-project">
          <span class="field-label">Nieuw project</span>
          <input id="new-project" type="text" placeholder="bijv. Schuur achtertuin" [value]="newName()" (input)="newName.set($any($event.target).value)" />
        </label>
        <button type="submit" class="btn btn--primary">Project maken</button>
      </form>

      @if (!store.storageAvailable) {
        <p class="status status--error">
          Deze browser bewaart niets: projecten verdwijnen als je de pagina sluit. Exporteer ze voordat je stopt.
        </p>
      }

      @if (projects().length === 0) {
        <div class="empty">
          <h2>Nog geen projecten</h2>
          <p>Maak een project per klus of gebouw. Daarin leg je hoeken, vormen, daken en losse maten vast.</p>
          <button type="button" class="btn" (click)="example()">Voorbeeldproject openen</button>
        </div>
      } @else {
        <ul class="projects">
          @for (p of projects(); track p.id) {
            <li>
              <button type="button" class="project" (click)="store.openProject(p.id)">
                <span class="project-name">{{ p.name }}</span>
                <span class="project-meta">{{ summary(p) }}</span>
                <span class="project-date">{{ date(p.updated) }}</span>
              </button>
            </li>
          }
        </ul>
      }

      <details class="more">
        <summary>Back-up en importeren</summary>
        <p class="hint">
          Projecten staan alleen in deze browser op dit apparaat. Maak geregeld een back-up, of zet ze zo over naar een ander apparaat.
        </p>
        <app-export-panel [options]="backup()" />
        <div class="import">
          <label class="btn btn--quiet file-btn" for="import-file">
            Bestand importeren
            <input id="import-file" type="file" accept=".json,application/json" (change)="importFile($event)" />
          </label>
          <label class="field field--text field--grow" for="import-text">
            <span class="field-label">Of plak een back-up</span>
            <textarea id="import-text" rows="3" [value]="pasted()" (input)="pasted.set($any($event.target).value)"></textarea>
          </label>
          <button type="button" class="btn" [disabled]="!pasted().trim()" (click)="importText(pasted())">Importeren</button>
        </div>
        @if (importMessage(); as m) {
          <p class="status" [class.status--error]="importFailed()" role="status">{{ m }}</p>
        }
      </details>
    </section>
  `,
})
export class ProjectList {
  protected readonly store = inject(ProjectStore);
  protected readonly projects = this.store.projects;
  protected readonly newName = signal('');
  protected readonly pasted = signal('');
  protected readonly importMessage = signal<string | null>(null);
  protected readonly importFailed = signal(false);

  protected readonly backup = computed<ExportOption[]>(() => [
    {
      label: 'Alle projecten',
      description: `${this.projects().length} project(en) als JSON`,
      filename: `bouwplannen-backup-${new Date().toISOString().slice(0, 10)}.json`,
      mime: 'application/json',
      content: () => toJson(this.projects()),
    },
  ]);

  protected create(event: Event): void {
    event.preventDefault();
    this.store.createProject(this.newName());
    this.newName.set('');
  }

  protected summary(p: Project): string {
    if (p.items.length === 0) return 'Leeg';
    const counts = new Map<string, number>();
    for (const i of p.items) counts.set(KIND_LABELS[i.kind], (counts.get(KIND_LABELS[i.kind]) ?? 0) + 1);
    return [...counts].map(([k, n]) => (n > 1 ? `${n}× ${k.toLowerCase()}` : k.toLowerCase())).join(' · ');
  }

  protected date(iso: string): string {
    return new Date(iso).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  protected importText(text: string): void {
    try {
      const n = this.store.importProjects(parseImport(text));
      this.importFailed.set(false);
      this.importMessage.set(`${n} project${n === 1 ? '' : 'en'} geïmporteerd.`);
      this.pasted.set('');
    } catch (e) {
      this.importFailed.set(true);
      this.importMessage.set((e as Error).message);
    }
  }

  protected importFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    file.text().then((t) => this.importText(t));
    input.value = '';
  }

  protected example(): void {
    this.store.importProjects([exampleProject()]);
    this.store.openProject('voorbeeld-schuur');
  }
}

/** Sample data so a new user can see what each tool does. Clearly named as an example. */
export function exampleProject(): Project {
  const now = new Date().toISOString();
  const base = { notes: '', updated: now };
  return {
    id: 'voorbeeld-schuur',
    name: 'Voorbeeld: schuur',
    created: now,
    updated: now,
    items: [
      { ...base, id: 'vb-hoek', kind: 'hoek', name: 'Hoek werkbank', a: '1,000', b: '1,000', c: '1,428' },
      {
        ...base,
        id: 'vb-vorm',
        kind: 'vorm',
        name: 'Vloer schuur',
        method: 'diagonalen',
        sides: ['4,820', '3,610', '4,795', '3,640'],
        diagonals: ['6,052'],
        flips: [false, false, false, false],
        angles: ['', ''],
        height: '2,350',
        openings: [{ name: 'deur', width: '0,930', height: '2,115' }],
      },
      {
        ...base,
        id: 'vb-dak',
        kind: 'dak',
        name: 'Spant schuur',
        roofType: 'zadeldak',
        span: '3,640',
        rise: '',
        pitch: '35',
        rafter: '',
        ridgeOffset: '',
        overhang: '0,300',
        length: '4,820',
      },
      {
        ...base,
        id: 'vb-maten',
        kind: 'maten',
        name: 'Balklaag',
        entries: [
          { label: 'Hart op hart balken', value: '600 mm' },
          { label: 'Balkhoogte', value: '0,171' },
        ],
      },
    ],
  };
}

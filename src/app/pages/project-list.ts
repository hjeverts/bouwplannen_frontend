import { Component, computed, inject, signal } from '@angular/core';
import { parseImport, toJson } from '../model/export';
import { exampleHouse } from '../model/examples';
import { KIND_LABELS, Project } from '../model/models';
import { ProjectStore } from '../model/project-store';
import { AccountPanel } from '../account/account-panel';
import { GroupSelect } from '../account/group-select';
import { GroupsPanel } from '../account/groups-panel';
import { AuthService } from '../api/auth.service';
import { SyncService } from '../sync/sync.service';
import { ExportOption, ExportPanel } from '../ui/export-panel';

@Component({
  selector: 'app-project-list',
  imports: [ExportPanel, AccountPanel, GroupsPanel, GroupSelect],
  template: `
    <section class="page">
      <form class="create" (submit)="create($event)">
        <label class="field field--text field--grow" for="new-project">
          <span class="field-label">Nieuw project</span>
          <input id="new-project" type="text" placeholder="bijv. Schuur achtertuin" [value]="newName()" (input)="newName.set($any($event.target).value)" />
        </label>
        @if (auth.loggedIn()) {
          <app-group-select label="In groep" [value]="newGroup() ?? auth.me()?.personalGroupId" (changed)="newGroup.set($event)" />
        }
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
          <div class="empty-actions">
            <button type="button" class="btn" (click)="example()">Voorbeeld: schuur</button>
            <button type="button" class="btn" (click)="exampleHouse()">Voorbeeld: woning met verdieping</button>
          </div>
        </div>
      } @else {
        <ul class="projects">
          @for (p of projects(); track p.id) {
            <li>
              <button type="button" class="project" (click)="store.openProject(p.id)">
                <span class="project-name">{{ p.name }}</span>
                <span class="project-meta">{{ summary(p) }}</span>
                <span class="project-date">{{ date(p.updated) }}</span>
                @if (auth.loggedIn()) {
                  <span class="project-group">
                    @switch (sync.blocked()[p.id]) {
                      @case ('geen-groep') {
                        <span class="chip chip--warn">Kies een groep om te delen</span>
                      }
                      @case ('geen-toegang') {
                        <span class="chip chip--warn">Geen toegang tot de groep</span>
                      }
                      @default {
                        <span class="chip">{{ groupLabel(p.groupId) }}</span>
                      }
                    }
                  </span>
                }
              </button>
            </li>
          }
        </ul>
      }

      <app-account-panel (showLogin)="auth.skipLogin.set(false)" />
      @if (auth.loggedIn()) {
        <app-groups-panel />
      }

      <details class="more">
        <summary>Back-up en importeren</summary>
        <p class="hint">
          @if (auth.loggedIn()) {
            Je projecten staan op de server en op dit apparaat. Een back-up hier bevat alles wat op dit apparaat staat.
          } @else {
            Projecten staan alleen in deze browser op dit apparaat. Maak geregeld een back-up, of zet ze zo over naar een ander apparaat.
          }
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
  protected readonly auth = inject(AuthService);
  protected readonly sync = inject(SyncService);
  protected readonly projects = this.store.projects;
  protected readonly newName = signal('');
  /** Group for a new project; defaults to your private group. */
  protected readonly newGroup = signal<string | undefined>(undefined);
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
    const group = this.auth.loggedIn() ? (this.newGroup() ?? this.auth.me()?.personalGroupId) : undefined;
    this.store.createProject(this.newName(), group);
    this.newName.set('');
  }

  protected summary(p: Project): string {
    if (p.items.length === 0) return 'Leeg';
    const counts = new Map<string, number>();
    for (const i of p.items) counts.set(KIND_LABELS[i.kind], (counts.get(KIND_LABELS[i.kind]) ?? 0) + 1);
    return [...counts].map(([k, n]) => (n > 1 ? `${n}× ${k.toLowerCase()}` : k.toLowerCase())).join(' · ');
  }

  protected groupLabel(groupId: string | undefined): string {
    const g = this.auth.groups().find((x) => x.id === groupId);
    return !g ? 'Alleen op dit apparaat' : g.personal ? 'Privé' : g.name;
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

  protected exampleHouse(): void {
    const house = exampleHouse();
    this.store.importProjects([house]);
    this.store.openProject(house.id);
    this.store.openItem(house.items[0].id);
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
        openings: [{ name: 'deur', width: '0,930', height: '2,115', wall: '0', offset: '0,600', sill: '0' }],
      },
      {
        ...base,
        id: 'vb-kapschuur',
        kind: 'vorm',
        name: 'Kapschuur (scheve nok)',
        method: 'hoeken',
        sides: ['2,500', '3,500', '8,000', '3,500', '2,500', '8,000'],
        diagonals: ['', '', ''],
        flips: [false, false, false, false, false, false],
        angles: ['180', '90', '90', '180'],
        height: '',
        heightMode: 'per-hoek',
        heights: ['3,000', '5,200', '2,400', '2,400', '5,200', '3,000'],
        openings: [
          { name: 'schuifdeur', width: '2,400', height: '2,200', wall: '1', offset: '0,300', sill: '0' },
          { name: 'raam', width: '1,200', height: '1,000', wall: '2', offset: '2,000', sill: '1,000' },
        ],
      },
      {
        ...base,
        id: 'vb-dak',
        kind: 'dak',
        name: 'Spant schuur',
        roofType: 'zadeldak',
        span: '6,000',
        wallLeft: '3,000',
        wallRight: '2,400',
        rise: '',
        pitch: '45',
        pitchRight: '30',
        rafter: '',
        rafterRight: '',
        ridgeOffset: '',
        overhang: '0,300',
        gableOverhang: '0,250',
        length: '8,000',
      },
      {
        ...base,
        id: 'vb-mansarde',
        kind: 'dak',
        name: 'Mansardekap zolder',
        roofType: 'mansardekap',
        span: '7,800',
        lowerRun: '0,900',
        lowerRise: '2,400',
        lowerPitch: '',
        lowerRafter: '',
        rise: '',
        pitch: '28',
        rafter: '',
        ridgeOffset: '',
        overhang: '0,250',
        length: '9,600',
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

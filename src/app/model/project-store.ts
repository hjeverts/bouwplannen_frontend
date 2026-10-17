import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { LengthUnit, lengthUnit } from '../geometry/units';
import { convertItem } from './convert-units';
import { createItem, Item, ItemKind, migrateProject, newId, Project } from './models';
import { PROJECT_STORAGE } from './storage';

const UNIT_KEY = 'bouwplannen.unit.v1';

export type ProjectChange = { type: 'upsert'; id: string } | { type: 'delete'; id: string };

/** All project state lives here, as signals. Every change is written to storage straight away. */
@Injectable({ providedIn: 'root' })
export class ProjectStore {
  /** Called after every change made in this app (not for changes applied from the server). */
  private readonly listeners: ((change: ProjectChange) => void)[] = [];

  private readonly storage = inject(PROJECT_STORAGE);

  readonly projects = signal<Project[]>(this.storage.load().map(migrateProject));
  readonly currentProjectId = signal<string | null>(null);
  readonly currentItemId = signal<string | null>(null);
  readonly storageAvailable = this.storage.available;

  readonly currentProject = computed(() => this.projects().find((p) => p.id === this.currentProjectId()) ?? null);
  readonly currentItem = computed(() => this.currentProject()?.items.find((i) => i.id === this.currentItemId()) ?? null);
  /** Unit of the open project; numbers typed without a unit are in it. */
  readonly unit = computed<LengthUnit>(() => this.currentProject()?.settings?.unit ?? 'm');

  constructor() {
    // Parsing and formatting everywhere follow the open project's unit.
    effect(() => lengthUnit.set(this.unit()));
  }

  /** Unit for new projects: the one chosen last. */
  private defaultUnit(): LengthUnit {
    try {
      const u = localStorage.getItem(UNIT_KEY);
      return u === 'cm' || u === 'mm' ? u : 'm';
    } catch {
      return 'm';
    }
  }

  /**
   * Change the unit of a project. Lengths typed without a unit are rewritten in the new unit, so the
   * measurements stay the same size.
   */
  setProjectUnit(id: string, unit: LengthUnit): void {
    const project = this.projects().find((p) => p.id === id);
    if (!project) return;
    const from = project.settings?.unit ?? 'm';
    if (from === unit) return;
    this.updateProject(id, (p) => ({ ...p, settings: { ...p.settings, unit }, items: p.items.map((i) => convertItem(i, from, unit)) }));
    if (this.currentProjectId() === id) lengthUnit.set(unit);
    try {
      localStorage.setItem(UNIT_KEY, unit);
    } catch {
      // Not remembered; new projects start in metres.
    }
  }

  private commit(projects: Project[]): void {
    this.projects.set(projects);
    this.storage.save(projects);
  }

  onChange(listener: (change: ProjectChange) => void): void {
    this.listeners.push(listener);
  }

  private notify(change: ProjectChange): void {
    for (const l of this.listeners) l(change);
  }

  /** Put a project from the server in place (or add it) without reporting it as a local change. */
  applyRemote(project: Project): void {
    const exists = this.projects().some((p) => p.id === project.id);
    this.commit(exists ? this.projects().map((p) => (p.id === project.id ? project : p)) : [project, ...this.projects()]);
  }

  /** Remove a project that was deleted on another device, without reporting it as a local change. */
  removeRemote(id: string): void {
    this.commit(this.projects().filter((p) => p.id !== id));
    if (this.currentProjectId() === id) this.openProject(null);
  }

  private touch<T extends { updated: string }>(obj: T): T {
    return { ...obj, updated: new Date().toISOString() };
  }

  openProject(id: string | null): void {
    this.currentProjectId.set(id);
    // At once, not only after the next render: results computed right away use the right unit.
    lengthUnit.set(this.projects().find((p) => p.id === id)?.settings?.unit ?? 'm');
    this.currentItemId.set(null);
  }

  openItem(id: string | null): void {
    this.currentItemId.set(id);
  }

  createProject(name: string, groupId?: string): Project {
    const now = new Date().toISOString();
    const unit = this.defaultUnit();
    const project: Project = { id: newId(), name: name.trim() || 'Nieuw project', created: now, updated: now, items: [], ...(unit !== 'm' ? { settings: { unit } } : {}) };
    if (groupId) project.groupId = groupId;
    this.commit([project, ...this.projects()]);
    this.notify({ type: 'upsert', id: project.id });
    this.openProject(project.id);
    return project;
  }

  renameProject(id: string, name: string): void {
    this.updateProject(id, (p) => ({ ...p, name }));
  }

  /** Put the project in another group (shares it with that group's members). */
  setProjectGroup(id: string, groupId: string): void {
    this.updateProject(id, (p) => ({ ...p, groupId }));
  }

  /** Remove every project from this device without reporting deletions (used when logging out with "wipe"). */
  clearLocal(): void {
    this.commit([]);
    this.openProject(null);
  }

  deleteProject(id: string): void {
    this.commit(this.projects().filter((p) => p.id !== id));
    this.notify({ type: 'delete', id });
    if (this.currentProjectId() === id) this.openProject(null);
  }

  /** Add (or replace by id) projects from an import. Returns the number imported. */
  importProjects(incoming: Project[]): number {
    const byId = new Map(this.projects().map((p) => [p.id, p]));
    for (const p of incoming) byId.set(p.id, p);
    this.commit([...byId.values()].sort((a, b) => b.updated.localeCompare(a.updated)));
    for (const p of incoming) this.notify({ type: 'upsert', id: p.id });
    return incoming.length;
  }

  addItem(kind: ItemKind): Item | null {
    const project = this.currentProject();
    if (!project) return null;
    const count = project.items.filter((i) => i.kind === kind).length;
    // Defaults are written in metres: in the project's own unit, so "0,300" does not become 0,3 mm.
    const item = convertItem(createItem(kind), 'm', project.settings?.unit ?? 'm');
    if (count > 0) item.name = `${item.name} ${count + 1}`;
    this.updateProject(project.id, (p) => ({ ...p, items: [...p.items, item] }));
    this.openItem(item.id);
    return item;
  }

  updateItem(item: Item): void {
    const project = this.currentProject();
    if (!project) return;
    this.updateProject(project.id, (p) => ({
      ...p,
      items: p.items.map((i) => (i.id === item.id ? this.touch(item) : i)),
    }));
  }

  duplicateItem(id: string): void {
    const project = this.currentProject();
    const source = project?.items.find((i) => i.id === id);
    if (!project || !source) return;
    const copy = { ...structuredClone(source), id: newId(), name: `${source.name} (kopie)` };
    const index = project.items.indexOf(source);
    this.updateProject(project.id, (p) => ({ ...p, items: [...p.items.slice(0, index + 1), copy, ...p.items.slice(index + 1)] }));
    this.openItem(copy.id);
  }

  deleteItem(id: string): void {
    const project = this.currentProject();
    if (!project) return;
    this.updateProject(project.id, (p) => ({ ...p, items: p.items.filter((i) => i.id !== id) }));
    if (this.currentItemId() === id) this.openItem(null);
  }

  private updateProject(id: string, change: (p: Project) => Project): void {
    this.commit(this.projects().map((p) => (p.id === id ? this.touch(change(p)) : p)));
    this.notify({ type: 'upsert', id });
  }
}

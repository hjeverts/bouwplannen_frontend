import { computed, inject, Injectable, signal } from '@angular/core';
import { createItem, Item, ItemKind, newId, Project } from './models';
import { PROJECT_STORAGE } from './storage';

export type ProjectChange = { type: 'upsert'; id: string } | { type: 'delete'; id: string };

/** All project state lives here, as signals. Every change is written to storage straight away. */
@Injectable({ providedIn: 'root' })
export class ProjectStore {
  /** Called after every change made in this app (not for changes applied from the server). */
  private readonly listeners: ((change: ProjectChange) => void)[] = [];

  private readonly storage = inject(PROJECT_STORAGE);

  readonly projects = signal<Project[]>(this.storage.load());
  readonly currentProjectId = signal<string | null>(null);
  readonly currentItemId = signal<string | null>(null);
  readonly storageAvailable = this.storage.available;

  readonly currentProject = computed(() => this.projects().find((p) => p.id === this.currentProjectId()) ?? null);
  readonly currentItem = computed(() => this.currentProject()?.items.find((i) => i.id === this.currentItemId()) ?? null);

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
    this.currentItemId.set(null);
  }

  openItem(id: string | null): void {
    this.currentItemId.set(id);
  }

  createProject(name: string, groupId?: string): Project {
    const now = new Date().toISOString();
    const project: Project = { id: newId(), name: name.trim() || 'Nieuw project', created: now, updated: now, items: [] };
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
    const item = createItem(kind);
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

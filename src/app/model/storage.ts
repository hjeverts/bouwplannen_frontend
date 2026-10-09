import { Injectable, InjectionToken } from '@angular/core';
import { Project } from './models';

/**
 * Where projects are kept. The app only talks to this interface, so the browser storage
 * below can later be swapped for the .NET backend (an HttpClient-based implementation).
 */
export interface ProjectStorage {
  load(): Project[];
  save(projects: Project[]): void;
  /** False when the browser refuses storage (private window, blocked site data). */
  readonly available: boolean;
}

export const PROJECT_STORAGE = new InjectionToken<ProjectStorage>('ProjectStorage');

const KEY = 'bouwplannen.projects.v1';

@Injectable()
export class LocalProjectStorage implements ProjectStorage {
  readonly available: boolean;

  constructor() {
    this.available = probe();
  }

  load(): Project[] {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as Project[]) : [];
    } catch {
      return [];
    }
  }

  save(projects: Project[]): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(projects));
    } catch {
      /* storage full or blocked: data stays in memory for this session */
    }
  }
}

function probe(): boolean {
  try {
    const k = KEY + '.probe';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

/** In-memory storage for tests. */
export class MemoryProjectStorage implements ProjectStorage {
  readonly available = true;
  constructor(public projects: Project[] = []) {}
  load(): Project[] {
    return structuredClone(this.projects);
  }
  save(projects: Project[]): void {
    this.projects = structuredClone(projects);
  }
}

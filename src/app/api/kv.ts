import { InjectionToken } from '@angular/core';

/** Small key/value store for settings and sync bookkeeping (localStorage in the app, memory in tests). */
export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export const SYNC_KV = new InjectionToken<KeyValueStore>('KeyValueStore', {
  providedIn: 'root',
  factory: () => ({
    get: (k) => {
      try {
        return localStorage.getItem(k);
      } catch {
        return null;
      }
    },
    set: (k, v) => {
      try {
        if (v === '') localStorage.removeItem(k);
        else localStorage.setItem(k, v);
      } catch {
        /* blocked storage: lasts for this session only */
      }
    },
  }),
});

import { inject, Injectable, InjectionToken } from '@angular/core';

/**
 * Talks to the Bouwplannen API on the same address as the app (/api/…), with the login cookie.
 * Every changing request carries the header the API requires against cross-site requests.
 */

export const API_FETCH = new InjectionToken<typeof fetch>('ApiFetch', {
  providedIn: 'root',
  factory: () => (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init),
});

/** Prefix for API paths; empty = same address as the app. */
export const API_BASE = new InjectionToken<string>('ApiBase', { providedIn: 'root', factory: () => '' });

export interface ApiResponse<T> {
  status: number;
  body: T | null;
  headers: Headers;
}

/** The server could not be reached at all (no connection, or no Bouwplannen server at this address). */
export class OfflineError extends Error {
  constructor() {
    super('Server niet bereikbaar. Je wijzigingen blijven bewaard en gaan mee zodra er verbinding is.');
  }
}

@Injectable({ providedIn: 'root' })
export class ApiClient {
  private readonly fetchFn = inject(API_FETCH);
  private readonly base = inject(API_BASE);

  async request<T>(method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = { Accept: 'application/json', 'X-Requested-With': 'bouwplannen', ...extraHeaders };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let res: Response;
    try {
      res = await this.fetchFn(this.base + path, {
        method,
        headers,
        credentials: 'same-origin',
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new OfflineError();
    }
    const text = await res.text();
    let parsed: T | null = null;
    try {
      parsed = text ? (JSON.parse(text) as T) : null;
    } catch {
      parsed = null; // e.g. an HTML page: not our API
    }
    return { status: res.status, body: parsed, headers: res.headers };
  }

  get<T>(path: string): Promise<ApiResponse<T>> {
    return this.request<T>('GET', path);
  }
}

/** Readable message from an error answer (ProblemDetails "title"), with a fallback. */
export function problemMessage(res: ApiResponse<unknown>, fallback: string): string {
  const body = res.body as { title?: string; errors?: Record<string, string[]> } | null;
  const firstError = body?.errors ? Object.values(body.errors)[0]?.[0] : undefined;
  if (res.status === 429 && !body?.title) return 'Te veel pogingen. Wacht even en probeer het opnieuw.';
  return firstError ?? body?.title ?? fallback;
}

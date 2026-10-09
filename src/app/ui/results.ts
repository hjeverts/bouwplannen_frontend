import { Component, input } from '@angular/core';

export interface ResultRow {
  label: string;
  value: string;
  /** Shown larger, as the headline answer. */
  main?: boolean;
  tone?: 'ok' | 'warn';
}

/** Results of a calculation, or why there is no result yet. */
@Component({
  selector: 'app-results',
  template: `
    @if (message(); as m) {
      <p class="status" [class.status--error]="state() === 'error'" role="status">{{ m }}</p>
    } @else {
      <dl class="results">
        @for (r of rows(); track r.label) {
          <div class="result" [class.result--main]="r.main" [class.result--ok]="r.tone === 'ok'" [class.result--warn]="r.tone === 'warn'">
            <dt>{{ r.label }}</dt>
            <dd>{{ r.value }}</dd>
          </div>
        }
      </dl>
    }
  `,
})
export class Results {
  readonly rows = input<ResultRow[]>([]);
  readonly message = input<string | null>(null);
  readonly state = input<'incomplete' | 'error' | 'ok'>('ok');
}

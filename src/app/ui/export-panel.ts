import { Component, input, signal } from '@angular/core';
import { canDownload, copy, download } from './transfer';

export interface ExportOption {
  label: string;
  description: string;
  filename: string;
  mime: string;
  content: () => string;
}

/**
 * Lists export formats. Each can be downloaded (when the browser allows it) or copied.
 * When copying is refused too, the text is shown in a box to select by hand.
 */
@Component({
  selector: 'app-export-panel',
  template: `
    <ul class="exports">
      @for (o of options(); track o.filename) {
        <li class="export">
          <div class="export-text">
            <strong>{{ o.label }}</strong>
            <span>{{ o.description }}</span>
          </div>
          <div class="export-actions">
            @if (downloadable) {
              <button type="button" class="btn btn--quiet" (click)="save(o)">Downloaden</button>
            }
            <button type="button" class="btn btn--quiet" (click)="copyOut(o)">{{ copied() === o.filename ? 'Gekopieerd' : 'Kopiëren' }}</button>
          </div>
        </li>
      }
    </ul>
    @if (manual(); as text) {
      <p class="hint">Kopiëren werd geweigerd. Selecteer de tekst hieronder en kopieer hem zelf.</p>
      <textarea class="manual" readonly rows="8" (focus)="$any($event.target).select()">{{ text }}</textarea>
    }
  `,
})
export class ExportPanel {
  readonly options = input<ExportOption[]>([]);
  protected readonly downloadable = canDownload();
  protected readonly copied = signal<string | null>(null);
  protected readonly manual = signal<string | null>(null);

  protected save(o: ExportOption): void {
    download(o.content(), o.filename, o.mime);
  }

  protected async copyOut(o: ExportOption): Promise<void> {
    const text = o.content();
    if (await copy(text)) {
      this.manual.set(null);
      this.copied.set(o.filename);
      setTimeout(() => this.copied.set(null), 2000);
    } else {
      this.manual.set(text);
    }
  }
}

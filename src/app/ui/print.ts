import { DOCUMENT } from '@angular/common';
import { inject, Injectable } from '@angular/core';

/**
 * Prints an A4 drawing sheet (an SVG in millimetres) on its own: everything else on the page is
 * hidden while printing (see `body.printing` in styles.css). Works with "Opslaan als PDF" too.
 */
@Injectable({ providedIn: 'root' })
export class PrintService {
  private readonly doc = inject(DOCUMENT);

  print(svg: string): void {
    const doc = this.doc;
    const win = doc.defaultView;
    doc.querySelector('.print-root')?.remove();
    const root = doc.createElement('div');
    root.className = 'print-root';
    root.innerHTML = svg;
    doc.body.appendChild(root);
    doc.body.classList.add('printing');
    const done = () => {
      doc.body.classList.remove('printing');
      root.remove();
      win?.removeEventListener('afterprint', done);
    };
    win?.addEventListener('afterprint', done);
    // Let the browser lay out the sheet before the print dialog takes its snapshot. The sheet is
    // hidden on screen, so where afterprint never fires it can stay until the next print.
    setTimeout(() => win?.print(), 50);
  }

  /** The same sheet as a file, for sharing or opening in a drawing program. */
  download(svg: string, filename: string): void {
    const doc = this.doc;
    const blob = new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${svg}`], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = doc.createElement('a');
    a.href = url;
    a.download = filename;
    doc.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

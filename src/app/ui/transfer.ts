/** Getting text out of the app: download where the browser allows it, otherwise copy. */

/** Embedded pages (e.g. a preview frame) usually may not start downloads. */
export function canDownload(): boolean {
  try {
    return window.self === window.top;
  } catch {
    return false;
  }
}

export function download(text: string, filename: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function safeFilename(name: string): string {
  return (
    name
      .trim()
      .replace(/[^\p{L}\p{N}\-_ ]+/gu, '')
      .replace(/\s+/g, '-')
      .toLowerCase() || 'bouwplannen'
  );
}

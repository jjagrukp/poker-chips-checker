/** Hands the user a text file (backups). The object URL is revoked once the click is queued. */
export function downloadText(filename: string, text: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** `name-YYYY-MM-DD.json` in local time. */
export function datedFilename(name: string, epochMs: number, extension = 'json'): string {
  const d = new Date(epochMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${name}-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.${extension}`;
}

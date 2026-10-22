// Plain formatting for display lines and issue params.

const chipFormat = new Intl.NumberFormat('en-AU');

export function formatChips(n: number): string {
  return chipFormat.format(n);
}

/** 190 → "3h 10m", 180 → "3h", 45 → "45m". */
export function formatDurationMin(totalMin: number): string {
  const rounded = Math.round(totalMin);
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

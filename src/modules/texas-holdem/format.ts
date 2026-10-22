import { t } from '@/shared/messages';

// Plain formatting for display lines and issue params. Units come from the message catalogue.

const chipFormat = new Intl.NumberFormat('en-AU');

export function formatChips(n: number): string {
  return chipFormat.format(n);
}

/** 190 → "3h 10m", 180 → "3h", 45 → "45m". */
export function formatDurationMin(totalMin: number): string {
  const rounded = Math.round(totalMin);
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  if (h === 0) return t('format.duration.minutes', 'neutral', { m });
  return m === 0
    ? t('format.duration.hours', 'neutral', { h })
    : t('format.duration.hoursMinutes', 'neutral', { h, m });
}

/** "50 / 100". */
export function formatBlinds(sb: number, bb: number): string {
  return t('holdem.display.blindsValue', 'neutral', { sb: formatChips(sb), bb: formatChips(bb) });
}

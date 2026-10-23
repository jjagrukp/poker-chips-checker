// Colour helpers for the Chip graphic (spec 09 §3).

/** Relative luminance (sRGB) of a #rgb/#rrggbb colour; unknown input counts as mid-grey. */
function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m?.[1]) return 0.2;
  const raw = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  const [r = 0, g = 0, b = 0] = [0, 2, 4].map((i) => {
    const c = parseInt(raw.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Light chips get dark inserts, dark chips light ones. */
export function chipContrast(colour: string): string {
  return luminance(colour) > 0.45 ? '#1d2233' : '#f6f3ea';
}

/** "1000" → "1K", "2500" → "2.5K", "1500000" → "1.5M": fits inside a chip. */
export function chipValueLabel(value: number): string {
  if (value >= 1_000_000) return `${+(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${+(value / 1_000).toFixed(1)}K`;
  return String(value);
}

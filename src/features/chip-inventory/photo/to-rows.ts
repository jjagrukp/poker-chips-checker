import type { ChipRow } from '@/features/chip-inventory/ui/rows';
import type { ChipProposal } from './schema';

// Proposals → unconfirmed review rows (spec 06 §1.6). Counts are prefilled only at high or
// medium confidence, and then flagged "check this"; the host confirms every row.

const SWATCHES: Record<string, string> = {
  white: '#f5f5f5',
  cream: '#f3e9d2',
  ivory: '#f3ecd8',
  grey: '#9e9e9e',
  gray: '#9e9e9e',
  silver: '#c0c0c0',
  black: '#1f1f1f',
  red: '#c62828',
  maroon: '#7b1f1f',
  burgundy: '#7b1f2e',
  pink: '#ec7aa8',
  orange: '#ef6c00',
  yellow: '#fbc02d',
  gold: '#c9a227',
  green: '#2e7d32',
  lime: '#9ccc3c',
  teal: '#00897b',
  turquoise: '#26c6da',
  blue: '#1e63c4',
  navy: '#1a2a6c',
  purple: '#6a1b9a',
  violet: '#7e57c2',
  lavender: '#b39ddb',
  brown: '#6d4c41',
  beige: '#d7c4a3',
};
export const UNKNOWN_SWATCH = '#808080';

/** Best-effort swatch from a colour name: the last known colour word wins ("light blue" → blue). */
export function swatchFor(colour: string): string {
  const words = colour
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
  for (let i = words.length - 1; i >= 0; i--) {
    const swatch = SWATCHES[words[i] ?? ''];
    if (swatch) return swatch;
  }
  return UNKNOWN_SWATCH;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function describe(proposal: ChipProposal): string | undefined {
  const parts = [proposal.secondaryColours.join(', '), proposal.pattern ?? ''].filter((p) =>
    p.trim(),
  );
  const text = parts.join(' · ').slice(0, 60).trim();
  return text || undefined;
}

export function proposalToRow(proposal: ChipProposal, id: string): ChipRow {
  const trusted =
    proposal.estimatedCount !== null &&
    (proposal.countConfidence === 'high' || proposal.countConfidence === 'medium');
  const description = describe(proposal);
  return {
    id,
    colour: capitalise(proposal.primaryColour).slice(0, 30),
    swatch: swatchFor(proposal.primaryColour),
    ...(description ? { description } : {}),
    quantityText: trusted ? String(proposal.estimatedCount) : '',
    valueText: proposal.printedValue !== null ? String(proposal.printedValue) : '',
    used: true,
    confirmed: false,
    ...(proposal.printedValue !== null ? { printedValue: proposal.printedValue } : {}),
    ...(proposal.notes ? { notes: proposal.notes } : {}),
    ...(trusted ? { checkCount: true } : {}),
  };
}

function isBlank(row: ChipRow): boolean {
  return !row.colour.trim() && !row.quantityText.trim() && !row.valueText.trim();
}

const CONFIDENCE_RANK = { low: 0, medium: 1, high: 2 } as const;

function typeKey(p: ChipProposal): string {
  const norm = (s: string) => s.trim().toLowerCase();
  return JSON.stringify([
    norm(p.primaryColour),
    p.secondaryColours.map(norm).sort(),
    norm(p.pattern ?? ''),
    p.printedValue,
  ]);
}

/**
 * The model sometimes reports each stack of one chip type separately (D40). Identical types
 * become one proposal: counts add up (unknown if any stack's is), confidence is the lowest.
 */
export function combineDuplicates(proposals: readonly ChipProposal[]): ChipProposal[] {
  const byKey = new Map<string, ChipProposal>();
  for (const p of proposals) {
    const key = typeKey(p);
    const seen = byKey.get(key);
    if (!seen) {
      byKey.set(key, p);
      continue;
    }
    const notes = [seen.notes, p.notes].filter(Boolean).join('; ').slice(0, 200);
    byKey.set(key, {
      ...seen,
      estimatedCount:
        seen.estimatedCount === null || p.estimatedCount === null
          ? null
          : seen.estimatedCount + p.estimatedCount,
      countConfidence:
        CONFIDENCE_RANK[p.countConfidence] < CONFIDENCE_RANK[seen.countConfidence]
          ? p.countConfidence
          : seen.countConfidence,
      notes: notes || null,
    });
  }
  return [...byKey.values()];
}

/** Appends proposals to the current rows, dropping untouched blank rows. */
export function mergeProposals(
  rows: readonly ChipRow[],
  proposals: readonly ChipProposal[],
  newId: () => string,
): ChipRow[] {
  return [
    ...rows.filter((r) => !isBlank(r)),
    ...combineDuplicates(proposals).map((p) => proposalToRow(p, newId())),
  ];
}

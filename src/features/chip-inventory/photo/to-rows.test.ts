import { newRow } from '@/features/chip-inventory/ui/rows';
import type { ChipProposal } from './schema';
import { combineDuplicates, mergeProposals, proposalToRow, swatchFor } from './to-rows';

const proposal = (over: Partial<ChipProposal> = {}): ChipProposal => ({
  proposalId: 'c1',
  primaryColour: 'dark blue',
  secondaryColours: ['white'],
  pattern: 'edge spots',
  printedValue: null,
  estimatedCount: 40,
  countConfidence: 'high',
  notes: null,
  ...over,
});

describe('proposalToRow', () => {
  it('maps to an unconfirmed row with a flagged count at high or medium confidence', () => {
    for (const countConfidence of ['high', 'medium'] as const) {
      const row = proposalToRow(proposal({ countConfidence }), 'r1');
      expect(row).toMatchObject({
        id: 'r1',
        colour: 'Dark blue',
        swatch: swatchFor('blue'),
        description: 'white · edge spots',
        quantityText: '40',
        valueText: '',
        used: true,
        confirmed: false,
        checkCount: true,
      });
    }
  });

  it('leaves the count blank at low confidence or when unknown', () => {
    expect(proposalToRow(proposal({ countConfidence: 'low' }), 'r1')).toMatchObject({
      quantityText: '',
      confirmed: false,
    });
    const unknown = proposalToRow(proposal({ estimatedCount: null }), 'r1');
    expect(unknown.quantityText).toBe('');
    expect(unknown.checkCount).toBeUndefined();
  });

  it('carries a printed value and notes', () => {
    const row = proposalToRow(proposal({ printedValue: 25, notes: 'Two shades of red?' }), 'r1');
    expect(row).toMatchObject({ valueText: '25', printedValue: 25, notes: 'Two shades of red?' });
  });
});

describe('swatchFor', () => {
  it('uses the last known colour word and falls back to grey', () => {
    expect(swatchFor('Light green')).toBe(swatchFor('green'));
    expect(swatchFor('mauve')).toBe('#808080');
  });
});

describe('mergeProposals', () => {
  it('keeps edited rows, drops untouched blank rows, appends proposals', () => {
    let n = 0;
    const kept = { ...newRow('keep'), colour: 'White', quantityText: '100' };
    const rows = mergeProposals(
      [newRow('blank'), kept],
      [proposal(), proposal({ primaryColour: 'red' })],
      () => `p${++n}`,
    );
    expect(rows.map((r) => r.id)).toEqual(['keep', 'p1', 'p2']);
  });

  it('combines stacks of the same chip type into one row', () => {
    let n = 0;
    const rows = mergeProposals(
      [],
      [
        proposal({ estimatedCount: 25, notes: 'Blue stack' }),
        proposal({ primaryColour: 'red' }),
        proposal({ primaryColour: ' Dark Blue ', estimatedCount: 20, notes: 'Second blue stack' }),
      ],
      () => `p${++n}`,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      colour: 'Dark blue',
      quantityText: '45',
      notes: 'Blue stack; Second blue stack',
    });
  });
});

describe('combineDuplicates', () => {
  it('keeps the lowest confidence and drops the total when any count is unknown', () => {
    const [low] = combineDuplicates([proposal(), proposal({ countConfidence: 'low' })]);
    expect(low).toMatchObject({ estimatedCount: 80, countConfidence: 'low' });
    const [unknown] = combineDuplicates([proposal(), proposal({ estimatedCount: null })]);
    expect(unknown?.estimatedCount).toBeNull();
  });

  it('keeps types apart when the pattern, extra colours or printed value differ', () => {
    const result = combineDuplicates([
      proposal(),
      proposal({ pattern: 'stripes' }),
      proposal({ secondaryColours: ['yellow'] }),
      proposal({ printedValue: 100 }),
    ]);
    expect(result).toHaveLength(4);
  });
});

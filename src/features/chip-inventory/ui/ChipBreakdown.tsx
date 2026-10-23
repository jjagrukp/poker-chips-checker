import type { DenominationAssignment, Inventory } from '@/features/chip-inventory/domain/inventory';
import { Chip } from '@/shared/components/Chip';
import { chipValueLabel } from '@/shared/components/chip-colour';
import { useT } from '@/shared/messages/tone';

const numberFormat = new Intl.NumberFormat('en-AU');

export function Swatch({ colour }: { colour: string }) {
  return <Chip colour={colour} className="size-6" />;
}

interface Props {
  inventory: Inventory;
  assignment: DenominationAssignment;
  perPlayer: Record<string, number>;
}

/** Per-player chips, highest value first. Colour names always accompany the swatch. */
export function ChipBreakdown({ inventory, assignment, perPlayer }: Props) {
  const t = useT();
  const lines = inventory.chipTypes
    .flatMap((chip) => {
      const count = perPlayer[chip.id] ?? 0;
      const value = assignment.values[chip.id];
      return count > 0 && typeof value === 'number' ? [{ chip, count, value }] : [];
    })
    .sort((a, b) => b.value - a.value);
  return (
    <ul className="flex flex-col gap-2">
      {lines.map(({ chip, count, value }) => (
        <li key={chip.id} className="flex items-center gap-3">
          <Chip colour={chip.swatch} value={chipValueLabel(value)} className="size-10" />
          <span>
            {t('chips.breakdown.line', {
              count,
              colour: chip.colour || t('chips.breakdown.unnamed'),
              value: numberFormat.format(value),
            })}
            {chip.description && <span className="text-ink-muted"> · {chip.description}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

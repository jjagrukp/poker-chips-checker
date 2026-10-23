import { useId } from 'react';
import type { ValidationReport } from '@/core/validation/report';
import { Chip } from '@/shared/components/Chip';
import { chipValueLabel } from '@/shared/components/chip-colour';
import { Icon } from '@/shared/components/Icon';
import { IssueList } from '@/shared/components/IssueList';
import {
  buttonIcon,
  buttonPrimary,
  buttonQuiet,
  buttonSecondary,
  card,
  hint,
  input,
  label,
} from '@/shared/components/styles';
import { useT } from '@/shared/messages/tone';
import { colourChange, newRow, type ChipRow } from './rows';

// Inventory review (spec 05 §2), shared by the manual, saved and (M9) photo routes.

interface Props {
  name: string;
  rows: readonly ChipRow[];
  report: ValidationReport;
  confirmed: boolean;
  newId: () => string;
  onNameChange: (name: string) => void;
  onRowsChange: (rows: ChipRow[]) => void;
  onSuggest: () => void;
  onConfirm: () => void;
}

export function InventoryReview(props: Props) {
  const t = useT();
  const { rows, report, confirmed, onRowsChange } = props;
  const nameId = useId();
  const patch = (i: number, change: Partial<ChipRow>) =>
    onRowsChange(rows.map((r, j) => (j === i ? { ...r, ...change } : r)));
  const anyBlankValue = rows.some((r) => r.used && r.valueText.trim() === '');
  const invalidPaths = new Set(report.errors.map((e) => e.path));

  return (
    <section className="flex flex-col gap-4" aria-labelledby={`${nameId}-heading`}>
      <h2 id={`${nameId}-heading`} className="text-2xl font-semibold">
        {t('inventory.review.title')}
      </h2>
      <div className="flex flex-col gap-1">
        <label htmlFor={nameId} className={label}>
          {t('inventory.review.name')}
        </label>
        <input
          id={nameId}
          className={input}
          value={props.name}
          maxLength={60}
          onChange={(e) => props.onNameChange(e.target.value)}
        />
      </div>

      {rows.length === 0 && <p className={hint}>{t('inventory.empty')}</p>}
      <ul className="flex flex-col gap-3">
        {rows.map((row, i) => (
          <ChipRowEditor
            key={row.id}
            row={row}
            index={i}
            invalid={{
              quantity: invalidPaths.has(`chipTypes.${i}.quantity`),
              value: invalidPaths.has(`values.${row.id}`),
            }}
            onChange={(change) => patch(i, change)}
            onDelete={() => onRowsChange(rows.filter((_, j) => j !== i))}
          />
        ))}
      </ul>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={buttonSecondary}
          onClick={() => onRowsChange([...rows, newRow(props.newId())])}
        >
          <Icon name="plus" className="size-4" />
          {t('inventory.addRow')}
        </button>
        {anyBlankValue && (
          <button type="button" className={buttonSecondary} onClick={props.onSuggest}>
            {t('inventory.suggest')}
          </button>
        )}
      </div>
      {anyBlankValue && <p className={hint}>{t('inventory.suggestHint')}</p>}

      <IssueList issues={report.errors} kind="error" />
      {confirmed ? (
        <p role="status" className="flex items-center gap-2 font-semibold text-state-level">
          <Icon name="check" />
          {t('inventory.confirmed')}
        </p>
      ) : (
        <button
          type="button"
          className={buttonPrimary}
          disabled={report.errors.length > 0}
          onClick={props.onConfirm}
        >
          {t('inventory.confirm')}
        </button>
      )}
    </section>
  );
}

interface RowProps {
  row: ChipRow;
  index: number;
  invalid: { quantity: boolean; value: boolean };
  onChange: (change: Partial<ChipRow>) => void;
  onDelete: () => void;
}

function ChipRowEditor({ row, index, invalid, onChange, onDelete }: RowProps) {
  const t = useT();
  const id = useId();
  const name = row.colour.trim() || t('inventory.row.unnamed', { n: index + 1 });
  const quantity = /^\d+$/.test(row.quantityText.trim()) ? Number(row.quantityText) : 0;
  const bump = (delta: number) =>
    onChange({ quantityText: String(Math.max(0, quantity + delta)), checkCount: false });
  const value = /^\d+$/.test(row.valueText.trim()) ? Number(row.valueText) : undefined;
  return (
    <li
      className={`${card} flex flex-col gap-4 ${row.confirmed ? '' : 'border-dashed border-state-warning/70'} ${row.used ? '' : 'opacity-70'}`}
      aria-label={t('inventory.rowLabel', { name })}
    >
      <div className="flex items-center gap-3">
        <Chip
          colour={row.swatch}
          value={row.used && value ? chipValueLabel(value) : undefined}
          className="size-14 sm:size-16"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor={`${id}-colour`} className={label}>
            {t('inventory.row.colour')}
          </label>
          <input
            id={`${id}-colour`}
            className={input}
            value={row.colour}
            maxLength={30}
            onChange={(e) => onChange(colourChange(row, e.target.value))}
          />
        </div>
        <div className="flex flex-col items-center gap-1">
          <label htmlFor={`${id}-swatch`} className={`${label} text-xs`}>
            {t('inventory.row.swatch')}
          </label>
          <input
            id={`${id}-swatch`}
            type="color"
            className="size-11 cursor-pointer rounded-full border border-ink-muted/40 bg-surface-high p-1 [&::-moz-color-swatch]:rounded-full [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0"
            value={row.swatch}
            onChange={(e) => onChange({ swatch: e.target.value, swatchPicked: true })}
          />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-quantity`} className={label}>
            {t('inventory.row.quantity')}
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              className={buttonIcon}
              aria-label={t('inventory.row.decrease', { name })}
              onClick={() => bump(-1)}
            >
              <Icon name="minus" />
            </button>
            <input
              id={`${id}-quantity`}
              className={`${input} text-center font-clock text-xl font-semibold tabular-nums`}
              inputMode="numeric"
              aria-invalid={invalid.quantity}
              aria-describedby={row.checkCount ? `${id}-check` : undefined}
              value={row.quantityText}
              onChange={(e) => onChange({ quantityText: e.target.value, checkCount: false })}
            />
            <button
              type="button"
              className={buttonIcon}
              aria-label={t('inventory.row.increase', { name })}
              onClick={() => bump(1)}
            >
              <Icon name="plus" />
            </button>
          </div>
          {row.checkCount && (
            <p id={`${id}-check`} className="text-sm font-semibold text-state-warning">
              {t('inventory.row.checkCount')}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-value`} className={label}>
            {t('inventory.row.value')}
          </label>
          <input
            id={`${id}-value`}
            className={`${input} font-clock text-xl font-semibold tabular-nums`}
            inputMode="numeric"
            disabled={!row.used}
            aria-invalid={invalid.value}
            value={row.used ? row.valueText : ''}
            onChange={(e) => onChange({ valueText: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1 sm:col-span-2">
          <label htmlFor={`${id}-description`} className={label}>
            {t('inventory.row.description')}
          </label>
          <input
            id={`${id}-description`}
            className={input}
            value={row.description ?? ''}
            maxLength={60}
            onChange={(e) => onChange({ description: e.target.value })}
          />
        </div>
      </div>
      {!row.confirmed && row.notes && (
        <p className={hint}>{t('inventory.row.aiNote', { note: row.notes })}</p>
      )}
      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <label className="flex min-h-11 items-center gap-2 font-semibold">
          <input
            type="checkbox"
            className="size-5 accent-accent"
            checked={row.used}
            onChange={(e) => onChange({ used: e.target.checked })}
          />
          {t('inventory.row.used')}
        </label>
        {!row.confirmed && (
          <button
            type="button"
            className={buttonSecondary}
            onClick={() => onChange({ confirmed: true, checkCount: false })}
          >
            <Icon name="check" className="size-4" />
            {t('inventory.row.confirm', { name })}
          </button>
        )}
        <button type="button" className={`${buttonQuiet} ml-auto text-ink-muted`} onClick={onDelete}>
          <Icon name="trash" className="size-4" />
          {t('inventory.row.delete', { name })}
        </button>
      </div>
    </li>
  );
}

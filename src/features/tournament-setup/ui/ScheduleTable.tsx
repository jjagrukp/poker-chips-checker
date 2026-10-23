import { useId, useState } from 'react';
import type { ModuleContext } from '@/core/modules/contract';
import type { Schedule, Segment } from '@/core/scheduling/schedule';
import { MINUTE } from '@/core/time';
import type { HoldemConfig } from '@/modules/texas-holdem/config';
import { HoldemEditError, insertBreak, removeBreak, setLevel } from '@/modules/texas-holdem/edits';
import { formatBlinds, formatChips, formatDurationMin } from '@/modules/texas-holdem/format';
import { levelData } from '@/modules/texas-holdem/generate';
import { Icon } from '@/shared/components/Icon';
import { buttonPrimary, buttonQuiet, input, label } from '@/shared/components/styles';
import { useT } from '@/shared/messages/tone';

// Schedule preview/editor (spec 01 §5 screen 5). Read-only on the review step; editable on
// the structure step via the module's pure edit operations.

const DEFAULT_BREAK_MIN = 10;

interface Props {
  schedule: Schedule;
  editor?: {
    config: HoldemConfig;
    ctx: ModuleContext;
    onEdit: (schedule: Schedule) => void;
    /** Running tournament: segments before this index are locked (spec 03 §7). */
    lockedBefore?: number;
  };
  /** Highlights the segment being played. */
  currentIndex?: number;
}

export function ScheduleTable({ schedule, editor, currentIndex }: Props) {
  const t = useT();
  const [editing, setEditing] = useState<string | null>(null);
  const segments = schedule.segments;
  const locked = editor?.lockedBefore ?? 0;
  let elapsedMin = 0;

  const apply = (edit: () => Schedule) => {
    try {
      editor?.onEdit(edit());
      setEditing(null);
    } catch (error) {
      if (!(error instanceof HoldemEditError)) throw error;
    }
  };

  const cell = 'px-3 py-2.5 align-middle';
  const wide = 'hidden sm:table-cell';
  return (
    <div className="overflow-x-auto rounded-3xl border border-line bg-surface-raised/80">
      <table className="w-full border-collapse text-left text-sm">
        <caption className="sr-only">{t('schedule.heading')}</caption>
        <thead>
          <tr className="border-b border-line text-xs uppercase tracking-[0.12em] text-ink-muted">
            <th scope="col" className={cell}>{t('schedule.col.segment')}</th>
            <th scope="col" className={cell}>{t('schedule.col.blinds')}</th>
            <th scope="col" className={`${cell} ${wide}`}>{t('schedule.col.ante')}</th>
            <th scope="col" className={cell}>{t('schedule.col.length')}</th>
            <th scope="col" className={`${cell} ${wide}`}>{t('schedule.col.starts')}</th>
            {editor && (
              <th scope="col" className={cell}>
                <span className="sr-only">{t('schedule.col.actions')}</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {segments.map((segment, index) => {
            const startsAt = elapsedMin;
            elapsedMin += segment.durationMs / MINUTE;
            if (editor && editing === segment.id) {
              return (
                <LevelEditRow
                  key={segment.id}
                  segment={segment}
                  onCancel={() => setEditing(null)}
                  onSave={(patch) =>
                    apply(() => setLevel(schedule, editor.config, editor.ctx, index, patch).schedule)
                  }
                />
              );
            }
            const data = levelData(segment);
            const next = segments[index + 1];
            const canAddBreak =
              index >= locked && segment.kind === 'level' && next !== undefined && next.kind !== 'break';
            const current = index === currentIndex;
            return (
              <tr
                key={segment.id}
                aria-current={current ? 'step' : undefined}
                className={`border-b border-line last:border-0 ${
                  segment.kind === 'break' ? 'bg-state-break/[0.07] text-state-break' : ''
                } ${current ? 'bg-accent/10 shadow-[inset_3px_0_0_var(--color-accent)]' : ''}`}
              >
                <th scope="row" className={`${cell} font-semibold`}>
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    {segment.kind === 'break' && <Icon name="coffee" className="size-4" />}
                    {segment.kind === 'level'
                      ? t('holdem.segment.level', { number: segment.levelNumber ?? index + 1 })
                      : t('holdem.segment.break')}
                    {segment.estimatedFinish && (
                      <span className="rounded-full bg-state-completed px-2 py-0.5 text-xs text-accent-ink">
                        {t('schedule.estimatedFinish')}
                      </span>
                    )}
                  </span>
                </th>
                <td className={`${cell} font-clock text-base font-semibold whitespace-nowrap tabular-nums`}>
                  {data ? formatBlinds(data.sb, data.bb) : ''}
                  {data && data.ante > 0 && (
                    <span className="block text-xs font-medium text-ink-muted sm:hidden">
                      {t('clock.ante', { ante: formatChips(data.ante) })}
                    </span>
                  )}
                </td>
                <td className={`${cell} ${wide} font-clock text-base tabular-nums`}>
                  {data && data.ante > 0 ? formatChips(data.ante) : ''}
                </td>
                <td className={`${cell} tabular-nums`}>{formatDurationMin(segment.durationMs / MINUTE)}</td>
                <td className={`${cell} ${wide} tabular-nums text-ink-muted`}>{formatDurationMin(startsAt)}</td>
                {editor && (
                  <td className="px-2 py-1">
                    <div className="flex justify-end gap-1">
                      {index < locked ? null : segment.kind === 'level' ? (
                        <>
                          <button
                            type="button"
                            className={actionButton}
                            aria-label={t('schedule.editLevel', { number: segment.levelNumber ?? '' })}
                            title={t('schedule.edit')}
                            onClick={() => setEditing(segment.id)}
                          >
                            <Icon name="edit" className="size-4" />
                          </button>
                          {canAddBreak && (
                            <button
                              type="button"
                              className={actionButton}
                              aria-label={t('schedule.addBreakAfter', {
                                number: segment.levelNumber ?? '',
                              })}
                              title={t('schedule.addBreak')}
                              onClick={() =>
                                apply(
                                  () =>
                                    insertBreak(schedule, editor.config, editor.ctx, index, DEFAULT_BREAK_MIN)
                                      .schedule,
                                )
                              }
                            >
                              <Icon name="coffee" className="size-4" />
                            </button>
                          )}
                        </>
                      ) : index === locked ? null : (
                        <button
                          type="button"
                          className={actionButton}
                          aria-label={t('schedule.removeBreak')}
                          title={t('schedule.removeBreak')}
                          onClick={() =>
                            apply(() => removeBreak(schedule, editor.config, editor.ctx, index).schedule)
                          }
                        >
                          <Icon name="trash" className="size-4" />
                        </button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const actionButton =
  'inline-flex size-11 items-center justify-center rounded-full text-ink-muted transition hover:bg-white/10 hover:text-ink';

interface EditProps {
  segment: Segment;
  onSave: (patch: { sb: number; bb: number; ante: number; durationMin: number }) => void;
  onCancel: () => void;
}

function LevelEditRow({ segment, onSave, onCancel }: EditProps) {
  const t = useT();
  const id = useId();
  const data = levelData(segment);
  const [fields, setFields] = useState({
    sb: String(data?.sb ?? ''),
    bb: String(data?.bb ?? ''),
    ante: String(data?.ante ?? 0),
    durationMin: String(segment.durationMs / MINUTE),
  });
  const parse = (text: string) => (/^\d+$/.test(text.trim()) ? Number(text) : NaN);
  const values = {
    sb: parse(fields.sb),
    bb: parse(fields.bb),
    ante: parse(fields.ante),
    durationMin: parse(fields.durationMin),
  };
  const valid =
    values.sb > 0 && values.bb > 0 && values.ante >= 0 && values.durationMin > 0;
  const field = (key: keyof typeof fields, text: string) => (
    <div className="flex flex-col gap-1">
      <label htmlFor={`${id}-${key}`} className={label}>
        {text}
      </label>
      <input
        id={`${id}-${key}`}
        className={input}
        inputMode="numeric"
        value={fields[key]}
        aria-invalid={Number.isNaN(values[key])}
        onChange={(e) => setFields((f) => ({ ...f, [key]: e.target.value }))}
      />
    </div>
  );
  return (
    <tr className="border-b border-line bg-surface-high/60">
      <td colSpan={6} className="p-3">
        <fieldset className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <legend className="mb-1 font-semibold">
            {t('schedule.editLevel', { number: segment.levelNumber ?? '' })}
          </legend>
          {field('sb', t('setup.structure.sb'))}
          {field('bb', t('setup.structure.bb'))}
          {field('ante', t('schedule.col.ante'))}
          {field('durationMin', t('setup.structure.levelLength'))}
          <div className="flex items-end gap-2">
            <button
              type="button"
              className={buttonPrimary}
              disabled={!valid}
              onClick={() => onSave(values)}
            >
              {t('schedule.save')}
            </button>
            <button type="button" className={buttonQuiet} onClick={onCancel}>
              {t('schedule.cancel')}
            </button>
          </div>
        </fieldset>
      </td>
    </tr>
  );
}

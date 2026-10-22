import { useId, useState } from 'react';
import type { ModuleContext } from '@/core/modules/contract';
import type { Schedule, Segment } from '@/core/scheduling/schedule';
import { MINUTE } from '@/core/time';
import type { HoldemConfig } from '@/modules/texas-holdem/config';
import { HoldemEditError, insertBreak, removeBreak, setLevel } from '@/modules/texas-holdem/edits';
import { formatBlinds, formatChips, formatDurationMin } from '@/modules/texas-holdem/format';
import { levelData } from '@/modules/texas-holdem/generate';
import { buttonPrimary, buttonQuiet, input, label } from '@/shared/components/styles';
import { useT } from '@/shared/messages/tone';

// Schedule preview/editor (spec 01 §5 screen 5). Read-only on the review step; editable on
// the structure step via the module's pure edit operations.

const DEFAULT_BREAK_MIN = 10;

interface Props {
  schedule: Schedule;
  editor?: { config: HoldemConfig; ctx: ModuleContext; onEdit: (schedule: Schedule) => void };
}

export function ScheduleTable({ schedule, editor }: Props) {
  const t = useT();
  const [editing, setEditing] = useState<string | null>(null);
  const segments = schedule.segments;
  let elapsedMin = 0;

  const apply = (edit: () => Schedule) => {
    try {
      editor?.onEdit(edit());
      setEditing(null);
    } catch (error) {
      if (!(error instanceof HoldemEditError)) throw error;
    }
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <caption className="sr-only">{t('schedule.heading')}</caption>
        <thead>
          <tr className="border-b border-ink-muted/40">
            <th scope="col" className="py-2 pr-2">{t('schedule.col.segment')}</th>
            <th scope="col" className="py-2 pr-2">{t('schedule.col.blinds')}</th>
            <th scope="col" className="py-2 pr-2">{t('schedule.col.ante')}</th>
            <th scope="col" className="py-2 pr-2">{t('schedule.col.length')}</th>
            <th scope="col" className="py-2 pr-2">{t('schedule.col.starts')}</th>
            {editor && (
              <th scope="col" className="py-2">
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
              segment.kind === 'level' && next !== undefined && next.kind !== 'break';
            return (
              <tr
                key={segment.id}
                className={`border-b border-ink-muted/20 ${segment.kind === 'break' ? 'text-state-break' : ''}`}
              >
                <th scope="row" className="py-2 pr-2 font-semibold">
                  {segment.kind === 'level'
                    ? t('holdem.segment.level', { number: segment.levelNumber ?? index + 1 })
                    : t('holdem.segment.break')}
                  {segment.estimatedFinish && (
                    <span className="ml-2 rounded-full bg-state-completed px-2 py-0.5 text-xs text-accent-ink">
                      {t('schedule.estimatedFinish')}
                    </span>
                  )}
                </th>
                <td className="py-2 pr-2">{data ? formatBlinds(data.sb, data.bb) : ''}</td>
                <td className="py-2 pr-2">{data && data.ante > 0 ? formatChips(data.ante) : ''}</td>
                <td className="py-2 pr-2">{formatDurationMin(segment.durationMs / MINUTE)}</td>
                <td className="py-2 pr-2">{formatDurationMin(startsAt)}</td>
                {editor && (
                  <td className="py-1">
                    <div className="flex flex-wrap gap-1">
                      {segment.kind === 'level' ? (
                        <>
                          <button
                            type="button"
                            className={buttonQuiet}
                            aria-label={t('schedule.editLevel', { number: segment.levelNumber ?? '' })}
                            onClick={() => setEditing(segment.id)}
                          >
                            {t('schedule.edit')}
                          </button>
                          {canAddBreak && (
                            <button
                              type="button"
                              className={buttonQuiet}
                              aria-label={t('schedule.addBreakAfter', {
                                number: segment.levelNumber ?? '',
                              })}
                              onClick={() =>
                                apply(
                                  () =>
                                    insertBreak(schedule, editor.config, editor.ctx, index, DEFAULT_BREAK_MIN)
                                      .schedule,
                                )
                              }
                            >
                              {t('schedule.addBreak')}
                            </button>
                          )}
                        </>
                      ) : (
                        <button
                          type="button"
                          className={buttonQuiet}
                          onClick={() =>
                            apply(() => removeBreak(schedule, editor.config, editor.ctx, index).schedule)
                          }
                        >
                          {t('schedule.removeBreak')}
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
    <tr className="border-b border-ink-muted/20">
      <td colSpan={6} className="py-2">
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

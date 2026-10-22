import { useId, useState } from 'react';
import type { ModuleContext } from '@/core/modules/contract';
import type { Schedule } from '@/core/scheduling/schedule';
import type { Ms } from '@/core/time';
import type { EditOptions } from '@/core/timer/commands';
import { ScheduleTable } from '@/features/tournament-setup/ui/ScheduleTable';
import type { HoldemConfig } from '@/modules/texas-holdem/config';
import { diffSchedules } from '@/modules/texas-holdem/edits';
import { buttonPrimary, buttonQuiet, buttonSecondary, card } from '@/shared/components/styles';
import { useT } from '@/shared/messages/tone';
import { endsCurrentNow } from '../domain/screen';
import type { EditOutcome } from '../state/clock-store';

// Schedule edits while running (spec 03 §7): edits stage in a draft shown in the table (the
// preview) and apply in one write. Past segments are locked; the current one keeps its
// elapsed time unless the host chooses to restart it.

interface Props {
  schedule: Schedule;
  config: HoldemConfig;
  ctx: ModuleContext;
  currentIndex: number;
  levelRemainingMs: Ms;
  onApply: (edited: Schedule, options: EditOptions) => Promise<EditOutcome>;
  onClose: () => void;
}

export function RunningEditor({
  schedule,
  config,
  ctx,
  currentIndex,
  levelRemainingMs,
  onApply,
  onClose,
}: Props) {
  const t = useT();
  const headingId = useId();
  const [draft, setDraft] = useState<Schedule | null>(null);
  const [restart, setRestart] = useState(false);
  const [confirmEndsNow, setConfirmEndsNow] = useState(false);
  const [pastChanged, setPastChanged] = useState(false);

  const endsNow =
    draft !== null && !restart && endsCurrentNow(schedule, draft, currentIndex, levelRemainingMs);

  const reset = () => {
    setDraft(null);
    setRestart(false);
    setConfirmEndsNow(false);
  };

  const apply = async () => {
    if (!draft) return;
    if (endsNow && !confirmEndsNow) {
      setConfirmEndsNow(true);
      return;
    }
    const diff = diffSchedules(schedule.segments, draft.segments);
    const outcome = await onApply(draft, {
      restartCurrent: restart,
      detail: {
        added: diff.added.map((s) => s.id),
        removed: diff.removed.map((s) => s.id),
        changed: diff.changed.map((c) => c.after.id),
      },
    });
    setPastChanged(outcome === 'pastChanged');
    if (outcome === 'applied') reset();
  };

  return (
    <section className={`${card} flex flex-col gap-3`} aria-labelledby={headingId}>
      <div className="flex items-center justify-between gap-2">
        <h2 id={headingId} className="text-xl font-semibold">
          {t('clock.edit.heading')}
        </h2>
        <button type="button" className={buttonQuiet} onClick={onClose}>
          {t('clock.edit.close')}
        </button>
      </div>
      <p className="text-sm text-ink-muted">{t('clock.edit.hint')}</p>
      <ScheduleTable
        schedule={draft ?? schedule}
        currentIndex={currentIndex}
        editor={{
          config,
          ctx,
          lockedBefore: currentIndex,
          onEdit: (edited) => {
            setDraft(edited);
            setConfirmEndsNow(false);
            setPastChanged(false);
          },
        }}
      />
      {pastChanged && <p role="alert">{t('clock.edit.pastChanged')}</p>}
      {draft && (
        <div className="flex flex-col gap-3">
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              className="size-5"
              checked={restart}
              onChange={(e) => {
                setRestart(e.target.checked);
                setConfirmEndsNow(false);
              }}
            />
            {t('clock.edit.restart')}
          </label>
          {confirmEndsNow && <p role="alert">{t('clock.edit.endsNow')}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={buttonPrimary} onClick={() => void apply()}>
              {confirmEndsNow ? t('clock.edit.confirmEndsNow') : t('clock.edit.apply')}
            </button>
            <button type="button" className={buttonSecondary} onClick={reset}>
              {t('clock.edit.discard')}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

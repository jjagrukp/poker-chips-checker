import { useId } from 'react';
import { MINUTE } from '@/core/time';
import type { HoldemConfig } from '@/modules/texas-holdem/config';
import { formatBlinds, formatDurationMin } from '@/modules/texas-holdem/format';
import type { Structure } from '@/modules/texas-holdem/presets';
import { IssueList } from '@/shared/components/IssueList';
import { NumberField } from '@/shared/components/NumberField';
import { buttonSecondary, card, hint, input, label } from '@/shared/components/styles';
import type { MessageKey } from '@/shared/messages';
import { useT } from '@/shared/messages/tone';
import {
  resetSchedule,
  review,
  setBreakEnd,
  setCustom,
  setEditedSchedule,
  setStructure,
} from '../../state/wizard';
import { useUpdate, useWizard, useWizardEnv } from '../context';
import { ScheduleTable } from '../ScheduleTable';

// Step 5 (spec 01 §5): presets, an advanced panel (any change there switches to Custom) and
// per-level editing.

const STRUCTURES: { id: Structure; name: MessageKey; hint: MessageKey }[] = [
  { id: 'gentle', name: 'setup.structure.gentle', hint: 'setup.structure.gentleHint' },
  { id: 'standard', name: 'setup.structure.standard', hint: 'setup.structure.standardHint' },
  { id: 'turbo', name: 'setup.structure.turbo', hint: 'setup.structure.turboHint' },
  { id: 'custom', name: 'setup.structure.custom', hint: 'setup.structure.customHint' },
];

const ANTE_MODES: { id: HoldemConfig['ante']['mode']; name: MessageKey }[] = [
  { id: 'none', name: 'setup.structure.ante.none' },
  { id: 'bigBlind', name: 'setup.structure.ante.bigBlind' },
  { id: 'traditional', name: 'setup.structure.ante.traditional' },
];

const DEFAULT_BREAKS = { everyMin: 60, durationMin: 10 };

export function StructureStep() {
  const t = useT();
  const { ctx } = useWizardEnv();
  const update = useUpdate();
  const state = useWizard((s) => s);
  const { config, draft } = state;
  const r = review(state, ctx);
  const ids = { ante: useId(), breakEnd: useId(), structure: useId() };
  const levels = draft.schedule?.segments.filter((s) => s.kind === 'level') ?? [];
  const minutes = (n: number) => formatDurationMin(n);

  const num = (
    text: MessageKey,
    value: number,
    min: number,
    max: number,
    commit: (n: number) => void,
  ) => (
    <NumberField
      label={t(text)}
      value={value}
      min={min}
      max={max}
      error={t('setup.structure.rangeError', { min, max })}
      commitOn="blur"
      onCommit={(n) => n !== value && commit(n)}
    />
  );

  return (
    <section className="flex flex-col gap-5">
      <fieldset className="grid gap-2 sm:grid-cols-2">
        <legend className="mb-2 font-semibold">{t('setup.structure.legend')}</legend>
        {STRUCTURES.map((s) => (
          <label
            key={s.id}
            htmlFor={`${ids.structure}-${s.id}`}
            className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-xl px-4 py-3 ${
              config.structure === s.id ? 'bg-accent text-accent-ink' : 'bg-surface-raised'
            }`}
          >
            <input
              id={`${ids.structure}-${s.id}`}
              type="radio"
              name="structure"
              className="mt-1"
              checked={config.structure === s.id}
              onChange={() => update((st) => setStructure(st, s.id))}
            />
            <span className="flex flex-col">
              <strong>{t(s.name)}</strong>
              {t(s.hint)}
            </span>
          </label>
        ))}
      </fieldset>

      <p className={card}>
        {t('setup.structure.summary', {
          levels: levels.length,
          length: minutes(config.levelDurationMin),
          blinds: formatBlinds(config.startingBlinds.sb, config.startingBlinds.bb),
        })}
      </p>

      <IssueList issues={[...r.config.errors, ...r.scheduleReport.errors]} kind="error" />
      <IssueList issues={[...r.config.warnings, ...r.scheduleReport.warnings]} kind="warning" />

      <details className={card}>
        <summary className="min-h-11 cursor-pointer py-2 font-semibold">
          {t('setup.structure.advanced')}
        </summary>
        <p className={`${hint} mb-3`}>{t('setup.structure.customNote')}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {num('setup.structure.sb', config.startingBlinds.sb, 1, 1_000_000, (sb) =>
            update((s) => setCustom(s, { startingBlinds: { ...s.config.startingBlinds, sb } })),
          )}
          {num('setup.structure.bb', config.startingBlinds.bb, 1, 1_000_000, (bb) =>
            update((s) => setCustom(s, { startingBlinds: { ...s.config.startingBlinds, bb } })),
          )}
          {num('setup.structure.levelLength', config.levelDurationMin, 1, 120, (levelDurationMin) =>
            update((s) => setCustom(s, { levelDurationMin })),
          )}
          {num('setup.structure.growth', Math.round(config.growth * 100), 5, 200, (pct) =>
            update((s) => setCustom(s, { growth: pct / 100 })),
          )}
          <div className="flex flex-col gap-1">
            <label htmlFor={ids.ante} className={label}>
              {t('setup.structure.ante')}
            </label>
            <select
              id={ids.ante}
              className={input}
              value={config.ante.mode}
              onChange={(e) => {
                const mode = e.target.value as HoldemConfig['ante']['mode'];
                update((s) => setCustom(s, { ante: { mode, startLevel: s.config.ante.startLevel } }));
              }}
            >
              {ANTE_MODES.map((m) => (
                <option key={m.id} value={m.id}>
                  {t(m.name)}
                </option>
              ))}
            </select>
          </div>
          {config.ante.mode !== 'none' &&
            num('setup.structure.anteStart', config.ante.startLevel, 1, 50, (startLevel) =>
              update((s) => setCustom(s, { ante: { ...s.config.ante, startLevel } })),
            )}
          <label className="flex min-h-11 items-center gap-2 sm:col-span-2">
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={config.breaks !== null}
              onChange={(e) => {
                const breaks = e.target.checked ? DEFAULT_BREAKS : null;
                update((s) => setCustom(s, { breaks }));
              }}
            />
            {t('setup.structure.breaksOn')}
          </label>
          {config.breaks && (
            <>
              {num('setup.structure.breakEvery', config.breaks.everyMin, 10, 300, (everyMin) =>
                update((s) =>
                  setCustom(s, { breaks: { ...(s.config.breaks ?? DEFAULT_BREAKS), everyMin } }),
                ),
              )}
              {num('setup.structure.breakLength', config.breaks.durationMin, 1, 60, (durationMin) =>
                update((s) =>
                  setCustom(s, { breaks: { ...(s.config.breaks ?? DEFAULT_BREAKS), durationMin } }),
                ),
              )}
            </>
          )}
          <fieldset className="flex flex-col gap-1 sm:col-span-2">
            <legend className={label}>{t('setup.structure.breakEnd')}</legend>
            {(['waitForHost', 'auto'] as const).map((b) => (
              <label key={b} className="flex min-h-11 items-center gap-2">
                <input
                  type="radio"
                  name={ids.breakEnd}
                  checked={config.breakEndBehaviour === b}
                  onChange={() => update((s) => setBreakEnd(s, b))}
                />
                {t(b === 'auto' ? 'setup.structure.breakEnd.auto' : 'setup.structure.breakEnd.waitForHost')}
              </label>
            ))}
          </fieldset>
        </div>
      </details>

      <div className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">{t('schedule.heading')}</h2>
        <p className={hint}>{t('setup.structure.editsNote')}</p>
        {draft.scheduleEdited && (
          <button
            type="button"
            className={buttonSecondary + ' self-start'}
            onClick={() => update(resetSchedule)}
          >
            {t('setup.structure.resetSchedule')}
          </button>
        )}
        {draft.schedule && (
          <ScheduleTable
            schedule={draft.schedule}
            editor={{
              config,
              ctx,
              onEdit: (schedule) => update((s) => setEditedSchedule(s, schedule)),
            }}
          />
        )}
        <p className={hint}>
          {t('setup.structure.levelCount', {
            levels: levels.length,
            total: minutes((draft.schedule?.segments ?? []).reduce((n, s) => n + s.durationMs, 0) / MINUTE),
          })}
        </p>
      </div>
    </section>
  );
}

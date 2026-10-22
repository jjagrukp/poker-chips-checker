import { useId } from 'react';
import { texasHoldemModule } from '@/modules/texas-holdem/module';
import { NumberField } from '@/shared/components/NumberField';
import { card, hint, input, label } from '@/shared/components/styles';
import { useT } from '@/shared/messages/tone';
import { setName, setPlannedStart, setPlayers } from '../../state/wizard';
import { useUpdate, useWizard } from '../context';

/** `datetime-local` works in local time without seconds. */
function toLocalInput(at: number | undefined): string {
  if (at === undefined) return '';
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function BasicsStep() {
  const t = useT();
  const update = useUpdate();
  const name = useWizard((s) => s.tournament.name ?? '');
  const players = useWizard((s) => s.config.players);
  const plannedStartAt = useWizard((s) => s.tournament.plannedStartAt);
  const ids = { name: useId(), start: useId(), startHint: useId() };
  const { min, max } = texasHoldemModule.playerRange;

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <label htmlFor={ids.name} className={label}>
          {t('setup.basics.name')}
        </label>
        <input
          id={ids.name}
          className={input}
          value={name}
          maxLength={80}
          onChange={(e) => update((s) => setName(s, e.target.value))}
        />
      </div>

      <dl className={`${card} grid grid-cols-[auto_1fr] gap-x-4 gap-y-1`}>
        <dt className={label}>{t('setup.basics.game')}</dt>
        <dd>{t('holdem.module.name')}</dd>
        <dt className={label}>{t('setup.basics.format')}</dt>
        <dd>
          {t('setup.basics.freezeout')}
          <span className={`block ${hint}`}>{t('setup.basics.formatHint')}</span>
        </dd>
      </dl>

      <NumberField
        label={t('setup.basics.players')}
        value={players}
        min={min}
        max={max}
        error={t('setup.basics.playersError', { min, max })}
        stepper={{ decrease: t('setup.basics.fewerPlayers'), increase: t('setup.basics.morePlayers') }}
        onCommit={(n) => update((s) => setPlayers(s, n))}
      />

      <div className="flex flex-col gap-1">
        <label htmlFor={ids.start} className={label}>
          {t('setup.basics.plannedStart')}
        </label>
        <input
          id={ids.start}
          type="datetime-local"
          className={input}
          aria-describedby={ids.startHint}
          value={toLocalInput(plannedStartAt)}
          onChange={(e) => {
            const at = e.target.value ? new Date(e.target.value).getTime() : undefined;
            update((s) => setPlannedStart(s, at !== undefined && Number.isFinite(at) ? at : undefined));
          }}
        />
        <p id={ids.startHint} className={hint}>
          {t('setup.basics.plannedStartHint')}
        </p>
      </div>
    </section>
  );
}

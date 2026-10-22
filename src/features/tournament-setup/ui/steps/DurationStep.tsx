import { formatDurationMin } from '@/modules/texas-holdem/format';
import { NumberField } from '@/shared/components/NumberField';
import { card, hint } from '@/shared/components/styles';
import { useT } from '@/shared/messages/tone';
import { CUSTOM_DURATION_MIN, DURATION_PRESETS_MIN, setTarget } from '../../state/wizard';
import { useUpdate, useWizard } from '../context';

export function DurationStep() {
  const t = useT();
  const update = useUpdate();
  const target = useWizard((s) => s.config.targetDurationMin);
  const mode = useWizard((s) => s.draft.durationMode);
  const { min, max } = CUSTOM_DURATION_MIN;

  const option = (checked: boolean, text: string, onSelect: () => void, key: string) => (
    <label
      key={key}
      className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-4 py-2 ${
        checked ? 'bg-accent text-accent-ink' : 'bg-surface-raised'
      }`}
    >
      <input type="radio" name="duration" checked={checked} onChange={onSelect} />
      <span className="font-semibold">{text}</span>
    </label>
  );

  return (
    <section className="flex flex-col gap-5">
      <p className={card}>{t('setup.duration.hint')}</p>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 font-semibold">{t('setup.duration.legend')}</legend>
        {DURATION_PRESETS_MIN.map((m) =>
          option(
            mode === 'preset' && target === m,
            formatDurationMin(m),
            () => update((s) => setTarget(s, m, 'preset')),
            String(m),
          ),
        )}
        {option(
          mode === 'custom',
          t('setup.duration.custom'),
          () => update((s) => setTarget(s, s.config.targetDurationMin, 'custom')),
          'custom',
        )}
      </fieldset>
      {mode === 'custom' && (
        <NumberField
          label={t('setup.duration.customLabel')}
          value={target}
          min={min}
          max={max}
          error={t('setup.duration.customError', { min, max })}
          onCommit={(n) => update((s) => setTarget(s, n, 'custom'))}
        />
      )}
      <p className={hint}>{t('setup.duration.includesBreaks')}</p>
    </section>
  );
}

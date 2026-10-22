import { useId, useState } from 'react';
import {
  ALERT_TYPES,
  alertEnabled,
  alertVolume,
  type AlertPrefs,
  type AlertType,
} from '@/core/alerts/alerts';
import type { AlertAudio } from '@/infrastructure/audio/alert-audio';
import type { AlertNotifier } from '@/infrastructure/notifications/notifier';
import { buttonSecondary, card, hint, label } from '@/shared/components/styles';
import { useT } from '@/shared/messages/tone';

// Sound & alerts panel (spec 03 §6, 01 §5 Settings): sound on/off, volume, per-alert toggles
// with a test button each, screen flash and opt-in notifications.

interface Props {
  prefs: AlertPrefs;
  muted: boolean;
  audio: AlertAudio;
  notifier: AlertNotifier;
  onPrefs: (patch: AlertPrefs) => void;
  onToggleMute: () => void;
  onClose: () => void;
}

const checkbox = 'h-5 w-5 shrink-0 accent-accent';
const row = 'flex min-h-11 items-center gap-3';

export function AlertSettings({ prefs, muted, audio, notifier, onPrefs, onToggleMute, onClose }: Props) {
  const t = useT();
  const id = useId();
  const [access, setAccess] = useState(() => notifier.access());

  const test = async (type: Exclude<AlertType, 'recovery'>) => {
    // A test press is a gesture, so it can unlock audio too.
    await audio.unlock();
    audio.play(type);
  };

  const setNotifications = async (on: boolean) => {
    if (!on) {
      onPrefs({ notifications: false });
      return;
    }
    const result = access === 'granted' ? access : await notifier.request();
    setAccess(result);
    if (result === 'granted') onPrefs({ notifications: true });
  };

  return (
    <section aria-labelledby={id} className={`${card} flex flex-col gap-4`}>
      <h2 id={id} className="font-display text-2xl">
        {t('alerts.heading')}
      </h2>
      <label className={row}>
        <input type="checkbox" className={checkbox} checked={!muted} onChange={onToggleMute} />
        {t('alerts.sound')}
      </label>
      <label className="flex flex-col gap-1">
        <span className={label}>{t('alerts.volume')}</span>
        <input
          type="range"
          className="min-h-11 accent-accent"
          min={0}
          max={100}
          step={5}
          value={Math.round(alertVolume(prefs) * 100)}
          onChange={(e) => onPrefs({ volume: Number(e.target.value) / 100 })}
        />
      </label>
      <fieldset className="flex flex-col gap-1">
        <legend className={label}>{t('alerts.which')}</legend>
        {ALERT_TYPES.map((type) => {
          const name = t(`alerts.type.${type}`);
          return (
            <div key={type} className="flex flex-wrap items-center justify-between gap-2">
              <label className={row}>
                <input
                  type="checkbox"
                  className={checkbox}
                  checked={alertEnabled(prefs, type)}
                  onChange={(e) => onPrefs({ enabled: { [type]: e.target.checked } })}
                />
                {name}
              </label>
              {type !== 'recovery' && (
                <button
                  type="button"
                  className={buttonSecondary}
                  aria-label={t('alerts.test', { name })}
                  onClick={() => void test(type)}
                >
                  {t('alerts.testShort')}
                </button>
              )}
            </div>
          );
        })}
      </fieldset>
      <label className={row}>
        <input
          type="checkbox"
          className={checkbox}
          checked={prefs.flash ?? false}
          onChange={(e) => onPrefs({ flash: e.target.checked })}
        />
        {t('alerts.flash')}
      </label>
      <div className="flex flex-col gap-1">
        <label className={row}>
          <input
            type="checkbox"
            className={checkbox}
            disabled={access === 'unsupported'}
            checked={prefs.notifications === true && access === 'granted'}
            onChange={(e) => void setNotifications(e.target.checked)}
          />
          {t('alerts.notifications')}
        </label>
        {access === 'denied' && <p role="alert">{t('alerts.notifications.denied')}</p>}
        {access === 'unsupported' && <p className={hint}>{t('alerts.notifications.unsupported')}</p>}
        <p className={hint}>{t('alerts.notifications.hint')}</p>
      </div>
      <p className={hint}>{t('alerts.iosNote')}</p>
      <button type="button" className={`${buttonSecondary} self-start`} onClick={onClose}>
        {t('alerts.close')}
      </button>
    </section>
  );
}

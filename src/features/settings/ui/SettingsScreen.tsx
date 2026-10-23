import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { AlertPrefs } from '@/core/alerts/alerts';
import type { Settings } from '@/core/persistence/records';
import type { Repositories, SettingsPatch } from '@/core/persistence/repositories';
import type { Clock } from '@/core/time';
import type { BreakEndBehaviour } from '@/core/timer/anchor';
import { AlertSettings } from '@/features/live-clock/ui/AlertSettings';
import type { AlertAudio } from '@/infrastructure/audio/alert-audio';
import type { DataTools } from '@/infrastructure/backup/data-tools';
import type { AlertNotifier } from '@/infrastructure/notifications/notifier';
import { requestPersistentStorage } from '@/infrastructure/storage-durability/persistence';
import { ConfirmAction } from '@/shared/components/ConfirmAction';
import { buttonQuiet, buttonSecondary, card, hint, label } from '@/shared/components/styles';
import type { MessageKey, Tone } from '@/shared/messages';
import { useT } from '@/shared/messages/tone';
import { datedFilename, downloadText } from '@/shared/utilities/download';
import { LimitationsList } from './Limitations';
import { QuarantineNotice } from './StorageNotices';

// Settings (spec 01 §5 #8): tone, sound & alerts, break-end default, backup/import, delete
// everything, storage status and the known limitations.

interface Props {
  repos: Repositories<unknown>;
  data: DataTools;
  clock: Clock;
  audio: AlertAudio;
  notifier: AlertNotifier;
  appName: string;
  onToneChange: (tone: Tone) => void;
  /** After "Delete all data": the app resets its in-memory state. */
  onDeleted: () => void;
}

const MAX_BACKUP_BYTES = 20 * 1024 * 1024;
const radio = 'h-5 w-5 shrink-0 accent-accent';
const row = 'flex min-h-11 items-center gap-3';
const TONES: Tone[] = ['playful', 'neutral'];
const BREAK_ENDS: BreakEndBehaviour[] = ['waitForHost', 'auto'];

export function SettingsScreen(props: Props) {
  const { repos, data, clock, audio, notifier, appName, onToneChange, onDeleted } = props;
  const t = useT();
  const ids = { tone: useId(), breakEnd: useId(), data: useId(), about: useId() };
  const [settings, setSettings] = useState<Settings>();
  // `status` is announced politely; `problem` is an alert.
  const [status, setStatus] = useState<MessageKey>();
  const [problem, setProblem] = useState<MessageKey>();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const refocusDelete = useRef(false);

  useEffect(() => {
    if (confirmingDelete || !refocusDelete.current) return;
    refocusDelete.current = false;
    deleteButton.current?.focus();
  }, [confirmingDelete]);

  const report = (next: { status?: MessageKey; problem?: MessageKey }) => {
    setStatus(next.status);
    setProblem(next.problem);
  };

  useEffect(() => {
    let cancelled = false;
    repos.settings.get().then(
      (s) => !cancelled && setSettings(s),
      () => !cancelled && setProblem('home.problem.loadFailed'),
    );
    return () => {
      cancelled = true;
    };
  }, [repos]);

  const update = async (patch: SettingsPatch) => {
    // Optimistic: the control moves at once; a failed write says so.
    setSettings((s) => (s ? { ...s, ...patch } : s));
    try {
      setSettings(await repos.settings.update(patch));
    } catch {
      report({ problem: 'settings.saveFailed' });
    }
  };

  const updateAlerts = (patch: AlertPrefs) => {
    const current = settings?.alerts ?? {};
    const alerts = { ...current, ...patch };
    if (patch.enabled) alerts.enabled = { ...current.enabled, ...patch.enabled };
    void update({ alerts });
  };

  const exportAll = async () => {
    try {
      downloadText(datedFilename('tournament-backup', clock.now()), await data.exportAll());
      report({});
    } catch {
      report({ problem: 'settings.data.exportFailed' });
    }
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    // `accept` is only a hint: don't read and parse a huge file picked by mistake.
    if (file.size > MAX_BACKUP_BYTES) return report({ problem: 'backup.import.tooLarge' });
    report({ status: 'settings.data.importing' });
    try {
      const result = await data.importBackup(await readText(file));
      report(
        result.ok
          ? { status: 'settings.data.imported' }
          : { problem: `backup.import.${result.reason}` },
      );
    } catch {
      report({ problem: 'backup.import.writeFailed' });
    }
  };

  const deleteEverything = async () => {
    setConfirmingDelete(false);
    try {
      await data.deleteEverything();
      onDeleted();
    } catch {
      report({ problem: 'settings.data.deleteAll.failed' });
      refocusDelete.current = true;
    }
  };

  if (!settings) {
    return (
      <main className="mx-auto max-w-xl">
        {problem && <p role="alert">{t(problem)}</p>}
      </main>
    );
  }

  const tone = settings.tone ?? 'playful';
  const breakEnd = settings.breakEndDefault ?? 'waitForHost';

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-4xl text-accent">{t('settings.title')}</h1>
        <Link to="/" className={`${buttonSecondary} inline-flex items-center`}>
          {t('settings.home')}
        </Link>
      </div>

      <p aria-live="polite" className="empty:hidden">
        {status && t(status)}
      </p>
      {problem && <p role="alert">{t(problem)}</p>}

      <Section id={ids.tone} title={t('settings.tone.heading')}>
        <fieldset className="flex flex-col gap-1">
          <legend className="sr-only">{t('settings.tone.heading')}</legend>
          {TONES.map((value) => (
            <div key={value}>
              <label className={row}>
                <input
                  type="radio"
                  className={radio}
                  name={ids.tone}
                  checked={tone === value}
                  aria-describedby={`${ids.tone}-${value}`}
                  onChange={() => {
                    onToneChange(value);
                    void update({ tone: value });
                  }}
                />
                {t(`settings.tone.${value}`)}
              </label>
              <p id={`${ids.tone}-${value}`} className={`${hint} pl-8`}>
                {t(`settings.tone.${value}.hint`)}
              </p>
            </div>
          ))}
        </fieldset>
      </Section>

      <AlertSettings
        prefs={settings.alerts ?? {}}
        muted={settings.alertsMuted ?? false}
        audio={audio}
        notifier={notifier}
        onPrefs={updateAlerts}
        onToggleMute={() => void update({ alertsMuted: !(settings.alertsMuted ?? false) })}
      />

      <Section id={ids.breakEnd} title={t('settings.defaults.heading')}>
        <fieldset className="flex flex-col gap-1">
          <legend className={label}>{t('setup.structure.breakEnd')}</legend>
          {BREAK_ENDS.map((value) => (
            <label key={value} className={row}>
              <input
                type="radio"
                className={radio}
                name={ids.breakEnd}
                checked={breakEnd === value}
                onChange={() => void update({ breakEndDefault: value })}
              />
              {t(`setup.structure.breakEnd.${value}`)}
            </label>
          ))}
        </fieldset>
        <p className={hint}>{t('settings.defaults.hint')}</p>
      </Section>

      <Section id={ids.data} title={t('settings.data.heading')}>
        <p>
          {settings.storagePersistence
            ? t(`storage.persistence.${settings.storagePersistence}`)
            : t('settings.data.persistence.unknown')}
        </p>
        {settings.storagePersistence !== 'granted' && settings.storagePersistence !== 'unsupported' && (
          <button
            type="button"
            className={`${buttonSecondary} self-start bg-surface`}
            onClick={() =>
              void requestPersistentStorage()
                .then((storagePersistence) => update({ storagePersistence }))
                .catch(() => report({ problem: 'settings.saveFailed' }))
            }
          >
            {t('settings.data.protect')}
          </button>
        )}
        <QuarantineNotice repos={repos} data={data} clock={clock} />
        <div className="flex flex-col gap-1">
          <button
            type="button"
            className={`${buttonSecondary} self-start bg-surface`}
            onClick={() => void exportAll()}
          >
            {t('settings.data.export')}
          </button>
          <p className={hint}>{t('settings.data.export.hint')}</p>
        </div>
        <div className="flex flex-col gap-1">
          <label className={label} htmlFor={`${ids.data}-import`}>
            {t('settings.data.import')}
          </label>
          <input
            id={`${ids.data}-import`}
            type="file"
            accept="application/json,.json"
            className="min-h-11 w-full max-w-full text-ink file:mr-3 file:min-h-11 file:rounded-xl file:border-0 file:bg-surface file:px-4 file:font-semibold file:text-ink"
            aria-describedby={`${ids.data}-import-hint`}
            onChange={(e) => {
              const input = e.currentTarget;
              void importFile(input.files?.[0]).finally(() => (input.value = ''));
            }}
          />
          <p id={`${ids.data}-import-hint`} className={hint}>
            {t('settings.data.import.hint')}
          </p>
        </div>
        {confirmingDelete ? (
          <ConfirmAction
            text={t('settings.data.deleteAll.confirm')}
            confirmLabel={t('settings.data.deleteAll.confirmButton')}
            cancelLabel={t('clock.confirm.cancel')}
            onConfirm={() => void deleteEverything()}
            onCancel={() => {
              refocusDelete.current = true;
              setConfirmingDelete(false);
            }}
          />
        ) : (
          <button
            type="button"
            ref={deleteButton}
            className={`${buttonQuiet} self-start`}
            onClick={() => setConfirmingDelete(true)}
          >
            {t('settings.data.deleteAll')}
          </button>
        )}
      </Section>

      <Section id={ids.about} title={t('settings.about.heading')}>
        <p>{t('settings.about.intro', { name: appName })}</p>
        <LimitationsList />
        <Link to="/limitations" className="self-start underline">
          {t('settings.about.more')}
        </Link>
      </Section>
    </main>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className={`${card} flex flex-col gap-4`}>
      <h2 id={id} className="font-display text-2xl">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** `Blob.text()` is missing in some engines (and jsdom); FileReader works everywhere. */
function readText(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsText(file);
  });
}

import { useEffect, useState } from 'react';
import type { Repositories } from '@/core/persistence/repositories';
import type { Clock } from '@/core/time';
import type { DataTools } from '@/infrastructure/backup/data-tools';
import { appStatus, useAppStatus, type AppStatusStore } from '@/infrastructure/pwa/app-status';
import { Icon } from '@/shared/components/Icon';
import { buttonQuiet, buttonSecondary, card, hint } from '@/shared/components/styles';
import { useT } from '@/shared/messages/tone';
import { datedFilename, downloadText } from '@/shared/utilities/download';

// Storage honesty notices (spec 02 §7.4, §7.6): the one-time durability notice on Home and the
// non-blocking quarantine notice (Home and Settings). Neither ever blocks the app.

interface NoticeProps {
  repos: Repositories<unknown>;
  data: DataTools;
  clock: Clock;
}

export function DurabilityNotice({
  repos,
  data,
  clock,
  status = appStatus,
}: NoticeProps & { status?: AppStatusStore }) {
  const t = useT();
  const { canInstall } = useAppStatus(status);
  const [show, setShow] = useState(false);
  const [exportFailed, setExportFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    repos.settings.get().then(
      (s) => !cancelled && setShow(s.durabilityNoticeDismissedAt === undefined),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [repos]);

  if (!show) return null;

  const dismiss = () => {
    setShow(false);
    void repos.settings.update({ durabilityNoticeDismissedAt: clock.now() }).catch(() => undefined);
  };

  const exportAll = async () => {
    try {
      downloadText(datedFilename('tournament-backup', clock.now()), await data.exportAll());
      setExportFailed(false);
    } catch {
      setExportFailed(true);
    }
  };

  return (
    <section
      aria-label={t('settings.data.heading')}
      className="flex flex-col gap-3 rounded-3xl border border-state-break/25 bg-state-break/[0.06] p-4 text-left text-sm sm:p-5"
    >
      <p className="flex gap-3">
        <span aria-hidden="true" className="mt-0.5 text-state-break">
          <Icon name="stack" />
        </span>
        <span>{t('storage.durability.notice')}</span>
      </p>
      {!canInstall && <p className={hint}>{t('storage.durability.installHint')}</p>}
      {exportFailed && <p role="alert">{t('settings.data.exportFailed')}</p>}
      <div className="flex flex-wrap gap-2">
        {canInstall && (
          <button type="button" className={buttonSecondary} onClick={() => void status.install()}>
            {t('storage.durability.install')}
          </button>
        )}
        <button type="button" className={buttonSecondary} onClick={() => void exportAll()}>
          {t('storage.durability.exportBackup')}
        </button>
        <button type="button" className={buttonQuiet} onClick={dismiss}>
          <Icon name="check" className="size-4" />
          {t('storage.durability.dismiss')}
        </button>
      </div>
    </section>
  );
}

export function QuarantineNotice({ repos, data, clock }: NoticeProps) {
  const t = useT();
  const [count, setCount] = useState(0);
  const [deleted, setDeleted] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    repos.quarantine.list().then(
      (entries) => !cancelled && setCount(entries.length),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [repos]);

  const run = async (action: () => Promise<void>) => {
    try {
      await action();
      setFailed(false);
    } catch {
      setFailed(true);
    }
  };

  if (count === 0) {
    return deleted ? <p role="status">{t('storage.quarantine.deleted')}</p> : null;
  }

  return (
    <div role="status" className={`${card} flex flex-col gap-3 border-state-warning/40 text-left`}>
      <p>{t('storage.quarantine.notice')}</p>
      {failed && <p role="alert">{t('settings.saveFailed')}</p>}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={buttonSecondary}
          onClick={() =>
            void run(async () =>
              downloadText(datedFilename('set-aside-data', clock.now()), await data.exportQuarantine()),
            )
          }
        >
          {t('storage.quarantine.export')}
        </button>
        <button
          type="button"
          className={buttonSecondary}
          onClick={() =>
            void run(async () => {
              await repos.quarantine.clear();
              setCount(0);
              setDeleted(true);
            })
          }
        >
          {t('storage.quarantine.delete')}
        </button>
      </div>
    </div>
  );
}

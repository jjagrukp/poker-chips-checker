import { appStatus, useAppStatus } from '@/infrastructure/pwa/app-status';
import { buttonPrimary, buttonSecondary, card } from '@/shared/components/styles';
import { useT } from '@/shared/messages/tone';

// App-wide banners: a waiting new version (D31) and a database taken over by a newer tab.

export function AppNotices() {
  const t = useT();
  const { updateReady, storageReplaced } = useAppStatus();
  const reload = () => window.location.reload();
  if (!updateReady && !storageReplaced) return null;
  return (
    <aside aria-label={t('app.notices')} className="mx-auto mb-4 flex max-w-xl flex-col gap-3">
      {storageReplaced && (
        <div role="alert" className={`${card} flex flex-wrap items-center justify-between gap-3`}>
          <p>{t('app.storageReplaced')}</p>
          <button type="button" className={buttonPrimary} onClick={reload}>
            {t('app.update.reload')}
          </button>
        </div>
      )}
      {updateReady && !storageReplaced && (
        <div role="status" className={`${card} flex flex-wrap items-center justify-between gap-3`}>
          <p>{t('app.update.ready')}</p>
          <span className="flex gap-2">
            <button type="button" className={buttonPrimary} onClick={() => appStatus.applyUpdate()}>
              {t('app.update.reload')}
            </button>
            <button
              type="button"
              className={buttonSecondary}
              onClick={() => appStatus.set({ updateReady: false })}
            >
              {t('app.update.later')}
            </button>
          </span>
        </div>
      )}
    </aside>
  );
}

import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import type { Schedule } from '@/core/scheduling/schedule';
import type { Tournament } from '@/core/tournaments/tournament';
import { buttonPrimary, buttonQuiet, buttonSecondary, card } from '@/shared/components/styles';
import { useT } from '@/shared/messages/tone';
import type { ScreenShareService } from '../service';
import { formatCode } from '../wire';

// "Show on a TV" (spec 08 §1): starts a share, shows the code and link, and reports whether the
// relay has the latest clock. The panel can close; sharing carries on until stopped.

interface Props {
  service: ScreenShareService;
  tournament: Tournament;
  schedule: Schedule;
}

export function SharePanel({ service, tournament, schedule }: Props) {
  const t = useT();
  const id = useId();
  // Strings, so the snapshot is stable between renders.
  const code = useSyncExternalStore(service.subscribe, () => service.current(tournament.id)?.code);
  const status = useSyncExternalStore(service.subscribe, () => service.status(tournament.id));
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const latest = useRef({ tournament, schedule });
  latest.current = { tournament, schedule };

  // After a reload the relay may hold an older state than this phone: send ours once.
  const shared = code !== undefined;
  useEffect(() => {
    if (shared) service.push(latest.current.tournament, latest.current.schedule);
  }, [service, shared]);

  if (!code) {
    return (
      <div className="flex justify-center">
        <button
          type="button"
          className={buttonSecondary}
          onClick={() => {
            service.start(tournament, schedule);
            setOpen(true);
          }}
        >
          {t('share.open')}
        </button>
      </div>
    );
  }

  const link = `${window.location.origin}/screen/${code}`;
  const statusText = status ? t(`share.status.${status}`) : '';

  if (!open) {
    return (
      <div className="flex flex-wrap items-center justify-center gap-3 text-sm">
        <span role="status">{statusText}</span>
        <button type="button" className={buttonSecondary} onClick={() => setOpen(true)}>
          {t('share.open')}
        </button>
      </div>
    );
  }

  return (
    <section aria-labelledby={id} className={`${card} mx-auto flex w-full max-w-xl flex-col gap-3`}>
      <h2 id={id} className="font-display text-2xl">
        {t('share.title')}
      </h2>
      <p>{t('share.intro', { address: `${window.location.host}/screen` })}</p>
      <p className="flex flex-col items-center gap-1">
        <span className="text-sm text-ink-muted">{t('share.code')}</span>
        <span className="font-display text-5xl tracking-widest tabular-nums">{formatCode(code)}</span>
      </p>
      <p className="flex flex-col gap-1">
        <span className="text-sm text-ink-muted">{t('share.link')}</span>
        <a href={link} target="_blank" rel="noreferrer" className="break-all underline">
          {link}
        </a>
      </p>
      <p role="status" className="text-sm">
        {copied ? t('share.copied') : statusText}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={buttonPrimary}
          onClick={() => {
            void navigator.clipboard?.writeText(link).then(
              () => setCopied(true),
              () => setCopied(false),
            );
          }}
        >
          {t('share.copy')}
        </button>
        {typeof navigator.share === 'function' && (
          <button
            type="button"
            className={buttonSecondary}
            onClick={() => void navigator.share({ url: link }).catch(() => undefined)}
          >
            {t('share.share')}
          </button>
        )}
        <button type="button" className={buttonSecondary} onClick={() => setOpen(false)}>
          {t('share.close')}
        </button>
        <button
          type="button"
          className={buttonQuiet}
          onClick={() => {
            setOpen(false);
            void service.stop(tournament.id);
          }}
        >
          {t('share.stop')}
        </button>
      </div>
      <p className="text-sm text-ink-muted">{t('share.privacy')}</p>
    </section>
  );
}

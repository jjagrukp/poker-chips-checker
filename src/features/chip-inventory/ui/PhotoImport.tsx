import { useEffect, useId, useRef, useState } from 'react';
import type { ChipProposal, PhotoAnalysis } from '@/features/chip-inventory/photo/schema';
import type { AnalyseFailure, PhotoService } from '@/features/chip-inventory/photo/service';
import { buttonPrimary, buttonSecondary, card, hint } from '@/shared/components/styles';
import type { MessageKey } from '@/shared/messages';
import { useT } from '@/shared/messages/tone';

// Photo route (spec 06 §1): explain, pick, prepare on device, analyse, then hand proposals to
// the normal review as unconfirmed rows. Hidden unless the config endpoint says it's on;
// every failure offers "Enter manually".

type Failure = AnalyseFailure | 'decode_failed' | 'not_chips';

type Phase =
  | { kind: 'idle' }
  | { kind: 'busy'; step: 'preparing' | 'analysing' }
  | { kind: 'done'; analysis: PhotoAnalysis }
  | { kind: 'failed'; reason: Failure };

interface Props {
  service: PhotoService;
  onProposals: (proposals: ChipProposal[]) => void;
  onManual: () => void;
}

const FAILURE_KEYS: Partial<Record<Failure, MessageKey>> = {
  not_chips: 'photo.notChips',
  unsupported_type: 'photo.error.unsupported_type',
  too_large: 'photo.error.too_large',
  decode_failed: 'photo.error.decode_failed',
  bad_image: 'photo.error.bad_image',
  rate_limited: 'photo.error.rate_limited',
  daily_cap: 'photo.error.daily_cap',
  timeout: 'photo.error.timeout',
  network: 'photo.error.network',
};

export function PhotoImport({ service, onProposals, onManual }: Props) {
  const t = useT();
  const id = useId();
  const [enabled, setEnabled] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const run = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    service.config().then(
      (config) => !cancelled && setEnabled(config.aiPhotoEnabled),
      () => undefined,
    );
    return () => {
      cancelled = true;
      run.current?.abort();
    };
  }, [service]);

  const busy = phase.kind === 'busy';
  const cancelButton = useRef<HTMLButtonElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const wasBusy = useRef(false);

  // The control that had focus unmounts when the picker swaps with the busy state: move focus
  // to its replacement so keyboard and screen-reader users aren't dropped on <body>.
  useEffect(() => {
    if (busy) cancelButton.current?.focus();
    else if (wasBusy.current) fileInput.current?.focus();
    wasBusy.current = busy;
  }, [busy]);

  if (!enabled) return null;

  const analyse = async (file: File) => {
    run.current?.abort();
    const controller = new AbortController();
    run.current = controller;
    setPhase({ kind: 'busy', step: 'preparing' });
    const prepared = await service.prepare(file);
    if (controller.signal.aborted) return;
    if (!prepared.ok) return setPhase({ kind: 'failed', reason: prepared.reason });

    setPhase({ kind: 'busy', step: 'analysing' });
    try {
      const result = await service.analyse(prepared.bytes, controller.signal);
      if (controller.signal.aborted) return;
      if (!result.ok) return setPhase({ kind: 'failed', reason: result.reason });
      if (result.analysis.status === 'not_chips')
        return setPhase({ kind: 'failed', reason: 'not_chips' });
      if (result.analysis.chipTypes.length > 0) onProposals(result.analysis.chipTypes);
      setPhase({ kind: 'done', analysis: result.analysis });
    } catch {
      // Only a cancel rejects; the cancel handler already reset the phase.
    }
  };

  const cancel = () => {
    run.current?.abort();
    setPhase({ kind: 'idle' });
  };

  const manual = () => {
    setPhase({ kind: 'idle' });
    onManual();
  };


  return (
    <section className={`${card} flex flex-col gap-3`} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="font-semibold">
        {t('photo.title')}
      </h2>
      <p className="font-semibold">{t('photo.scope')}</p>
      <p>{t('photo.privacy')}</p>
      <details className={hint}>
        <summary className="min-h-11 cursor-pointer py-2 font-semibold">
          {t('photo.privacyMore')}
        </summary>
        <p>{t('photo.privacyDetail')}</p>
      </details>
      <p className={hint}>{t('photo.tips')}</p>

      {busy ? (
        <div className="flex flex-wrap items-center gap-3">
          {/* Decorative: the status text below says what's happening. */}
          <span
            data-testid="photo-spinner"
            aria-hidden="true"
            className="size-6 shrink-0 animate-spin rounded-full border-4 border-ink-muted/30 border-t-accent"
          />
          <p role="status">
            {t(phase.step === 'preparing' ? 'photo.preparing' : 'photo.analysing')}
          </p>
          <button type="button" ref={cancelButton} className={buttonSecondary} onClick={cancel}>
            {t('photo.cancel')}
          </button>
        </div>
      ) : (
        <div className="w-fit rounded-xl has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent">
          {/* A styled label opens the picker; the input stays keyboard-focusable. */}
          <label
            htmlFor={`${id}-file`}
            className={`${buttonPrimary} inline-flex cursor-pointer items-center`}
          >
            {t(phase.kind === 'idle' ? 'photo.pick' : 'photo.retake')}
          </label>
          <input
            ref={fileInput}
            id={`${id}-file`}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void analyse(file);
            }}
          />
        </div>
      )}

      {phase.kind === 'done' && <Outcome analysis={phase.analysis} />}
      {phase.kind === 'failed' && (
        <p role="alert">{t(FAILURE_KEYS[phase.reason] ?? 'photo.error.generic')}</p>
      )}
      {(phase.kind === 'failed' || phase.kind === 'done') && (
        <button type="button" className={`${buttonSecondary} self-start`} onClick={manual}>
          {t('photo.manual')}
        </button>
      )}
    </section>
  );
}

function Outcome({ analysis }: { analysis: PhotoAnalysis }) {
  const t = useT();
  const count = analysis.chipTypes.length;
  const showTips = analysis.status === 'unclear' || analysis.imageIssues.length > 0;
  return (
    <div role="status" className="flex flex-col gap-1">
      <p className="font-semibold">
        {count > 0 ? t('photo.found', { count }) : t('photo.foundNone')}
      </p>
      {analysis.status === 'unclear' && count > 0 && <p>{t('photo.unclear')}</p>}
      {showTips && analysis.imageIssues.length > 0 && (
        <>
          <p>{t('photo.issuesIntro')}</p>
          <ul className="list-disc pl-6">
            {analysis.imageIssues.map((issue) => (
              <li key={issue}>{t(`photo.issue.${issue}`)}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useStore, type StoreApi } from 'zustand';
import type { ModuleContext } from '@/core/modules/contract';
import type { Repositories } from '@/core/persistence/repositories';
import type { Inventory } from '@/features/chip-inventory/domain/inventory';
import { buttonPrimary, buttonSecondary } from '@/shared/components/styles';
import { useT } from '@/shared/messages/tone';
import { createWizardStore, type WizardStore } from '../state/store';
import { fromTournament, reachStep, stepComplete, STEPS, type StepId } from '../state/wizard';
import { WizardContext, type WizardEnv } from './context';
import { setupPath, STEP_LABELS, tournamentPath } from './paths';
import { BasicsStep } from './steps/BasicsStep';
import { ChipsStep } from './steps/ChipsStep';
import { DurationStep } from './steps/DurationStep';
import { ReviewStep } from './steps/ReviewStep';
import { StackStep } from './steps/StackStep';
import { StructureStep } from './steps/StructureStep';

const STEP_COMPONENTS: Record<StepId, () => JSX.Element> = {
  basics: BasicsStep,
  duration: DurationStep,
  chips: ChipsStep,
  stack: StackStep,
  structure: StructureStep,
  review: ReviewStep,
};

interface Props {
  tournamentId: string;
  step: string | undefined;
  repos: Repositories<Inventory>;
  ctx: ModuleContext;
}

type Loaded =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'unreadable' }
  | { kind: 'notDraft' }
  | { kind: 'ok'; store: StoreApi<WizardStore> };

export function SetupWizard({ tournamentId, step, repos, ctx }: Props) {
  const t = useT();
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setLoaded({ kind: 'loading' });
    repos.tournaments.get(tournamentId).then(
      (tournament) => {
        if (cancelled) return;
        if (!tournament) return setLoaded({ kind: 'missing' });
        const result = fromTournament(tournament);
        if (result.kind === 'ok') {
          setLoaded({ kind: 'ok', store: createWizardStore(result.state, { repos, ctx }) });
        } else setLoaded({ kind: result.kind });
      },
      () => !cancelled && setLoaded({ kind: 'unreadable' }),
    );
    return () => {
      cancelled = true;
    };
  }, [tournamentId, repos, ctx]);

  switch (loaded.kind) {
    case 'loading':
      return <p className="text-center text-ink-muted">{t('setup.loading')}</p>;
    case 'notDraft':
      return <Navigate to={tournamentPath(tournamentId)} replace />;
    case 'missing':
    case 'unreadable':
      return (
        <main className="mx-auto flex max-w-xl flex-col gap-4">
          <p role="alert">{t(loaded.kind === 'missing' ? 'setup.notFound' : 'setup.unreadable')}</p>
          <Link to="/" className={buttonSecondary + ' text-center'}>
            {t('setup.home')}
          </Link>
        </main>
      );
    case 'ok':
      return <Wizard env={{ store: loaded.store, repos, ctx }} step={step} />;
  }
}

function Wizard({ env, step }: { env: WizardEnv; step: string | undefined }) {
  const t = useT();
  const navigate = useNavigate();
  const wizard = useStore(env.store, (s) => s.wizard);
  const saveStatus = useStore(env.store, (s) => s.saveStatus);
  const id = wizard.tournament.id;
  const index = STEPS.indexOf(step as StepId);
  const heading = useRef<HTMLHeadingElement>(null);

  const complete = useMemo(
    () => STEPS.map((s) => stepComplete(wizard, s, env.ctx)),
    [wizard, env.ctx],
  );

  useEffect(() => {
    heading.current?.focus();
  }, [index]);

  if (index === -1 || index > wizard.draft.furthestStep) {
    return <Navigate to={setupPath(id, STEPS[wizard.draft.furthestStep] ?? 'basics')} replace />;
  }
  const current = STEPS[index] as StepId;
  const Step = STEP_COMPONENTS[current];
  const isLast = index === STEPS.length - 1;

  const go = (to: number) => {
    const target = STEPS[to];
    if (!target) return;
    env.store.getState().update((s) => reachStep(s, to));
    navigate(setupPath(id, target));
  };

  return (
    <WizardContext.Provider value={env}>
      <main className="mx-auto flex max-w-3xl flex-col gap-6">
        <header className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm text-ink-muted">
              {t('setup.stepOf', { n: index + 1, total: STEPS.length })}
            </p>
            {saveStatus === 'error' ? (
              <p role="alert" className="text-sm text-accent">
                {t('setup.saveFailed')}
              </p>
            ) : (
              <p className="text-sm text-ink-muted">
                {saveStatus === 'saving' ? t('setup.saving') : t('setup.saved')}
              </p>
            )}
          </div>
          <nav aria-label={t('setup.progress')}>
            <ol className="flex flex-wrap gap-2">
              {STEPS.map((s, i) => {
                const reachable = i <= wizard.draft.furthestStep;
                const label = t(STEP_LABELS[s]);
                return (
                  <li key={s}>
                    {reachable ? (
                      <Link
                        to={setupPath(id, s)}
                        aria-current={i === index ? 'step' : undefined}
                        className={`inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold ${
                          i === index ? 'bg-accent text-accent-ink' : 'bg-surface-raised text-ink'
                        }`}
                      >
                        {i + 1}. {label}
                      </Link>
                    ) : (
                      <span className="inline-flex min-h-11 items-center rounded-full px-3 text-sm text-ink-muted">
                        {i + 1}. {label}
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          </nav>
          <h1 ref={heading} tabIndex={-1} className="font-display text-3xl text-accent">
            {t(STEP_LABELS[current])}
          </h1>
        </header>

        <Step />

        <footer className="flex justify-between gap-3">
          {index > 0 ? (
            <button type="button" className={buttonSecondary} onClick={() => go(index - 1)}>
              {t('setup.back')}
            </button>
          ) : (
            <Link to="/" className={buttonSecondary + ' inline-flex items-center'}>
              {t('setup.home')}
            </Link>
          )}
          {!isLast && (
            <button
              type="button"
              className={buttonPrimary}
              disabled={!complete[index]}
              onClick={() => go(index + 1)}
            >
              {t('setup.next')}
            </button>
          )}
        </footer>
      </main>
    </WizardContext.Provider>
  );
}

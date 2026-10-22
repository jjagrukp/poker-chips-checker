import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChipBreakdown, Swatch } from '@/features/chip-inventory/ui/ChipBreakdown';
import { formatChips, formatDurationMin } from '@/modules/texas-holdem/format';
import { summarise } from '@/modules/texas-holdem/generate';
import { IssueList } from '@/shared/components/IssueList';
import { buttonPrimary, card, hint } from '@/shared/components/styles';
import { useT } from '@/shared/messages/tone';
import { markReady, review, stepComplete, STEPS, type StepId } from '../../state/wizard';
import { useWizard, useWizardEnv } from '../context';
import { ScheduleTable } from '../ScheduleTable';
import { setupPath, STEP_LABELS, tournamentPath } from '../paths';

// Step 6 (spec 01 §5): everything the host needs to check, then Start (draft → ready).

export function ReviewStep() {
  const t = useT();
  const navigate = useNavigate();
  const { ctx, repos, store } = useWizardEnv();
  const state = useWizard((s) => s);
  const [failed, setFailed] = useState(false);
  const [starting, setStarting] = useState(false);
  const { config, draft, tournament } = state;
  const r = review(state, ctx);
  const errors = [...r.allocation.errors, ...r.config.errors, ...r.scheduleReport.errors];
  const warnings = [...r.allocationWarnings, ...r.config.warnings, ...r.scheduleReport.warnings];
  const incomplete = STEPS.filter((s): s is Exclude<StepId, 'review'> => s !== 'review').filter(
    (s) => !stepComplete(state, s, ctx),
  );
  const canStart = errors.length === 0 && incomplete.length === 0;
  const summary = r.schedule ? summarise(r.schedule.segments) : null;

  const start = async () => {
    setStarting(true);
    try {
      await store.getState().flush();
      const change = markReady(store.getState().wizard, ctx);
      const result = await repos.tournaments.commit(change);
      if (!result.ok) throw new Error('commit conflict');
      navigate(tournamentPath(tournament.id));
    } catch {
      setFailed(true);
      setStarting(false);
    }
  };

  const confirmed = draft.confirmed;
  const allocation = draft.allocation;

  return (
    <section className="flex flex-col gap-6">
      <dl className={`${card} grid grid-cols-[auto_1fr] gap-x-4 gap-y-2`}>
        {tournament.name && (
          <>
            <dt className="font-semibold">{t('setup.review.name')}</dt>
            <dd>{tournament.name}</dd>
          </>
        )}
        <dt className="font-semibold">{t('setup.review.players')}</dt>
        <dd>{config.players}</dd>
        <dt className="font-semibold">{t('setup.review.stack')}</dt>
        <dd>
          {formatChips(config.startingStack)}{' '}
          <span className="text-ink-muted">
            ({t('setup.stack.depth', { bb: Math.round(config.startingStack / config.startingBlinds.bb) })})
          </span>
        </dd>
        <dt className="font-semibold">{t('setup.review.duration')}</dt>
        <dd>
          {summary?.toFinishMin !== undefined
            ? t('holdem.summary.scheduled', {
                scheduled: formatDurationMin(summary.toFinishMin),
                target: formatDurationMin(config.targetDurationMin),
              })
            : t('setup.review.targetOnly', { target: formatDurationMin(config.targetDurationMin) })}
        </dd>
      </dl>

      {incomplete.length > 0 && (
        <div role="alert" className="flex flex-col gap-2">
          <p className="font-semibold">{t('setup.review.incomplete')}</p>
          <ul className="flex flex-wrap gap-2">
            {incomplete.map((s) => (
              <li key={s}>
                <Link to={setupPath(tournament.id, s)} className="underline">
                  {t(STEP_LABELS[s])}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      <IssueList issues={errors} kind="error" title={t('setup.review.errors')} />
      <IssueList issues={warnings} kind="warning" title={t('setup.review.warnings')} />

      {confirmed && allocation && (
        <div className={`${card} flex flex-col gap-3`}>
          <h2 className="text-xl font-semibold">{t('setup.stack.perPlayer')}</h2>
          <ChipBreakdown
            inventory={confirmed.inventory}
            assignment={confirmed.assignment}
            perPlayer={allocation.perPlayer}
          />
          <p className={hint}>{t('setup.stack.chipsEach', { count: allocation.chipsPerPlayer })}</p>

          <h2 className="text-xl font-semibold">{t('setup.review.inventory')}</h2>
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th scope="col" className="py-1 pr-2">{t('setup.review.col.chip')}</th>
                <th scope="col" className="py-1 pr-2">{t('setup.review.col.used')}</th>
                <th scope="col" className="py-1">{t('setup.review.col.left')}</th>
              </tr>
            </thead>
            <tbody>
              {confirmed.inventory.chipTypes.map((chip) => {
                const used = allocation.consumed[chip.id] ?? 0;
                return (
                  <tr key={chip.id}>
                    <th scope="row" className="py-1 pr-2 font-normal">
                      <span className="flex items-center gap-2">
                        <Swatch colour={chip.swatch} />
                        {chip.colour || t('chips.breakdown.unnamed')}
                      </span>
                    </th>
                    <td className="py-1 pr-2">
                      {used > 0 ? formatChips(used) : t('setup.review.notUsed')}
                    </td>
                    <td className="py-1">{formatChips(chip.quantity - used)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {r.schedule && (
        <div className="flex flex-col gap-2">
          <h2 className="text-xl font-semibold">{t('schedule.heading')}</h2>
          <ScheduleTable schedule={r.schedule} />
        </div>
      )}

      {failed && <p role="alert">{t('setup.review.startFailed')}</p>}
      <div className="flex flex-col gap-1">
        <button
          type="button"
          className={buttonPrimary}
          disabled={!canStart || starting}
          onClick={() => void start()}
        >
          {t('setup.review.start')}
        </button>
        <p className={hint}>{t('setup.review.startHint')}</p>
      </div>
    </section>
  );
}

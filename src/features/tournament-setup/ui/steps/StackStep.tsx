import { useEffect, useState } from 'react';
import type { Issue } from '@/core/validation/report';
import {
  allocate,
  type AllocationOutcome,
  type AllocationResult,
} from '@/features/chip-inventory/domain/allocate';
import { recommendStack } from '@/features/chip-inventory/domain/recommend';
import { validateAllocation } from '@/features/chip-inventory/domain/validate-allocation';
import { ChipBreakdown } from '@/features/chip-inventory/ui/ChipBreakdown';
import { formatChips } from '@/modules/texas-holdem/format';
import { IssueList } from '@/shared/components/IssueList';
import { NumberField } from '@/shared/components/NumberField';
import { buttonPrimary, buttonSecondary, card, hint } from '@/shared/components/styles';
import { useT } from '@/shared/messages/tone';
import {
  acceptAllocation,
  allocationReport,
  setStackMode,
  targetDepthBB,
  type WizardState,
} from '../../state/wizard';
import { useUpdate, useWizard } from '../context';

// Step 4 (spec 01 §5, 05 §4): recommended by default, or a custom stack checked against the
// chips. Only splits that pass the independent validator are accepted.

const MAX_STACK = 10_000_000;
const MAX_NEAREST = 3;

type Feedback =
  | { kind: 'none' }
  | { kind: 'working' }
  | { kind: 'explained'; explanation: Issue; truncated: boolean }
  | { kind: 'blocked'; reason: Issue[]; nearest: number[]; truncated: boolean };

/** Accepts the result only if the validator agrees; otherwise returns the rejection. */
function check(state: WizardState, result: AllocationResult, stack: number): Issue[] {
  const confirmed = state.draft.confirmed;
  if (!confirmed) return [];
  return validateAllocation(result, confirmed.inventory, state.config.players, confirmed.assignment, {
    targetStack: stack,
    startingDepthBB: targetDepthBB(state.config),
  }).errors;
}

export function StackStep() {
  const t = useT();
  const update = useUpdate();
  const state = useWizard((s) => s);
  const { config, draft } = state;
  const [feedback, setFeedback] = useState<Feedback>({ kind: 'none' });
  const [customStack, setCustomStack] = useState<number | undefined>(
    draft.stackMode === 'custom' && draft.allocation ? config.startingStack : undefined,
  );

  const runCustom = (stack: number) => {
    const confirmed = state.draft.confirmed;
    if (!confirmed) return;
    const outcome: AllocationOutcome = allocate({
      ...confirmed,
      players: config.players,
      targetStack: stack,
      startingDepthBB: targetDepthBB(config),
    });
    if (outcome.kind === 'invalid') {
      setFeedback({ kind: 'blocked', reason: outcome.errors, nearest: [], truncated: false });
    } else if (outcome.kind === 'impossible') {
      setFeedback({
        kind: 'blocked',
        reason: [outcome.reason],
        nearest: outcome.nearest.slice(0, MAX_NEAREST),
        truncated: outcome.truncated,
      });
    } else {
      const rejected = check(state, outcome.result, stack);
      if (rejected.length > 0) {
        setFeedback({ kind: 'blocked', reason: rejected, nearest: [], truncated: false });
        return;
      }
      setFeedback({ kind: 'none' });
      update((s) => acceptAllocation(s, outcome.result));
    }
  };

  // Recommended mode: search once whenever the split was invalidated.
  const needsRecommendation =
    draft.stackMode === 'recommended' && draft.confirmed !== null && draft.allocation === null;
  useEffect(() => {
    if (!needsRecommendation) return;
    setFeedback({ kind: 'working' });
    // Let "working" paint before the (synchronous) search.
    const timer = setTimeout(() => {
      const confirmed = state.draft.confirmed;
      if (!confirmed) return;
      const depth = targetDepthBB(state.config);
      const outcome = recommendStack({
        ...confirmed,
        players: state.config.players,
        startingDepthBB: depth,
      });
      if (outcome.kind === 'ok') {
        const rejected = check(state, outcome.result, outcome.stack);
        if (rejected.length > 0) {
          setFeedback({ kind: 'blocked', reason: rejected, nearest: [], truncated: false });
          return;
        }
        setFeedback({
          kind: 'explained',
          explanation: outcome.explanation,
          truncated: outcome.truncated,
        });
        update((s) => acceptAllocation(s, outcome.result));
      } else {
        setFeedback({
          kind: 'blocked',
          reason: outcome.kind === 'invalid' ? outcome.errors : [outcome.reason],
          nearest: [],
          truncated: false,
        });
      }
    }, 0);
    return () => clearTimeout(timer);
    // Only re-run when a new recommendation is needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsRecommendation]);

  if (!draft.confirmed) return <p className={card}>{t('setup.stack.needsChips')}</p>;

  const report = allocationReport(state);
  const depthBB = Math.round(config.startingStack / config.startingBlinds.bb);

  return (
    <section className="flex flex-col gap-5">
      <fieldset className="flex flex-wrap gap-2">
        <legend className="mb-2 font-semibold">{t('setup.stack.legend')}</legend>
        {(['recommended', 'custom'] as const).map((mode) => (
          <label
            key={mode}
            className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl px-4 py-2 ${
              draft.stackMode === mode ? 'bg-accent text-accent-ink' : 'bg-surface-raised'
            }`}
          >
            <input
              type="radio"
              name="stack-mode"
              checked={draft.stackMode === mode}
              onChange={() => {
                setFeedback({ kind: 'none' });
                update((s) => setStackMode(s, mode));
              }}
            />
            <span className="font-semibold">{t(mode === 'recommended' ? 'setup.stack.recommended' : 'setup.stack.custom')}</span>
          </label>
        ))}
      </fieldset>

      {draft.stackMode === 'custom' && (
        <div className="flex flex-col gap-2">
          <NumberField
            label={t('setup.stack.customLabel')}
            value={customStack}
            min={1}
            max={MAX_STACK}
            error={t('allocation.error.invalidStack')}
            onCommit={setCustomStack}
          />
          <button
            type="button"
            className={buttonPrimary + ' self-start'}
            disabled={customStack === undefined}
            onClick={() => customStack !== undefined && runCustom(customStack)}
          >
            {t('setup.stack.check')}
          </button>
        </div>
      )}

      <div aria-live="polite" className="flex flex-col gap-3">
        {feedback.kind === 'working' && <p>{t('setup.stack.working')}</p>}
        {feedback.kind === 'explained' && (
          <p className={hint}>
            {t('allocation.recommend.explanation', {
              stack: formatChips(Number(feedback.explanation.params?.stack)),
              chips: String(feedback.explanation.params?.chips),
              denominations: String(feedback.explanation.params?.denominations),
            })}
          </p>
        )}
        {(feedback.kind === 'explained' || feedback.kind === 'blocked') && feedback.truncated && (
          <p className={hint}>{t('allocation.warning.searchTruncated')}</p>
        )}
      </div>
      {feedback.kind === 'blocked' && (
        <div className="flex flex-col gap-2">
          <IssueList issues={feedback.reason} kind="error" />
          {feedback.nearest.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span>{t('setup.stack.nearest')}</span>
              {feedback.nearest.map((stack) => (
                <button
                  key={stack}
                  type="button"
                  className={buttonSecondary}
                  onClick={() => {
                    setCustomStack(stack);
                    runCustom(stack);
                  }}
                >
                  {t('setup.stack.useNearest', { stack: formatChips(stack) })}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {draft.allocation && (
        <div className={`${card} flex flex-col gap-3`}>
          <p className="text-2xl font-bold">
            {t('setup.stack.value', { stack: formatChips(draft.allocation.stackValue) })}
          </p>
          <p>{t('setup.stack.depth', { bb: depthBB })}</p>
          <p className={hint}>
            {t('setup.stack.chipsEach', { count: draft.allocation.chipsPerPlayer })}
          </p>
          <h2 className="font-semibold">{t('setup.stack.perPlayer')}</h2>
          <ChipBreakdown
            inventory={draft.confirmed.inventory}
            assignment={draft.confirmed.assignment}
            perPlayer={draft.allocation.perPlayer}
          />
          <IssueList issues={draft.allocation.issues} kind="warning" />
          {report && <IssueList issues={report.errors} kind="error" />}
        </div>
      )}
    </section>
  );
}

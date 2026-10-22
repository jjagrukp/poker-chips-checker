import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { ModuleContext } from '@/core/modules/contract';
import type { Preset } from '@/core/persistence/records';
import type { Repositories } from '@/core/persistence/repositories';
import type { Tournament } from '@/core/tournaments/tournament';
import type { Inventory } from '@/features/chip-inventory/domain/inventory';
import { createDraft } from '@/features/tournament-setup/state/create';
import { applyPreset, presetConfig } from '@/features/tournament-setup/state/reuse';
import { loadInventory, type WizardState } from '@/features/tournament-setup/state/wizard';
import { resumePath, setupPath, tournamentPath } from '@/features/tournament-setup/ui/paths';
import { buttonPrimary, buttonQuiet, buttonSecondary, card } from '@/shared/components/styles';
import { useT, type Translate } from '@/shared/messages/tone';

// Home's saved things (spec 01 §5): resume the running tournament, open or delete saved
// tournaments, start from a preset or a saved chip set, delete presets and chip sets.

interface Props {
  repos: Repositories<Inventory>;
  ctx: ModuleContext;
  /** Home's "New tournament" button, shown after any tournament to resume. */
  newTournament: ReactNode;
}

interface Saved {
  tournaments: Tournament[];
  presets: Preset[];
  inventories: Inventory[];
}

const newestFirst = <T extends { updatedAt: number }>(list: T[]) =>
  [...list].sort((a, b) => b.updatedAt - a.updatedAt);

export function Library({ repos, ctx, newTournament }: Props) {
  const t = useT();
  const navigate = useNavigate();
  const [saved, setSaved] = useState<Saved>({ tournaments: [], presets: [], inventories: [] });
  const [confirming, setConfirming] = useState<string | null>(null);
  const [problem, setProblem] = useState<
    'loadFailed' | 'createFailed' | 'deleteFailed' | 'presetUnusable'
  >();
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [tournaments, presets, inventories] = await Promise.all([
      repos.tournaments.list(),
      repos.presets.list(),
      repos.inventories.list(),
    ]);
    return {
      tournaments: newestFirst(tournaments),
      presets: newestFirst(presets),
      inventories: newestFirst(inventories),
    };
  }, [repos]);

  useEffect(() => {
    let cancelled = false;
    load().then(
      (next) => !cancelled && setSaved(next),
      () => !cancelled && setProblem('loadFailed'),
    );
    return () => {
      cancelled = true;
    };
  }, [load]);

  const remove = async (run: () => Promise<void>) => {
    setConfirming(null);
    try {
      await run();
      setSaved(await load());
      setProblem(undefined);
    } catch {
      setProblem('deleteFailed');
    }
  };

  const startFrom = async (seed: (s: WizardState) => WizardState) => {
    if (busy) return;
    setBusy(true);
    try {
      navigate(setupPath(await createDraft(repos, ctx, seed), 'basics'));
    } catch {
      setProblem('createFailed');
      setBusy(false);
    }
  };

  const startFromPreset = (preset: Preset) => {
    const config = presetConfig(preset);
    if (!config) setProblem('presetUnusable');
    else void startFrom((s) => applyPreset(s, config));
  };

  const active = saved.tournaments.filter((x) => x.status === 'active');
  const others = saved.tournaments.filter((x) => x.status !== 'active');
  const untitled = (x: Tournament) => x.name ?? t('home.untitled');

  const confirmRow = (key: string, name: string, onDelete: () => void) =>
    confirming === key ? (
      <ConfirmDelete
        text={t('home.delete.confirm', { name })}
        onConfirm={onDelete}
        onCancel={() => setConfirming(null)}
      />
    ) : null;

  const deleteButton = (key: string, name: string) => (
    <button
      type="button"
      className={buttonQuiet}
      aria-label={t('home.itemAction', { action: t('home.delete'), name })}
      onClick={() => setConfirming(key)}
    >
      {t('home.delete')}
    </button>
  );

  return (
    <div className="flex w-full flex-col gap-6 text-left">
      {problem && <p role="alert">{t(`home.problem.${problem}`)}</p>}

      {active.map((x) => (
        <Link
          key={x.id}
          to={tournamentPath(x.id)}
          className={`${buttonPrimary} flex flex-col items-center gap-1 py-4 text-center text-xl`}
        >
          <span>{t('home.resume', { name: untitled(x) })}</span>
        </Link>
      ))}

      {newTournament}

      {others.length > 0 && (
        <Section title={t('home.saved')}>
          {others.map((x) => {
            const action = linkAction(t, x);
            return (
              <Item
                key={x.id}
                name={untitled(x)}
                detail={t(`home.status.${x.status}`)}
                confirm={confirmRow(`t:${x.id}`, untitled(x), () =>
                  void remove(() => repos.tournaments.delete(x.id)),
                )}
              >
                <Link
                  to={x.status === 'draft' ? resumePath(x.id) : tournamentPath(x.id)}
                  className={buttonSecondary + ' inline-flex items-center bg-surface'}
                  aria-label={t('home.itemAction', { action, name: untitled(x) })}
                >
                  {action}
                </Link>
                {deleteButton(`t:${x.id}`, untitled(x))}
              </Item>
            );
          })}
        </Section>
      )}

      {saved.presets.length > 0 && (
        <Section title={t('home.presets')}>
          {saved.presets.map((p) => (
            <Item
              key={p.id}
              name={p.name}
              confirm={confirmRow(`p:${p.id}`, p.name, () => void remove(() => repos.presets.delete(p.id)))}
            >
              <button
                type="button"
                className={buttonSecondary + ' bg-surface'}
                disabled={busy}
                aria-label={t('home.itemAction', { action: t('home.usePreset'), name: p.name })}
                onClick={() => startFromPreset(p)}
              >
                {t('home.usePreset')}
              </button>
              {deleteButton(`p:${p.id}`, p.name)}
            </Item>
          ))}
        </Section>
      )}

      {saved.inventories.length > 0 && (
        <Section title={t('home.inventories')}>
          {saved.inventories.map((inv) => (
            <Item
              key={inv.id}
              name={inv.name}
              detail={t('home.inventoryTypes', { types: inv.chipTypes.length })}
              confirm={confirmRow(`i:${inv.id}`, inv.name, () =>
                void remove(() => repos.inventories.delete(inv.id)),
              )}
            >
              <button
                type="button"
                className={buttonSecondary + ' bg-surface'}
                disabled={busy}
                aria-label={t('home.itemAction', { action: t('home.useInventory'), name: inv.name })}
                onClick={() => void startFrom((s) => loadInventory(s, inv))}
              >
                {t('home.useInventory')}
              </button>
              {deleteButton(`i:${inv.id}`, inv.name)}
            </Item>
          ))}
        </Section>
      )}
    </div>
  );
}

function linkAction(t: Translate, x: Tournament): string {
  switch (x.status) {
    case 'draft':
      return t('home.continueSetup');
    case 'completed':
    case 'cancelled':
      return t('home.results');
    default:
      return t('home.open');
  }
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="flex flex-col gap-2" aria-labelledby={id}>
      <h2 id={id} className="text-xl font-semibold">
        {title}
      </h2>
      <ul className="flex flex-col gap-2">{children}</ul>
    </section>
  );
}

function Item({
  name,
  detail,
  confirm,
  children,
}: {
  name: string;
  detail?: string;
  confirm: ReactNode;
  children: ReactNode;
}) {
  return (
    <li className={`${card} flex flex-col gap-3`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span>
          <span className="block font-semibold">{name}</span>
          {detail && <span className="text-sm text-ink-muted">{detail}</span>}
        </span>
        <span className="flex flex-wrap items-center gap-2">{children}</span>
      </div>
      {confirm}
    </li>
  );
}

function ConfirmDelete({
  text,
  onConfirm,
  onCancel,
}: {
  text: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const id = useId();
  const cancel = useRef<HTMLButtonElement>(null);
  // Focus starts on Cancel so a stray Enter never deletes anything.
  useEffect(() => cancel.current?.focus(), []);
  return (
    <div role="alertdialog" aria-modal="false" aria-labelledby={id} className="flex flex-col gap-2">
      <p id={id}>{text}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonPrimary} onClick={onConfirm}>
          {t('home.delete')}
        </button>
        <button
          type="button"
          className={buttonSecondary + ' bg-surface'}
          ref={cancel}
          onClick={onCancel}
        >
          {t('clock.confirm.cancel')}
        </button>
      </div>
    </div>
  );
}

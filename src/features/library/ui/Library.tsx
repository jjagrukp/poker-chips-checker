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
import { ConfirmAction } from '@/shared/components/ConfirmAction';
import { Chip } from '@/shared/components/Chip';
import { Icon } from '@/shared/components/Icon';
import { buttonQuiet, buttonSecondary, card, eyebrow, pill } from '@/shared/components/styles';
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
  const root = useRef<HTMLDivElement>(null);

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
    // The row (and its buttons) is gone: keep focus inside the library, not on <body>.
    root.current?.focus();
  };

  const cancelDelete = (key: string) => {
    setConfirming(null);
    root.current?.querySelector<HTMLElement>(`[data-delete="${CSS.escape(key)}"]`)?.focus();
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
      <ConfirmAction
        text={t('home.delete.confirm', { name })}
        confirmLabel={t('home.delete')}
        cancelLabel={t('clock.confirm.cancel')}
        onConfirm={onDelete}
        onCancel={() => cancelDelete(key)}
      />
    ) : null;

  const deleteButton = (key: string, name: string) => (
    <button
      type="button"
      className={buttonQuiet}
      data-delete={key}
      aria-label={t('home.itemAction', { action: t('home.delete'), name })}
      onClick={() => setConfirming(key)}
    >
      {t('home.delete')}
    </button>
  );

  return (
    <div
      ref={root}
      tabIndex={-1}
      role="group"
      aria-label={t('home.saved')}
      className="flex w-full flex-col gap-6 text-left outline-none"
    >
      {problem && <p role="alert">{t(`home.problem.${problem}`)}</p>}

      {active.map((x) => (
        <Link
          key={x.id}
          to={tournamentPath(x.id)}
          className="group relative flex items-center justify-between gap-4 overflow-hidden rounded-3xl border border-state-level/30 bg-linear-to-br from-felt to-surface-raised p-5 shadow-[var(--shadow-card)] transition hover:border-state-level/60"
        >
          <span className="flex min-w-0 flex-col gap-1">
            <span aria-hidden="true" className={`${pill} w-fit text-state-level`}>
              <span className="size-2 rounded-full bg-state-level motion-safe:animate-pulse" />
              {t('home.live')}
            </span>
            <span className="font-display text-2xl leading-tight font-bold break-words">
              {t('home.resume', { name: untitled(x) })}
            </span>
          </span>
          <span
            aria-hidden="true"
            className="flex size-12 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink transition group-hover:scale-105"
          >
            <Icon name="play" className="size-6" />
          </span>
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
                tone={STATUS_TONE[x.status]}
                confirm={confirmRow(`t:${x.id}`, untitled(x), () =>
                  void remove(() => repos.tournaments.delete(x.id)),
                )}
              >
                <Link
                  to={x.status === 'draft' ? resumePath(x.id) : tournamentPath(x.id)}
                  className={buttonSecondary}
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
                className={buttonSecondary}
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
              lead={
                <span aria-hidden="true" className="flex -space-x-4">
                  {inv.chipTypes.slice(0, 6).map((chip) => (
                    <Chip key={chip.id} colour={chip.swatch} className="size-9" />
                  ))}
                </span>
              }
              confirm={confirmRow(`i:${inv.id}`, inv.name, () =>
                void remove(() => repos.inventories.delete(inv.id)),
              )}
            >
              <button
                type="button"
                className={buttonSecondary}
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

const STATUS_TONE: Record<Tournament['status'], string> = {
  draft: 'text-ink-muted',
  ready: 'text-accent',
  active: 'text-state-level',
  completed: 'text-state-completed',
  cancelled: 'text-ink-muted',
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="flex flex-col gap-3" aria-labelledby={id}>
      <h2 id={id} className={eyebrow}>
        {title}
      </h2>
      <ul className="flex flex-col gap-2">{children}</ul>
    </section>
  );
}

function Item({
  name,
  detail,
  tone,
  lead,
  confirm,
  children,
}: {
  name: string;
  detail?: string;
  /** Text colour for the status detail. */
  tone?: string;
  /** Visual before the name (a chip fan). */
  lead?: ReactNode;
  confirm: ReactNode;
  children: ReactNode;
}) {
  return (
    <li className={`${card} flex flex-col gap-3`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-4">
          {lead}
          <span className="min-w-0">
            <span className="block truncate font-display text-lg font-semibold">{name}</span>
            {detail && <span className={`text-sm font-semibold ${tone ?? 'text-ink-muted'}`}>{detail}</span>}
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-2">{children}</span>
      </div>
      {confirm}
    </li>
  );
}

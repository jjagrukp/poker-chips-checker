import { useEffect, useId, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { ModuleContext } from '@/core/modules/contract';
import type { Repositories } from '@/core/persistence/repositories';
import type { Tournament } from '@/core/tournaments/tournament';
import type { Inventory } from '@/features/chip-inventory/domain/inventory';
import { createDraft } from '@/features/tournament-setup/state/create';
import { duplicateOf, presetFromTournament } from '@/features/tournament-setup/state/reuse';
import { loadInventory } from '@/features/tournament-setup/state/wizard';
import { resumePath, setupPath } from '@/features/tournament-setup/ui/paths';
import { buttonPrimary, buttonSecondary, card, hint, input, label } from '@/shared/components/styles';
import { useT } from '@/shared/messages/tone';
import {
  actualDuration,
  applyResults,
  MAX_DURATION_MIN,
  ordinal,
  resultsForm,
  winnerName,
  type ResultsForm,
} from '../domain/results';

// Results (spec 02 §6, 01 §5): finishing positions, actual duration, then reuse actions:
// save as preset, duplicate, new tournament with the same chips.

interface Props {
  tournament: Tournament;
  repos: Repositories<Inventory>;
  ctx: ModuleContext;
}

type Notice = 'saved' | 'saveFailed' | 'presetSaved' | 'presetFailed' | 'createFailed' | 'noInventory';

export function ResultsScreen({ tournament: initial, repos, ctx }: Props) {
  const t = useT();
  const navigate = useNavigate();
  const ids = { duration: useId(), durationHint: useId(), preset: useId(), positions: useId() };
  const [tournament, setTournament] = useState(initial);
  const [form, setForm] = useState<ResultsForm>(() => resultsForm(initial, undefined));
  const [durationError, setDurationError] = useState(false);
  const [presetName, setPresetName] = useState(initial.name ?? '');
  const [notice, setNotice] = useState<Notice>();
  const [busy, setBusy] = useState(false);
  const completed = tournament.status === 'completed';
  const winner = winnerName(tournament);

  // The derived duration fills the field until the host has saved their own.
  useEffect(() => {
    if (initial.results?.actualDurationMs !== undefined) return;
    let cancelled = false;
    repos.events.listByTournament(initial.id).then(
      (events) => {
        const ms = actualDuration(initial, events);
        const durationMin = resultsForm(initial, ms).durationMin;
        if (!cancelled) setForm((f) => (f.durationMin === '' ? { ...f, durationMin } : f));
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [initial, repos]);

  const save = async () => {
    const result = applyResults(tournament, form, ctx.clock.now());
    setDurationError(!result.ok);
    if (!result.ok) return;
    const committed = await repos.tournaments.commit({ tournament: result.tournament }).catch(() => undefined);
    if (committed?.ok) setTournament(result.tournament);
    setNotice(committed?.ok ? 'saved' : 'saveFailed');
  };

  const savePreset = async () => {
    const name = presetName.trim();
    if (!name || busy) return;
    const preset = presetFromTournament(tournament, name, { id: ctx.newId() }, ctx.clock.now());
    if (!preset) {
      setNotice('presetFailed');
      return;
    }
    setBusy(true);
    await repos.presets.put(preset).then(
      () => setNotice('presetSaved'),
      () => setNotice('presetFailed'),
    );
    setBusy(false);
  };

  /** Runs one "new tournament" action; navigates to its setup on success. */
  const start = async (make: () => Promise<string | undefined>) => {
    if (busy) return;
    setBusy(true);
    try {
      const path = await make();
      if (path) navigate(path);
      else setBusy(false);
    } catch {
      setNotice('createFailed');
      setBusy(false);
    }
  };

  const duplicate = () =>
    start(async () => {
      const name = tournament.name ? t('results.copyName', { name: tournament.name }) : undefined;
      const id = await createDraft(repos, ctx, (s) => duplicateOf(s, tournament, name, ctx));
      return resumePath(id);
    });

  const sameChips = () =>
    start(async () => {
      const inventory = tournament.inventoryId
        ? await repos.inventories.get(tournament.inventoryId)
        : undefined;
      if (!inventory) {
        setNotice('noInventory');
        return undefined;
      }
      const id = await createDraft(repos, ctx, (s) => loadInventory(s, inventory));
      return setupPath(id, 'basics');
    });

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6">
      <header className="flex flex-col gap-2 text-center">
        <h1 className="font-display text-4xl text-accent">
          {t(completed ? 'clock.finished.title' : 'clock.cancelled.title')}
        </h1>
        {tournament.name && <p className="text-lg">{tournament.name}</p>}
        {completed && winner && (
          <p className="text-2xl font-semibold">
            {t('results.winner', { name: winner })} {t('celebration.winner')}
          </p>
        )}
      </header>

      {completed && (
        <form
          className={`${card} flex flex-col gap-4`}
          aria-labelledby={ids.positions}
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <h2 id={ids.positions} className="text-xl font-semibold">
            {t('results.positions')}
          </h2>
          <p className={hint}>{t('results.positionsHint')}</p>
          <ol className="flex flex-col gap-2">
            {form.names.map((name, i) => (
              <li key={i} className="flex items-center gap-3">
                <span className="w-12 shrink-0 font-semibold tabular-nums">{ordinal(i + 1)}</span>
                <input
                  className={input}
                  aria-label={t('results.placeName', { place: ordinal(i + 1) })}
                  value={name}
                  maxLength={60}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, names: f.names.map((n, j) => (j === i ? e.target.value : n)) }))
                  }
                />
              </li>
            ))}
          </ol>
          <div className="flex flex-col gap-1">
            <label htmlFor={ids.duration} className={label}>
              {t('results.duration')}
            </label>
            <input
              id={ids.duration}
              className={input}
              inputMode="numeric"
              aria-invalid={durationError}
              aria-describedby={ids.durationHint}
              value={form.durationMin}
              onChange={(e) => setForm((f) => ({ ...f, durationMin: e.target.value }))}
            />
            <p id={ids.durationHint} className={hint}>
              {durationError
                ? t('results.durationError', { max: MAX_DURATION_MIN })
                : t('results.durationHint')}
            </p>
          </div>
          <button type="submit" className={`${buttonPrimary} self-start`}>
            {t('results.save')}
          </button>
        </form>
      )}

      <section className={`${card} flex flex-col gap-4`} aria-label={t('results.next')}>
        <h2 className="text-xl font-semibold">{t('results.next')}</h2>
        <div className="flex flex-col gap-1">
          <label htmlFor={ids.preset} className={label}>
            {t('results.presetName')}
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              id={ids.preset}
              className={`${input} flex-1`}
              value={presetName}
              maxLength={60}
              onChange={(e) => setPresetName(e.target.value)}
            />
            <button
              type="button"
              className={buttonSecondary + ' bg-surface'}
              disabled={busy || presetName.trim() === ''}
              onClick={() => void savePreset()}
            >
              {t('results.savePreset')}
            </button>
          </div>
          <p className={hint}>{t('results.presetHint')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonSecondary + ' bg-surface'} disabled={busy} onClick={() => void duplicate()}>
            {t('results.duplicate')}
          </button>
          {tournament.inventoryId && (
            <button type="button" className={buttonSecondary + ' bg-surface'} disabled={busy} onClick={() => void sameChips()}>
              {t('results.sameChips')}
            </button>
          )}
        </div>
      </section>

      {notice && (
        <p role={notice === 'saved' || notice === 'presetSaved' ? 'status' : 'alert'} className="text-center">
          {t(`results.notice.${notice}`)}
        </p>
      )}

      <Link to="/" className={buttonSecondary + ' inline-flex items-center justify-center'}>
        {t('setup.home')}
      </Link>
    </main>
  );
}

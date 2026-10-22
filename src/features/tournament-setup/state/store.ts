import { createStore, type StoreApi } from 'zustand/vanilla';
import type { ModuleContext } from '@/core/modules/contract';
import type { Repositories } from '@/core/persistence/repositories';
import type { Inventory } from '@/features/chip-inventory/domain/inventory';
import { ensureSchedule, toTournament, type WizardState } from './wizard';

// Wizard store: holds the working state and auto-saves the draft after every change (spec 01 §5).
// Saves are serialised and coalesced: a burst of edits writes the latest state once.

export type SaveStatus = 'saved' | 'saving' | 'error';

export interface WizardStore {
  wizard: WizardState;
  saveStatus: SaveStatus;
  update(action: (state: WizardState) => WizardState): void;
  /** Resolves once every queued save has finished. */
  flush(): Promise<void>;
}

export interface WizardDeps {
  repos: Repositories<Inventory>;
  ctx: ModuleContext;
}

export function createWizardStore(initial: WizardState, deps: WizardDeps): StoreApi<WizardStore> {
  let chain: Promise<void> = Promise.resolve();
  let queued = false;

  return createStore<WizardStore>()((set, get) => {
    const write = async () => {
      queued = false;
      set({ saveStatus: 'saving' });
      try {
        const tournament = toTournament(get().wizard, deps.ctx.clock.now());
        const result = await deps.repos.tournaments.commit({ tournament });
        if (!queued) set({ saveStatus: result.ok ? 'saved' : 'error' });
      } catch {
        set({ saveStatus: 'error' });
      }
    };
    const save = () => {
      if (queued) return;
      queued = true;
      chain = chain.then(write);
    };
    return {
      wizard: ensureSchedule(initial, deps.ctx),
      saveStatus: 'saved',
      update(action) {
        const next = ensureSchedule(action(get().wizard), deps.ctx);
        if (next === get().wizard) return;
        set({ wizard: next });
        save();
      },
      async flush() {
        let current: Promise<void>;
        do {
          current = chain;
          await current;
        } while (current !== chain);
      },
    };
  });
}

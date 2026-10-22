import { createContext, useContext } from 'react';
import { useStore, type StoreApi } from 'zustand';
import type { ModuleContext } from '@/core/modules/contract';
import type { Repositories } from '@/core/persistence/repositories';
import type { Inventory } from '@/features/chip-inventory/domain/inventory';
import type { PhotoService } from '@/features/chip-inventory/photo/service';
import type { WizardStore } from '../state/store';
import type { WizardState } from '../state/wizard';

export interface WizardEnv {
  store: StoreApi<WizardStore>;
  repos: Repositories<Inventory>;
  ctx: ModuleContext;
  photo?: PhotoService | undefined;
}

export const WizardContext = createContext<WizardEnv | null>(null);

export function useWizardEnv(): WizardEnv {
  const env = useContext(WizardContext);
  if (!env) throw new Error('useWizardEnv outside the setup wizard');
  return env;
}

export function useWizard<T>(select: (state: WizardState) => T): T {
  const { store } = useWizardEnv();
  return useStore(store, (s) => select(s.wizard));
}

export function useUpdate(): WizardStore['update'] {
  const { store } = useWizardEnv();
  return useStore(store, (s) => s.update);
}

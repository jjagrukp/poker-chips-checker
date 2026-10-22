import type { GameModule } from './contract';

export class ModuleRegistrationError extends Error {
  constructor(moduleId: string, reason: string) {
    super(`Cannot register module "${moduleId}": ${reason}`);
    this.name = 'ModuleRegistrationError';
  }
}

export class UnknownModule extends Error {
  constructor(readonly moduleId: string) {
    super(`Unknown game module "${moduleId}"`);
    this.name = 'UnknownModule';
  }
}

export interface ModuleRegistry {
  get(id: string): GameModule | undefined;
  /** Throws UnknownModule. */
  require(id: string): GameModule;
  list(): GameModule[];
}

/** Built once at the composition root (src/app/configuration/modules.ts). */
export function createModuleRegistry(modules: readonly GameModule[]): ModuleRegistry {
  const byId = new Map<string, GameModule>();
  for (const m of modules) {
    if (!m.id.trim()) throw new ModuleRegistrationError(m.id, 'id is empty');
    if (!m.version.trim()) throw new ModuleRegistrationError(m.id, 'version is empty');
    if (byId.has(m.id)) throw new ModuleRegistrationError(m.id, 'id is already registered');
    const { min, max } = m.playerRange;
    if (!(Number.isInteger(min) && Number.isInteger(max) && min >= 1 && min <= max)) {
      throw new ModuleRegistrationError(m.id, 'playerRange is invalid');
    }
    byId.set(m.id, m);
  }
  return {
    get: (id) => byId.get(id),
    require: (id) => {
      const m = byId.get(id);
      if (!m) throw new UnknownModule(id);
      return m;
    },
    list: () => [...byId.values()],
  };
}

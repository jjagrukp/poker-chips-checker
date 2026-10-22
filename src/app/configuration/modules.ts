import { createModuleRegistry } from '@/core/modules/registry';
import { texasHoldemModule } from '@/modules/texas-holdem/module';

// Composition root for game modules (spec 02 §2).
export const moduleRegistry = createModuleRegistry([texasHoldemModule]);

// Test-only: renders the real routes in memory with fake-indexeddb storage.
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ModuleContext } from '@/core/modules/contract';
import type { PhotoService } from '@/features/chip-inventory/photo/service';
import type { ClockPlatform } from '@/features/live-clock/state/clock-store';
import { openAppTestStorage } from '@/infrastructure/testing/storage';
import { ServicesProvider } from '../ServicesProvider';
import { AppRoutes } from './AppRoutes';

export function testContext(): ModuleContext {
  let n = 0;
  return { clock: { now: () => 1_700_000_000_000 + n * 1000 }, newId: () => `id-${++n}` };
}

type AppRepos = Awaited<ReturnType<typeof openAppTestStorage>>;

interface Options {
  ctx?: ModuleContext;
  clockPlatform?: ClockPlatform;
  photo?: PhotoService;
}

/** Pass `repos` to remount on the same storage (a reload). */
export async function renderApp(path = '/', existing?: AppRepos, options: Options = {}) {
  const repos = existing ?? (await openAppTestStorage());
  const ctx = options.ctx ?? testContext();
  const view = render(
    <ServicesProvider
      services={{ repos, ctx, clockPlatform: options.clockPlatform, photo: options.photo }}
    >
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </ServicesProvider>,
  );
  return { ...view, repos, ctx };
}

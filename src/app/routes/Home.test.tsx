import { fireEvent, screen, waitFor } from '@testing-library/react';
import { brand } from '@/app/configuration/brand';
import { renderApp } from '@/app/testing/render-app';

describe('Home', () => {
  it('shows the brand name and tagline from brand config', async () => {
    await renderApp('/');
    expect(
      await screen.findByRole('heading', { level: 1, name: brand.appName }),
    ).toBeInTheDocument();
    expect(screen.getByText(brand.tagline)).toBeInTheDocument();
  });

  it('offers New tournament and links to Settings', async () => {
    await renderApp('/');
    expect(await screen.findByRole('button', { name: 'New tournament' })).toBeEnabled();
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings');
  });

  it('shows the durability notice until it is dismissed', async () => {
    const { repos, unmount } = await renderApp('/');
    expect(await screen.findByText(/saved only in this browser/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export backup' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(screen.queryByText(/saved only in this browser/)).not.toBeInTheDocument();
    await waitFor(async () =>
      expect((await repos.settings.get()).durabilityNoticeDismissedAt).toBeDefined(),
    );
    unmount();
    await renderApp('/', repos);
    await screen.findByRole('button', { name: 'New tournament' });
    expect(screen.queryByText(/saved only in this browser/)).not.toBeInTheDocument();
  });
});

import { screen } from '@testing-library/react';
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

  it('enables New tournament; Settings is still to come', async () => {
    await renderApp('/');
    expect(await screen.findByRole('button', { name: 'New tournament' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeDisabled();
  });
});

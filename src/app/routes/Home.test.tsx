import { render, screen } from '@testing-library/react';
import { brand } from '@/app/configuration/brand';
import { Home } from './Home';

describe('Home', () => {
  it('shows the brand name and tagline from brand config', () => {
    render(<Home />);
    expect(screen.getByRole('heading', { level: 1, name: brand.appName })).toBeInTheDocument();
    expect(screen.getByText(brand.tagline)).toBeInTheDocument();
  });

  it('shows placeholder actions as disabled', () => {
    render(<Home />);
    expect(screen.getByRole('button', { name: 'New tournament' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeDisabled();
  });
});

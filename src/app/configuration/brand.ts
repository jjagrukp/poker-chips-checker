// The only place product branding lives. The name is undecided (docs/DECISIONS.md Q2).
export interface Brand {
  appName: string;
  /** Home Screen label (≤ 12 characters). */
  shortName: string;
  tagline: string;
  /** Path under /public. */
  logo: string;
  themeId: 'default';
  /** Manifest/browser chrome colour; matches `--color-surface` in index.css. */
  themeColour: string;
}

export const brand: Brand = {
  appName: 'Tournament Clock',
  shortName: 'Tourney',
  tagline: 'Blinds, breaks and bragging rights, sorted.',
  logo: '/logo.svg',
  themeId: 'default',
  themeColour: '#14122b',
};

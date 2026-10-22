// The only place product branding lives. The name is undecided (docs/DECISIONS.md Q2).
export interface Brand {
  appName: string;
  tagline: string;
  /** Path under /public. */
  logo: string;
  themeId: 'default';
}

export const brand: Brand = {
  appName: 'Tournament Clock',
  tagline: 'Blinds, breaks and bragging rights, sorted.',
  logo: '/logo.svg',
  themeId: 'default',
};

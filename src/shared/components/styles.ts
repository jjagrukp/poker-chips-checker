// Shared Tailwind class sets. Every interactive control is at least 44 px tall (spec 01 §7).

export const buttonPrimary =
  'min-h-11 rounded-xl bg-accent px-4 py-2 font-semibold text-accent-ink disabled:cursor-not-allowed disabled:opacity-50';
export const buttonSecondary =
  'min-h-11 rounded-xl bg-surface-raised px-4 py-2 font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-50';
export const buttonQuiet =
  'min-h-11 rounded-xl px-3 py-2 font-semibold text-ink underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:opacity-50';
export const input =
  'min-h-11 w-full rounded-lg border border-ink-muted/40 bg-surface px-3 py-2 text-ink aria-invalid:border-accent';
export const label = 'text-sm font-semibold text-ink';
export const hint = 'text-sm text-ink-muted';
export const card = 'rounded-2xl bg-surface-raised p-4';

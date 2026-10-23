// Shared Tailwind class sets (spec 09). Every interactive control is at least 44 px tall
// (spec 01 §7). Press feedback is a slight scale, only when motion is allowed. Field and
// icon-button edges use ink-muted/40 so they stay visible (WCAG 1.4.11).

const control =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl px-4 py-2 font-semibold transition duration-150 ease-out motion-safe:active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-45 disabled:active:scale-100';

export const buttonPrimary = `${control} bg-linear-to-b from-accent-strong to-accent text-accent-ink shadow-[var(--shadow-press)] hover:brightness-105`;
export const buttonSecondary = `${control} border border-line bg-surface-high text-ink hover:border-ink-muted/40 hover:bg-[#252d4d]`;
export const buttonQuiet = `${control} px-3 text-ink underline-offset-4 hover:bg-white/5`;
export const buttonDanger = `${control} border border-danger/40 bg-danger/10 text-[#ffb3b3] hover:bg-danger/20`;
/** Round icon-only control; give it an aria-label. */
export const buttonIcon =
  'inline-flex size-11 shrink-0 items-center justify-center rounded-full border border-ink-muted/40 bg-surface-high text-ink transition duration-150 ease-out hover:bg-[#252d4d] motion-safe:active:scale-95 disabled:cursor-not-allowed disabled:opacity-40';

export const input =
  'min-h-11 w-full rounded-xl border border-ink-muted/40 bg-surface-high px-3 py-2 text-ink placeholder:text-ink-muted/70 transition focus:border-accent/60 aria-invalid:border-danger';
export const label = 'text-sm font-semibold text-ink';
export const hint = 'text-sm text-ink-muted';
export const card = 'rounded-3xl border border-line bg-surface-raised/90 p-4 shadow-[var(--shadow-card)] sm:p-5';
/** Small uppercase heading over a group (Next, Players…). */
export const eyebrow = 'text-xs font-bold uppercase tracking-[0.14em] text-ink-muted';
export const pill =
  'inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-high px-3 py-1 text-sm font-semibold';
/** Page title on ordinary screens. */
export const pageTitle = 'font-display text-4xl font-bold leading-tight sm:text-5xl';
/** A radio/checkbox choice as a card; the checked state styles itself via :has. */
export const optionCard =
  'flex min-h-11 cursor-pointer items-start gap-3 rounded-2xl border border-line bg-surface-raised/80 px-4 py-3 transition hover:border-ink-muted/40 has-[:checked]:border-accent has-[:checked]:bg-accent/10 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus [&_input]:accent-accent';

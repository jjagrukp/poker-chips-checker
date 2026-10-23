// Inline icon set (spec 09 §3, D43): 24 px grid, 2 px round strokes, currentColor. Always
// decorative: the control's text or aria-label carries the meaning.

const PATHS = {
  play: 'M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z',
  pause: 'M8 5v14M16 5v14',
  next: 'M6 5.5v13l9-6.5-9-6.5ZM18 5v14',
  previous: 'M18 5.5v13L9 12l9-6.5ZM6 5v14',
  coffee: 'M4 9h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9Zm12 1h1.5a2.5 2.5 0 0 1 0 5H16M8 3v3M12 3v3',
  volume: 'M4 9.5v5h3.5L12 18V6L7.5 9.5H4Zm12-1a5 5 0 0 1 0 7m2.5-10a8.5 8.5 0 0 1 0 13',
  mute: 'M4 9.5v5h3.5L12 18V6L7.5 9.5H4Zm12 0 5 5m0-5-5 5',
  bell: 'M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16Zm4 4a2 2 0 0 0 4 0',
  expand: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  shrink: 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5',
  tv: 'M3 6.5A1.5 1.5 0 0 1 4.5 5h15A1.5 1.5 0 0 1 21 6.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 15.5v-9ZM8 21h8M12 17v4',
  edit: 'M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Zm9-13 4 4',
  flag: 'M5 21V4m0 0h11l-2 4 2 4H5',
  home: 'M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1v-8Z',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-2-1.2L14.5 3h-5l-.4 2.6a7.5 7.5 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 0 0 2 1.2l.4 2.6h5l.4-2.6a7.5 7.5 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z',
  camera: 'M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.5-2h6l1.5 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5v-9ZM12 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  check: 'M5 12.5 10 17l9-10',
  chevronRight: 'M9 5l7 7-7 7',
  chevronLeft: 'M15 5l-7 7 7 7',
  users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-6 9a6 6 0 0 1 12 0M16 4.5a3.5 3.5 0 0 1 0 6.5M21 20a6 6 0 0 0-4-5.6',
  stack: 'M4 7c0-1.4 3.6-2.5 8-2.5S20 5.6 20 7s-3.6 2.5-8 2.5S4 8.4 4 7Zm0 0v5c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5V7M4 12v5c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5v-5',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v4.5l3 2',
  copy: 'M9 9h10v11H9V9Zm-4 6V4h10',
  share: 'M12 15V3m0 0L8 7m4-4 4 4M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7',
  trash: 'M5 7h14M10 7V4h4v3m-7 0 1 13h8l1-13',
  cards: 'M4 7.5 11 5l3.5 12.5-7 2.5L4 7.5Zm9.5-3 6 1.5L17 18M15 9l2.5.7',
  music: 'M9 18V5.5L20 3v12.5M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm11-2.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
} as const;

export type IconName = keyof typeof PATHS;

const FILLED: ReadonlySet<IconName> = new Set(['play']);

export function Icon({ name, className = 'size-5' }: { name: IconName; className?: string }) {
  const filled = FILLED.has(name);
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className={`shrink-0 ${className}`}
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={filled ? 1 : 2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

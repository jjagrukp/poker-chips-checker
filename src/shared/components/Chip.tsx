// A poker chip drawn from one colour (spec 09 §3): body, edge inserts and inner ring in a
// contrasting tone, optional value in the middle. Decorative unless given a label.

import { chipContrast } from './chip-colour';

const INSERTS = 8;

interface Props {
  colour: string;
  /** Tailwind size classes, e.g. `size-10`. */
  className?: string;
  /** Short text in the centre (a value like "25" or "1K"). */
  value?: string | undefined;
  /** Gives the chip an accessible name; otherwise it's hidden from screen readers. */
  label?: string | undefined;
}

export function Chip({ colour, className = 'size-10', value, label }: Props) {
  const ink = chipContrast(colour);
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true as const };
  return (
    <svg viewBox="0 0 100 100" className={`shrink-0 drop-shadow-[0_4px_6px_rgba(0,0,0,0.45)] ${className}`} {...a11y}>
      <circle cx="50" cy="50" r="48" fill={colour} />
      {Array.from({ length: INSERTS }, (_, i) => (
        <rect
          key={i}
          x="44"
          y="2"
          width="12"
          height="15"
          rx="2"
          fill={ink}
          opacity="0.92"
          transform={`rotate(${(360 / INSERTS) * i} 50 50)`}
        />
      ))}
      <circle cx="50" cy="50" r="48" fill="none" stroke="#000" strokeOpacity="0.25" strokeWidth="2" />
      <circle cx="50" cy="50" r="30" fill={colour} stroke={ink} strokeOpacity="0.85" strokeWidth="2.5" strokeDasharray="5 4" />
      <circle cx="50" cy="50" r="24" fill="#fff" fillOpacity="0.08" />
      {/* Top-left sheen. */}
      <path d="M14 36a38 38 0 0 1 30-24" fill="none" stroke="#fff" strokeOpacity="0.28" strokeWidth="3" strokeLinecap="round" />
      {value && (
        <text
          x="50"
          y="50"
          textAnchor="middle"
          dominantBaseline="central"
          fill={ink}
          fontFamily="'Barlow Condensed', sans-serif"
          fontWeight="700"
          fontSize={value.length > 3 ? 20 : 26}
        >
          {value}
        </text>
      )}
    </svg>
  );
}

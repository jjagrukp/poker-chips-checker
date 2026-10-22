import { useEffect, useId, useState } from 'react';
import { hint as hintClass, input, label as labelClass } from './styles';

interface Props {
  label: string;
  value: number | undefined;
  /** Called only with whole numbers inside [min, max]. */
  onCommit: (value: number) => void;
  min: number;
  max: number;
  /** Shown while the typed text isn't a valid value. */
  error: string;
  hint?: string;
  /** Adds − / + buttons; their labels are required for screen readers. */
  stepper?: { decrease: string; increase: string; step?: number };
  /** 'blur' commits when focus leaves (or on Enter), for fields whose commit is expensive. */
  commitOn?: 'change' | 'blur';
}

/** Keeps the typed text locally so a half-typed number never reaches saved state. */
export function NumberField({
  label,
  value,
  onCommit,
  min,
  max,
  error,
  hint,
  stepper,
  commitOn = 'change',
}: Props) {
  const id = useId();
  const [text, setText] = useState(value === undefined ? '' : String(value));
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    setText((current) => (Number(current) === value && current !== '' ? current : String(value ?? '')));
  }, [value]);

  const parsed = /^\d+$/.test(text.trim()) ? Number(text.trim()) : NaN;
  const valid = Number.isInteger(parsed) && parsed >= min && parsed <= max;

  const commit = (next: string) => {
    const n = /^\d+$/.test(next.trim()) ? Number(next.trim()) : NaN;
    if (Number.isInteger(n) && n >= min && n <= max) onCommit(n);
  };
  const change = (next: string, immediate = commitOn === 'change') => {
    setText(next);
    setTouched(true);
    if (immediate) commit(next);
  };
  const bump = (delta: number) => {
    const base = Number.isFinite(parsed) ? parsed : (value ?? min);
    change(String(Math.min(max, Math.max(min, base + delta))), true);
  };

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <div className="flex items-center gap-2">
        {stepper && (
          <button
            type="button"
            className="min-h-11 min-w-11 rounded-lg bg-surface-raised text-xl font-bold"
            aria-label={stepper.decrease}
            onClick={() => bump(-(stepper.step ?? 1))}
          >
            −
          </button>
        )}
        <input
          id={id}
          className={input}
          inputMode="numeric"
          value={text}
          aria-invalid={touched && !valid}
          aria-describedby={hint ? `${id}-hint ${id}-error` : `${id}-error`}
          onChange={(e) => change(e.target.value)}
          onBlur={() => commitOn === 'blur' && commit(text)}
          onKeyDown={(e) => e.key === 'Enter' && commitOn === 'blur' && commit(text)}
        />
        {stepper && (
          <button
            type="button"
            className="min-h-11 min-w-11 rounded-lg bg-surface-raised text-xl font-bold"
            aria-label={stepper.increase}
            onClick={() => bump(stepper.step ?? 1)}
          >
            +
          </button>
        )}
      </div>
      {hint && (
        <p id={`${id}-hint`} className={hintClass}>
          {hint}
        </p>
      )}
      <p id={`${id}-error`} className="text-sm text-accent" aria-live="polite">
        {touched && !valid ? error : ''}
      </p>
    </div>
  );
}

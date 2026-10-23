import { useEffect, useId, useRef } from 'react';
import { useReveal } from './reveal';
import { buttonPrimary, buttonSecondary } from './styles';

interface Props {
  text: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Inline confirmation for destructive actions. */
export function ConfirmAction({ text, confirmLabel, cancelLabel, onConfirm, onCancel }: Props) {
  const id = useId();
  const cancel = useRef<HTMLButtonElement>(null);
  // Focus starts on Cancel so a stray Enter never deletes anything.
  useEffect(() => cancel.current?.focus(), []);
  const panel = useReveal<HTMLDivElement>();
  return (
    <div
      ref={panel}
      role="alertdialog"
      aria-modal="false"
      aria-labelledby={id}
      className="flex scroll-mt-4 flex-col gap-2"
    >
      <p id={id}>{text}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonPrimary} onClick={onConfirm}>
          {confirmLabel}
        </button>
        <button
          type="button"
          className={buttonSecondary}
          ref={cancel}
          onClick={onCancel}
        >
          {cancelLabel}
        </button>
      </div>
    </div>
  );
}

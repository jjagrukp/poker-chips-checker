import { useEffect, useRef, type RefObject } from 'react';

// Panels opened by a button (music, alerts, edit, confirmations and so on) can appear above,
// below or beside the button, often off screen on a phone. They scroll themselves into view.

/** Scrolls an element into view, smoothly unless the viewer asked for reduced motion. */
export function reveal(element: Element | null) {
  if (!element || typeof element.scrollIntoView !== 'function') return;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  // Top first: a tall panel shows its heading and first field, not its bottom edge. Roots carry
  // a scroll margin so they don't sit flush against the screen edge.
  element.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
}

/** Ref for a panel that brings itself into view when it mounts (`enabled` false to skip). */
export function useReveal<T extends Element>(enabled = true): RefObject<T> {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!enabled) return;
    // After focus moves (which jumps without animation), so this scroll wins.
    const id = requestAnimationFrame(() => reveal(ref.current));
    return () => cancelAnimationFrame(id);
  }, [enabled]);
  return ref;
}

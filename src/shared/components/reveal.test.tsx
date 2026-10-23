import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { reveal, useReveal } from './reveal';

function Panel({ enabled }: { enabled?: boolean }) {
  const ref = useReveal<HTMLDivElement>(enabled);
  return <div ref={ref}>panel</div>;
}

const original = { matchMedia: window.matchMedia, scroll: Element.prototype.scrollIntoView };
afterEach(() => {
  window.matchMedia = original.matchMedia;
  Element.prototype.scrollIntoView = original.scroll;
});

describe('reveal', () => {
  it('scrolls smoothly to the top of the element', () => {
    const scroll = vi.fn();
    const element = document.createElement('div');
    element.scrollIntoView = scroll;
    reveal(element);
    expect(scroll).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
  });

  it('jumps without animation for reduced motion', () => {
    window.matchMedia = vi.fn(() => ({ matches: true }) as MediaQueryList);
    const scroll = vi.fn();
    const element = document.createElement('div');
    element.scrollIntoView = scroll;
    reveal(element);
    expect(scroll).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' });
  });
});

describe('useReveal', () => {
  it('brings a panel into view when it opens, unless turned off', async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    render(<Panel enabled={false} />);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(scroll).not.toHaveBeenCalled();
    render(<Panel />);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(scroll).toHaveBeenCalledTimes(1);
  });
});

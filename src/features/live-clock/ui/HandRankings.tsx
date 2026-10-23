import { useId } from 'react';
import { HAND_RANKINGS, type ExampleCard, type Suit } from '@/modules/texas-holdem/hand-rankings';
import { useT } from '@/shared/messages/tone';

// Hand-rankings panel beside a big-screen clock (spec 10). Sized in em, so the caller's font
// size scales the whole panel to the screen. The example cards are decorative.

const SYMBOL: Record<Suit, string> = { spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣' };
const RED: ReadonlySet<Suit> = new Set(['hearts', 'diamonds']);

function PlayingCard({ card }: { card: ExampleCard }) {
  return (
    <span
      // Kickers are greyed with solid colours (not opacity) so the text keeps its contrast.
      className={`flex h-[3.1em] w-[2.25em] flex-col items-center justify-center rounded-[0.3em] font-clock font-bold leading-none shadow-[0_0.15em_0.3em_rgba(0,0,0,0.45)] ${
        card.kicker
          ? `bg-[#9aa0ae] ${RED.has(card.suit) ? 'text-[#6b1219]' : 'text-[#15171f]'}`
          : `bg-[#fbfaf6] ${RED.has(card.suit) ? 'text-[#c8202a]' : 'text-[#15171f]'}`
      }`}
    >
      <span className="text-[1.15em]">{card.rank}</span>
      <span className="text-[1.25em]">{SYMBOL[card.suit]}</span>
    </span>
  );
}

export function HandRankings({ className = '' }: { className?: string }) {
  const t = useT();
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className={`flex flex-col gap-[0.6em] rounded-[1.2em] border border-line bg-felt/40 p-[0.9em] ${className}`}
    >
      <h2 id={id} className="font-display text-[1.4em] font-bold">
        {t('holdem.hands.title')}
      </h2>
      <ol className="flex flex-1 flex-col justify-between gap-[0.35em]">
        {HAND_RANKINGS.map((hand, i) => (
          <li key={hand.id} className="flex items-center justify-between gap-[0.6em]">
            <span className="flex min-w-0 items-center gap-[0.5em]">
              <span
                aria-hidden="true"
                className="flex size-[1.6em] shrink-0 items-center justify-center rounded-full bg-ink text-[0.8em] font-bold text-surface"
              >
                {i + 1}
              </span>
              <span className="truncate font-semibold">
                <span className="sr-only">{i + 1}. </span>
                {t(`holdem.hand.${hand.id}`)}
              </span>
            </span>
            <span aria-hidden="true" className="flex shrink-0 gap-[0.2em]">
              {hand.cards.map((card, j) => (
                <PlayingCard key={j} card={card} />
              ))}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

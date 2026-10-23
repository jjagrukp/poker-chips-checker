import { HAND_IDS, HAND_RANKINGS } from './hand-rankings';

// Spec 10: ten hands, best first, five well-formed cards each; kickers only where a hand has them.

const SUITS = new Set(['spades', 'hearts', 'diamonds', 'clubs']);
const RANKS = new Set(['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2']);
const KICKERS: Record<string, number> = { fourOfAKind: 1, threeOfAKind: 2, twoPair: 1, pair: 3, highCard: 4 };

describe('HAND_RANKINGS', () => {
  it('lists every hand once, best first', () => {
    expect(HAND_RANKINGS.map((h) => h.id)).toEqual([...HAND_IDS]);
  });

  it('gives each hand five real cards and the right number of kickers', () => {
    for (const hand of HAND_RANKINGS) {
      expect(hand.cards).toHaveLength(5);
      for (const card of hand.cards) {
        expect(SUITS.has(card.suit)).toBe(true);
        expect(RANKS.has(card.rank)).toBe(true);
      }
      expect(hand.cards.filter((c) => c.kicker).length).toBe(KICKERS[hand.id] ?? 0);
    }
  });

  it('uses five different cards in every example', () => {
    for (const hand of HAND_RANKINGS) {
      const keys = hand.cards.map((c) => `${c.rank}${c.suit}`);
      expect(new Set(keys).size).toBe(5);
    }
  });
});

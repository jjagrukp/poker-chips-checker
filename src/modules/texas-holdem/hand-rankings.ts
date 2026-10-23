// Hold'em hand rankings, best first (spec 10): the reference panel beside a big-screen clock.
// Each hand has a five-card example; `kicker` marks cards that don't make the hand.

export type Suit = 'spades' | 'hearts' | 'diamonds' | 'clubs';

export interface ExampleCard {
  rank: string;
  suit: Suit;
  kicker?: true;
}

export const HAND_IDS = [
  'royalFlush',
  'straightFlush',
  'fourOfAKind',
  'fullHouse',
  'flush',
  'straight',
  'threeOfAKind',
  'twoPair',
  'pair',
  'highCard',
] as const;
export type HandId = (typeof HAND_IDS)[number];

const card = (text: string): ExampleCard => {
  // "A♦", "10♠", "K♥*" (the asterisk marks a kicker).
  const kicker = text.endsWith('*');
  const body = kicker ? text.slice(0, -1) : text;
  const suit = ({ '♠': 'spades', '♥': 'hearts', '♦': 'diamonds', '♣': 'clubs' } as const)[
    body.slice(-1) as '♠' | '♥' | '♦' | '♣'
  ];
  return { rank: body.slice(0, -1), suit, ...(kicker ? { kicker: true as const } : {}) };
};

const hand = (cards: string) => cards.split(' ').map(card);

export const HAND_RANKINGS: readonly { id: HandId; cards: readonly ExampleCard[] }[] = [
  { id: 'royalFlush', cards: hand('A♦ K♦ Q♦ J♦ 10♦') },
  { id: 'straightFlush', cards: hand('J♠ 10♠ 9♠ 8♠ 7♠') },
  { id: 'fourOfAKind', cards: hand('9♥ 9♣ 9♦ 9♠ K♥*') },
  { id: 'fullHouse', cards: hand('A♥ A♣ A♦ 3♠ 3♥') },
  { id: 'flush', cards: hand('K♣ 10♣ 8♣ 7♣ 5♣') },
  { id: 'straight', cards: hand('10♥ 9♣ 8♦ 7♠ 6♥') },
  { id: 'threeOfAKind', cards: hand('7♥ 7♦ 7♣ Q♠* 3♥*') },
  { id: 'twoPair', cards: hand('J♥ J♣ 5♦ 5♠ 7♥*') },
  { id: 'pair', cards: hand('A♥ A♣ K♦* J♠* 7♥*') },
  { id: 'highCard', cards: hand('K♥ Q♦* 8♣* 7♥* 2♠*') },
];

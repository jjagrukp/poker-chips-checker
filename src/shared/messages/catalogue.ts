// Every user-facing string lives here (Australian English). Transition and celebration
// messages have playful + neutral variants; errors, warnings and controls are always plain.
export type Tone = 'playful' | 'neutral';

export interface Variants {
  playful: string;
  neutral: string;
}

export type Message = string | Variants;

export const messages = {
  'home.newTournament': 'New tournament',
  'home.settings': 'Settings',
  'home.comingSoon': 'Coming soon',

  'transition.chipsCounted': {
    playful: 'The chips have been counted. Trust issues remain.',
    neutral: 'Chip count complete.',
  },
  'transition.levelUp': {
    playful: "The blinds are going up. Your excuses aren't helping.",
    neutral: 'The blinds are going up.',
  },
  'transition.breakOver': {
    playful: 'Bathroom break over. Financial decisions resume.',
    neutral: 'Break over. Play resumes.',
  },
  'celebration.winner': {
    playful: 'We have a winner. Everyone else has a story.',
    neutral: 'We have a winner.',
  },
} as const satisfies Record<string, Message>;

export type MessageKey = keyof typeof messages;

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

  'storage.durability.notice':
    "Your tournaments are saved only in this browser. Clearing site data, using private browsing, or switching browser or device will lose them. Safari may delete data from sites you haven't visited for 7 days unless you add this app to your Home Screen.",
  'storage.durability.install': 'Install app',
  'storage.durability.exportBackup': 'Export backup',
  'storage.durability.dismiss': 'Got it',
  'storage.persistence.granted': 'Saved data is protected from automatic clean-up.',
  'storage.persistence.denied': 'Your browser may clear saved data when space runs low.',
  'storage.persistence.unsupported': "This browser can't protect saved data from clean-up.",
  'storage.quarantine.notice':
    "Some saved data couldn't be read and has been set aside. Everything else loaded normally.",
  'storage.quarantine.export': 'Export set-aside data',
  'storage.quarantine.delete': 'Delete set-aside data',
  'backup.import.success': 'Backup imported.',
  'backup.import.invalidJson': "That file isn't a backup from this app.",
  'backup.import.invalidFormat': "That file isn't a backup from this app.",
  'backup.import.invalidRecords':
    "That backup contains records that couldn't be read. Nothing was imported.",
  'backup.import.writeFailed': "The backup couldn't be saved. Nothing was imported.",
  'tabs.viewerMode': "This tournament is being run in another tab. You're viewing it here.",
  'tabs.takeControl': 'Take control',

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

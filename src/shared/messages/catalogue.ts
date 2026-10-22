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

  'chips.error.tooManyChipTypes': 'Use at most {max} chip types (you have {count}).',
  'chips.error.invalidQuantity': '{colour}: enter a whole number of chips, 0 or more.',
  'chips.error.unconfirmed': '{colour}: check this row, then confirm it.',
  'chips.error.unknownChipType': "A value is set for a chip type that isn't in this set.",
  'chips.error.invalidValue': 'Chip values must be whole numbers above 0.',
  'chips.error.unassigned': '{colour}: give it a value or mark it as not used.',
  'chips.error.noChipsUsed': 'Choose at least one chip type to use.',
  'allocation.error.invalidPlayers': 'You need at least 2 players.',
  'allocation.error.invalidStack': 'The starting stack must be a whole number above 0.',
  'allocation.error.invalidBlinds': 'Blinds must be whole numbers above 0.',
  'allocation.error.rejected': "That chip split didn't add up, so it wasn't used. Try again.",
  'allocation.warning.fewChips': 'Only {count} chips each. {min} or more is easier to play with.',
  'allocation.warning.manyChips': '{count} chips each. More than {max} gets hard to stack.',
  'allocation.warning.fewSmallChips': 'Only {count} chips of the {value} each for paying blinds.',
  'allocation.warning.fewDenominations':
    'Only {count} chip values used, so making change is harder.',
  'allocation.warning.notPyramid': 'Some higher-value chips outnumber lower-value ones.',
  'allocation.warning.dominantType': '{colour} chips make up more than half of each stack.',
  'allocation.warning.searchTruncated':
    'There were too many combinations to check them all. This is the best one found.',
  'allocation.impossible.searchLimit':
    'That stack is possible, but there were too many combinations to find it. Try a nearby stack.',
  'allocation.impossible.noChipsEach':
    "There aren't enough chips of any type to give all {players} players at least one.",
  'allocation.impossible.capped':
    '{colour} chips: {quantity} for {players} players caps each player at {cap}. The biggest possible stack is {maxStack}.',
  'allocation.impossible.tooBig':
    'Stacks are limited to {max} chips of each type, so the biggest possible stack is {maxStack}.',
  'allocation.impossible.smallBlind':
    'The smallest chip ({colour}, {value}) has to divide the first small blind of {firstSB}.',
  'allocation.impossible.stackTooSmall':
    'The smallest chip ({colour}, {value}) is too big for a stack this size.',
  'allocation.impossible.notDivisible':
    "A stack of {stack} can't be made: stacks go up in steps of {step}.",
  'allocation.impossible.noCombination': "These chips can't make that exact stack.",
  'allocation.recommend.none':
    "These chips can't make any standard starting stack for this many players.",
  'allocation.recommend.explanation':
    '{stack} gives each player {chips} chips across {denominations} values, with the fewest compromises.',

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

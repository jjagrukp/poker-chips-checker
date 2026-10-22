import { messages } from './catalogue';
import { interpolate, resolveMessage, t } from './index';

describe('t', () => {
  it('returns plain strings regardless of tone', () => {
    expect(t('home.settings', 'playful')).toBe('Settings');
    expect(t('home.settings', 'neutral')).toBe('Settings');
  });

  it('picks the variant matching the tone', () => {
    expect(t('transition.breakOver', 'playful')).toBe(
      'Bathroom break over. Financial decisions resume.',
    );
    expect(t('transition.breakOver', 'neutral')).toBe('Break over. Play resumes.');
  });

  it('defaults to the playful tone', () => {
    expect(t('celebration.winner')).toBe(messages['celebration.winner'].playful);
  });
});

describe('interpolation', () => {
  it('fills placeholders and leaves unknown ones alone', () => {
    expect(t('allocation.error.invalidPlayers', 'neutral', {})).toBe(
      'You need at least 2 players.',
    );
    expect(t('chips.error.unassigned', 'neutral', { colour: 'Red' })).toBe(
      'Red: give it a value or mark it as not used.',
    );
    expect(interpolate('{a} and {b}', { a: 1 })).toBe('1 and {b}');
  });
});

describe('catalogue', () => {
  it('has non-empty text for every key and tone', () => {
    for (const message of Object.values(messages)) {
      expect(resolveMessage(message, 'playful').trim()).not.toBe('');
      expect(resolveMessage(message, 'neutral').trim()).not.toBe('');
    }
  });
});

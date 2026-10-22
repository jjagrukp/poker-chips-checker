import { messages } from './catalogue';
import { resolveMessage, t } from './index';

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

describe('catalogue', () => {
  it('has non-empty text for every key and tone', () => {
    for (const message of Object.values(messages)) {
      expect(resolveMessage(message, 'playful').trim()).not.toBe('');
      expect(resolveMessage(message, 'neutral').trim()).not.toBe('');
    }
  });
});

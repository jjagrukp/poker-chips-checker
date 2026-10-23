import { phoneClockOffset, type ScreenReply } from './schema';
import { CodeSchema, formatCode, normaliseCode } from './wire';

describe('share codes', () => {
  it('normalises what someone types on a TV remote', () => {
    expect(normaliseCode('abcd-2345')).toBe('ABCD2345');
    expect(normaliseCode(' ab cd 23 45 ')).toBe('ABCD2345');
    expect(normaliseCode('ABCD234')).toBeUndefined();
    // Lookalikes aren't in the alphabet, so they can't be part of a code.
    expect(normaliseCode('ABCD23O5')).toBeUndefined();
    expect(normaliseCode('ABCD2315')).toBeUndefined();
  });

  it('formats in two groups of four', () => {
    expect(formatCode('ABCD2345')).toBe('ABCD-2345');
    expect(CodeSchema.safeParse('ABCD2345').success).toBe(true);
  });
});

describe('phoneClockOffset (spec 08 §3)', () => {
  const reply = (sentAt: number, receivedAt: number, serverNow: number) =>
    ({ snapshot: { sentAt }, receivedAt, serverNow }) as unknown as ScreenReply;

  it('maps the TV clock onto the phone clock', () => {
    // Phone 3 s behind the server, TV 10 s ahead of it: phone time = TV time − 13 s.
    const offset = phoneClockOffset(reply(97_000, 100_000, 200_000), 210_000);
    expect(offset).toBe(-13_000);
    expect(210_000 + offset).toBe(200_000 - 3_000);
  });

  it('is zero when every clock agrees', () => {
    expect(phoneClockOffset(reply(5_000, 5_000, 9_000), 9_000)).toBe(0);
  });
});

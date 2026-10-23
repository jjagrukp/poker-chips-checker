import { CodeSchema, KeySchema } from '@/features/screen-share/wire';
import { createShareStorage, newShare } from './shares';

describe('newShare', () => {
  it('makes a valid code and key', () => {
    for (let i = 0; i < 50; i++) {
      const share = newShare();
      expect(CodeSchema.safeParse(share.code).success).toBe(true);
      expect(KeySchema.safeParse(share.key).success).toBe(true);
    }
  });

  it('redraws bytes that would bias the alphabet', () => {
    // 255 is past the last whole multiple of 30, so it must be skipped.
    let call = 0;
    const share = newShare((bytes) => bytes.fill(call++ === 0 ? 255 : 0));
    expect(share.code).toBe('22222222');
  });
});

describe('share storage', () => {
  const map = new Map<string, string>();
  const storage = createShareStorage(
    () =>
      ({
        getItem: (k: string) => map.get(k) ?? null,
        setItem: (k: string, v: string) => void map.set(k, v),
        removeItem: (k: string) => void map.delete(k),
      }) as Storage,
  );

  it('round-trips and ignores records that fail the schema', () => {
    const share = newShare();
    storage.set('t1', share);
    expect(storage.get('t1')).toEqual(share);
    map.set('screen-share:t2', JSON.stringify({ ...share, code: 'nope' }));
    expect(storage.get('t2')).toBeUndefined();
    map.set('screen-share:t3', '{broken');
    expect(storage.get('t3')).toBeUndefined();
    storage.remove('t1');
    expect(storage.get('t1')).toBeUndefined();
  });

  it('acts as empty when storage throws', () => {
    const blocked = createShareStorage(() => {
      throw new Error('blocked');
    });
    expect(blocked.get('t1')).toBeUndefined();
    expect(() => blocked.set('t1', newShare())).not.toThrow();
  });
});

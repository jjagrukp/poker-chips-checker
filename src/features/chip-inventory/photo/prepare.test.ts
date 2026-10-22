import { prepareImage, targetSize, type ImageCodec } from './prepare';
import { MAX_UPLOAD_BYTES } from './schema';

// The real canvas codec is exercised in e2e (it needs a browser); here a fake checks the rules.

/** SOI + an EXIF APP1 + start of scan + filler: what Safari's encoder can produce. */
function encoderOutput(size: number): Uint8Array {
  const out = new Uint8Array(size);
  out.set([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x08, 0x45, 0x78, 0x69, 0x66, 0, 0, 0xff, 0xda]);
  return out;
}

function fakeCodec(width: number, height: number, outputBytes = 1000) {
  const calls: { width: number; height: number; quality: number }[] = [];
  const released: unknown[] = [];
  const codec: ImageCodec = {
    decode: async () => ({ width, height }),
    encodeJpeg: async (_image, w, h, quality) => {
      calls.push({ width: w, height: h, quality });
      return encoderOutput(outputBytes);
    },
    release: (image) => released.push(image),
  };
  return { codec, calls, released };
}

const file = (type = 'image/jpeg', size = 10) => new Blob([new Uint8Array(size)], { type });

describe('targetSize', () => {
  it('caps the long edge at 1600 px and never upscales', () => {
    expect(targetSize(4032, 3024)).toEqual({ width: 1600, height: 1200 });
    expect(targetSize(3024, 4032)).toEqual({ width: 1200, height: 1600 });
    expect(targetSize(800, 600)).toEqual({ width: 800, height: 600 });
  });
});

describe('prepareImage', () => {
  it('re-encodes as JPEG q0.85 at the target size', async () => {
    const { codec, calls, released } = fakeCodec(4000, 2000);
    const result = await prepareImage(file('image/png'), codec);
    expect(result).toMatchObject({ ok: true, width: 1600, height: 800 });
    expect(calls).toEqual([{ width: 1600, height: 800, quality: 0.85 }]);
    expect(released).toHaveLength(1);
    // The encoder's own EXIF segment is stripped before upload.
    if (!result.ok) return;
    expect([...result.bytes.subarray(0, 4)]).toEqual([0xff, 0xd8, 0xff, 0xda]);
    expect(result.bytes.length).toBe(1000 - 10);
  });

  it('rejects unsupported types and oversized raw files before decoding', async () => {
    const { codec, calls } = fakeCodec(100, 100);
    expect(await prepareImage(file('image/gif'), codec)).toEqual({
      ok: false,
      reason: 'unsupported_type',
    });
    const huge = { type: 'image/jpeg', size: 21 * 1024 * 1024 } as Blob;
    expect(await prepareImage(huge, codec)).toEqual({ ok: false, reason: 'too_large' });
    expect(calls).toHaveLength(0);
  });

  it('rejects an output that is still over 1.5 MB', async () => {
    const { codec } = fakeCodec(1600, 1600, MAX_UPLOAD_BYTES + 11);
    expect(await prepareImage(file(), codec)).toEqual({ ok: false, reason: 'too_large' });
  });

  it('reports undecodable files (e.g. HEIC outside Safari)', async () => {
    const codec: ImageCodec = {
      decode: async () => Promise.reject(new Error('nope')),
      encodeJpeg: async () => new Uint8Array(),
    };
    expect(await prepareImage(file('image/heic'), codec)).toEqual({
      ok: false,
      reason: 'decode_failed',
    });
  });
});

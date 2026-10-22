import type { ImageCodec } from '@/features/chip-inventory/photo/prepare';
import { createPhotoService } from './photo-service';

const codec = {} as ImageCodec<ImageBitmap>;
const image = new Uint8Array([0xff, 0xd8, 0xff]);

const OK = {
  schemaVersion: 1,
  status: 'ok',
  chipTypes: [],
  imageIssues: ['glare'],
  message: null,
};

function service(reply: () => Promise<Response>, timeoutMs?: number) {
  const fetch = vi.fn(reply);
  return {
    fetch,
    photo: createPhotoService({
      fetch: fetch as unknown as typeof globalThis.fetch,
      codec,
      ...(timeoutMs ? { timeoutMs } : {}),
    }),
  };
}

describe('photo service', () => {
  it('reads the feature flag and treats an unreachable config as off', async () => {
    expect(
      await service(async () => Response.json({ aiPhotoEnabled: true })).photo.config(),
    ).toEqual({
      aiPhotoEnabled: true,
    });
    expect(
      await service(async () => Promise.reject(new TypeError('offline'))).photo.config(),
    ).toEqual({
      aiPhotoEnabled: false,
    });
    expect(
      await service(async () => new Response('<html>', { status: 404 })).photo.config(),
    ).toEqual({
      aiPhotoEnabled: false,
    });
    expect(
      await service(async () => Response.json({ aiPhotoEnabled: 'yes' })).photo.config(),
    ).toEqual({
      aiPhotoEnabled: false,
    });
  });

  it('validates the response client-side', async () => {
    const ok = service(async () => Response.json(OK));
    expect(await ok.photo.analyse(image, new AbortController().signal)).toEqual({
      ok: true,
      analysis: OK,
    });
    const [url, init] = ok.fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/analyse-chips');
    expect(init).toMatchObject({ method: 'POST', headers: { 'content-type': 'image/jpeg' } });
    expect(init.body).toBe(image);

    const bad = service(async () => Response.json({ ...OK, chipTypes: [{ evil: true }] }));
    expect(await bad.photo.analyse(image, new AbortController().signal)).toEqual({
      ok: false,
      reason: 'invalid_response',
    });
  });

  it('maps server error codes, network failures and timeouts', async () => {
    const signal = new AbortController().signal;
    const capped = service(async () => Response.json({ error: 'daily_cap' }, { status: 429 }));
    expect(await capped.photo.analyse(image, signal)).toEqual({ ok: false, reason: 'daily_cap' });
    const proxy = service(async () => new Response('busy', { status: 429 }));
    expect(await proxy.photo.analyse(image, signal)).toEqual({ ok: false, reason: 'rate_limited' });
    const offline = service(async () => Promise.reject(new TypeError('offline')));
    expect(await offline.photo.analyse(image, signal)).toEqual({ ok: false, reason: 'network' });

    const slow = createPhotoService({
      fetch: ((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) =>
          init.signal?.addEventListener('abort', () => reject(new DOMException('', 'AbortError'))),
        )) as unknown as typeof fetch,
      codec,
      timeoutMs: 10,
    });
    expect(await slow.analyse(image, signal)).toEqual({ ok: false, reason: 'timeout' });
  });

  it('rejects when the caller cancels', async () => {
    const controller = new AbortController();
    const photo = createPhotoService({
      fetch: ((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) =>
          init.signal?.addEventListener('abort', () => reject(new DOMException('', 'AbortError'))),
        )) as unknown as typeof fetch,
      codec,
    });
    const pending = photo.analyse(image, controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow();
  });
});

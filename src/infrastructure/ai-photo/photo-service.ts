import { prepareImage, type ImageCodec } from '@/features/chip-inventory/photo/prepare';
import {
  PhotoAnalysisSchema,
  PhotoConfigSchema,
  PhotoErrorSchema,
} from '@/features/chip-inventory/photo/schema';
import type { AnalyseResult, PhotoService } from '@/features/chip-inventory/photo/service';

// Browser PhotoService (spec 06 §1): canvas codec, 55 s client timeout, and Zod on every
// response, because AI output is untrusted on this side too.

// Above the server's 45 s budget so its timeout reply arrives first (D39).
export const CLIENT_TIMEOUT_MS = 55_000;

interface Deps {
  fetch: typeof fetch;
  codec: ImageCodec<ImageBitmap>;
  timeoutMs?: number;
}

export function createPhotoService({
  fetch,
  codec,
  timeoutMs = CLIENT_TIMEOUT_MS,
}: Deps): PhotoService {
  return {
    async config() {
      try {
        const response = await fetch('/api/config', { cache: 'no-store' });
        if (!response.ok) return { aiPhotoEnabled: false };
        const parsed = PhotoConfigSchema.safeParse(await response.json());
        return parsed.success ? parsed.data : { aiPhotoEnabled: false };
      } catch {
        return { aiPhotoEnabled: false };
      }
    },

    prepare: (file) => prepareImage(file, codec),

    async analyse(image, signal): Promise<AnalyseResult> {
      const timeout = new AbortController();
      const timer = setTimeout(() => timeout.abort(), timeoutMs);
      const onCancel = () => timeout.abort();
      signal.addEventListener('abort', onCancel);
      try {
        const response = await fetch('/api/analyse-chips', {
          method: 'POST',
          headers: { 'content-type': 'image/jpeg' },
          body: image,
          signal: timeout.signal,
        });
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          const error = PhotoErrorSchema.safeParse(body);
          if (error.success) return { ok: false, reason: error.data.error };
          return { ok: false, reason: response.status === 429 ? 'rate_limited' : 'upstream' };
        }
        const parsed = PhotoAnalysisSchema.safeParse(body);
        return parsed.success
          ? { ok: true, analysis: parsed.data }
          : { ok: false, reason: 'invalid_response' };
      } catch (error) {
        if (signal.aborted) throw error;
        return { ok: false, reason: timeout.signal.aborted ? 'timeout' : 'network' };
      } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', onCancel);
      }
    },
  };
}

/** createImageBitmap applies EXIF orientation before the metadata is dropped. */
export const canvasCodec: Deps['codec'] = {
  decode: (file) => createImageBitmap(file, { imageOrientation: 'from-image' }),
  async encodeJpeg(image, width, height, quality) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('2d canvas unavailable');
    context.drawImage(image, 0, 0, width, height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('encode failed'))),
        'image/jpeg',
        quality,
      ),
    );
    return new Uint8Array(await blob.arrayBuffer());
  },
  release: (image) => image.close(),
};

export function createBrowserPhotoService(): PhotoService {
  return createPhotoService({ fetch: (...args) => fetch(...args), codec: canvasCodec });
}

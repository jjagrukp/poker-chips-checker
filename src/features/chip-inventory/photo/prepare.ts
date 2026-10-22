import { stripJpegMetadata } from './jpeg';
import { JPEG_QUALITY, MAX_EDGE_PX, MAX_RAW_BYTES, MAX_UPLOAD_BYTES } from './schema';

// Client-side photo preparation (spec 06 §1.3–4): type and size checks, then a canvas
// downscale + JPEG re-encode (drops the source's metadata), then an explicit strip of any
// EXIF/IPTC the encoder itself wrote, so no EXIF/GPS leaves the device. The codec is
// injected: the browser one lives in infrastructure, tests use a fake.

export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

export interface DecodedImage {
  width: number;
  height: number;
}

export interface ImageCodec<T extends DecodedImage = DecodedImage> {
  decode(file: Blob): Promise<T>;
  /** Draws `image` at width × height and returns the JPEG bytes. */
  encodeJpeg(image: T, width: number, height: number, quality: number): Promise<Uint8Array>;
  release?(image: T): void;
}

export type PrepareResult =
  | { ok: true; bytes: Uint8Array<ArrayBuffer>; width: number; height: number }
  | { ok: false; reason: 'unsupported_type' | 'too_large' | 'decode_failed' };

export function targetSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, MAX_EDGE_PX / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export async function prepareImage<T extends DecodedImage>(
  file: Blob,
  codec: ImageCodec<T>,
): Promise<PrepareResult> {
  if (!ACCEPTED_TYPES.includes(file.type.toLowerCase()))
    return { ok: false, reason: 'unsupported_type' };
  if (file.size > MAX_RAW_BYTES) return { ok: false, reason: 'too_large' };

  let image: T;
  try {
    image = await codec.decode(file);
  } catch {
    return { ok: false, reason: 'decode_failed' };
  }
  try {
    const size = targetSize(image.width, image.height);
    const encoded = await codec.encodeJpeg(image, size.width, size.height, JPEG_QUALITY);
    const bytes = stripJpegMetadata(encoded);
    if (!bytes) return { ok: false, reason: 'decode_failed' };
    if (bytes.length > MAX_UPLOAD_BYTES) return { ok: false, reason: 'too_large' };
    return { ok: true, bytes, ...size };
  } catch {
    return { ok: false, reason: 'decode_failed' };
  } finally {
    codec.release?.(image);
  }
}

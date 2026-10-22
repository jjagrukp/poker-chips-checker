import type { PrepareResult } from './prepare';
import type { PhotoAnalysis, PhotoConfig, PhotoErrorCode } from './schema';

// What the photo route needs from the outside world. The browser implementation is in
// infrastructure/ai-photo; tests inject fakes. No service → no photo route.

export type AnalyseFailure = PhotoErrorCode | 'network';

export type AnalyseResult =
  { ok: true; analysis: PhotoAnalysis } | { ok: false; reason: AnalyseFailure };

export interface PhotoService {
  /** Resolves `{ aiPhotoEnabled: false }` when the config endpoint is unreachable. */
  config(): Promise<PhotoConfig>;
  prepare(file: Blob): Promise<PrepareResult>;
  /** Rejects with an AbortError only when `signal` is aborted by the caller. */
  /** `image` is the prepared JPEG. */
  analyse(image: Uint8Array<ArrayBuffer>, signal: AbortSignal): Promise<AnalyseResult>;
}

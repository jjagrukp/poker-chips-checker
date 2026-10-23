import {
  MAX_PROPOSALS,
  MAX_REQUEST_BYTES,
  PHOTO_SCHEMA_VERSION,
  PhotoAnalysisSchema,
  type PhotoAnalysis,
  type PhotoErrorCode,
} from '../src/features/chip-inventory/photo/schema';
import type { RateLimiter } from './rate-limit';
import { providerFor, type ModelImage, type ProviderEnv, type VisionProvider } from './vision-providers';

// POST /api/analyse-chips (spec 06 §2): a standard Web Fetch handler, so it runs on any host.
// Steps: enabled → method/origin/content-type → size → magic bytes → rate limit → model call
// (provider from AI_PROVIDER, D34; one retry on 5xx/overload, 45 s overall) → Zod → response. No storage, and
// nothing about the image or model output is logged: only status, latency and error code.

export interface PhotoEnv extends ProviderEnv {
  AI_PHOTO_ENABLED?: string | undefined;
  RATE_LIMIT_PER_IP_PER_HOUR?: string | undefined;
  DAILY_REQUEST_CAP?: string | undefined;
  /** The app's origin for the CORS/origin check; defaults to the request's own origin. */
  APP_ORIGIN?: string | undefined;
}

export interface AnalyseDeps {
  fetch: typeof fetch;
  now: () => number;
  limiter: RateLimiter;
  /**
   * The caller's IP as the host knows it (e.g. the platform's connection info). Never read
   * from client-settable headers here: a spoofed header would reset the per-IP count.
   */
  clientIp: (request: Request) => string;
  log?: (entry: { status: number; latencyMs: number; code?: PhotoErrorCode }) => void;
  /** Overall model-call budget; tests shorten it. */
  timeoutMs?: number;
}

// Counting chip edges (D37) takes the model longer than naming colours (D39).
const TIMEOUT_MS = 45_000;

export function aiPhotoEnabled(env: PhotoEnv): boolean {
  const provider = providerFor(env);
  return env.AI_PHOTO_ENABLED === 'true' && Boolean(provider?.apiKey(env));
}

export function positiveIntOr(text: string | undefined, fallback: number): number {
  const n = Number(text);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export function rateLimitsFrom(env: PhotoEnv) {
  return {
    perIpPerHour: positiveIntOr(env.RATE_LIMIT_PER_IP_PER_HOUR, 10),
    dailyCap: positiveIntOr(env.DAILY_REQUEST_CAP, 500),
  };
}

const JSON_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' };

type MediaType = ModelImage['mediaType'];
const MEDIA_TYPES: readonly string[] = ['image/jpeg', 'image/png', 'image/webp'];

export function sniffImage(bytes: Uint8Array): MediaType | null {
  const at = (i: number, ...values: number[]) => values.every((v, j) => bytes[i + j] === v);
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
  return null;
}

/** Reads at most `limit` bytes; `null` when the body is larger. */
async function readLimited(request: Request, limit: number): Promise<Uint8Array | null> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

class Failure {
  constructor(
    readonly status: number,
    readonly code: PhotoErrorCode,
  ) {}
}

export async function handleAnalyseChips(
  request: Request,
  env: PhotoEnv,
  deps: AnalyseDeps,
): Promise<Response> {
  const started = deps.now();
  const finish = (status: number, body: unknown, code?: PhotoErrorCode) => {
    deps.log?.({ status, latencyMs: deps.now() - started, ...(code ? { code } : {}) });
    return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
  };
  try {
    const analysis = await analyse(request, env, deps);
    return finish(200, analysis);
  } catch (error) {
    if (error instanceof Failure) return finish(error.status, { error: error.code }, error.code);
    return finish(502, { error: 'upstream' }, 'upstream');
  }
}

async function analyse(request: Request, env: PhotoEnv, deps: AnalyseDeps): Promise<PhotoAnalysis> {
  const provider = providerFor(env);
  const apiKey = provider?.apiKey(env);
  if (env.AI_PHOTO_ENABLED !== 'true' || !provider || !apiKey) throw new Failure(503, 'disabled');
  if (request.method !== 'POST') throw new Failure(405, 'method');

  const origin = request.headers.get('origin');
  const allowed = env.APP_ORIGIN || new URL(request.url).origin;
  // Browsers always send Origin on a fetch POST; a missing one is a script, not the app.
  if (origin !== allowed) throw new Failure(403, 'origin');

  const contentType =
    request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
  if (!MEDIA_TYPES.includes(contentType)) throw new Failure(415, 'unsupported_type');

  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES)
    throw new Failure(413, 'too_large');
  const bytes = await readLimited(request, MAX_REQUEST_BYTES);
  if (!bytes) throw new Failure(413, 'too_large');

  const mediaType = sniffImage(bytes);
  if (!mediaType || mediaType !== contentType) throw new Failure(400, 'bad_image');

  const decision = await deps.limiter.take(deps.clientIp(request), deps.now());
  if (decision === 'ip') throw new Failure(429, 'rate_limited');
  if (decision === 'daily') throw new Failure(429, 'daily_cap');

  const { url, init } = provider.request(
    { base64: toBase64(bytes), mediaType },
    env.CHIP_VISION_MODEL || provider.defaultModel,
    apiKey,
  );
  return parseToolInput(await callModel(provider, url, init, deps));
}

/** Adds the version, trims to the proposal limit, then validates (AI output is untrusted). */
export function parseToolInput(input: unknown): PhotoAnalysis {
  if (typeof input !== 'object' || input === null) throw new Failure(502, 'invalid_response');
  const raw = input as Record<string, unknown>;
  const chipTypes = Array.isArray(raw.chipTypes)
    ? raw.chipTypes.slice(0, MAX_PROPOSALS)
    : raw.chipTypes;
  const parsed = PhotoAnalysisSchema.safeParse({
    ...raw,
    chipTypes,
    schemaVersion: PHOTO_SCHEMA_VERSION,
  });
  if (!parsed.success) throw new Failure(502, 'invalid_response');
  return parsed.data;
}

async function callModel(
  provider: VisionProvider,
  url: string,
  init: RequestInit,
  deps: AnalyseDeps,
): Promise<unknown> {
  const deadline = deps.now() + (deps.timeoutMs ?? TIMEOUT_MS);
  for (let attempt = 0; ; attempt++) {
    const reply = await post(url, init, deps, deadline);
    // 5xx covers overload on both providers (Anthropic 529, Gemini 503).
    if (reply.status >= 500 && attempt === 0) continue;
    if (reply.status < 200 || reply.status > 299) throw new Failure(502, 'upstream');
    const analysis = provider.analysis(reply.json);
    if (analysis === undefined) throw new Failure(502, 'invalid_response');
    return analysis;
  }
}

async function post(
  url: string,
  init: RequestInit,
  deps: AnalyseDeps,
  deadline: number,
): Promise<{ status: number; json: unknown }> {
  const remaining = deadline - deps.now();
  if (remaining <= 0) throw new Failure(504, 'timeout');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), remaining);
  try {
    const response = await deps.fetch(url, { ...init, method: 'POST', signal: controller.signal });
    // The body is read under the same deadline, so a stalled upstream still times out.
    const json: unknown = response.ok ? await response.json().catch(() => null) : null;
    if (controller.signal.aborted) throw new Failure(504, 'timeout');
    return { status: response.status, json };
  } catch (error) {
    if (error instanceof Failure) throw error;
    throw controller.signal.aborted ? new Failure(504, 'timeout') : new Failure(502, 'upstream');
  } finally {
    clearTimeout(timer);
  }
}

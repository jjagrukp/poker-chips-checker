// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  handleAnalyseChips,
  parseToolInput,
  sniffImage,
  type AnalyseDeps,
  type PhotoEnv,
} from './analyse-chips';
import { handleConfig } from './config';
import { createMemoryRateLimiter } from './rate-limit';

// Spec 06 §6: endpoint tests with a mocked model API. No real API calls.

const ENV: PhotoEnv = {
  ANTHROPIC_API_KEY: 'test-key',
  CHIP_VISION_MODEL: 'test-model',
  AI_PHOTO_ENABLED: 'true',
};
const ORIGIN = 'https://app.example';
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 1, 2, 3, 4]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);

const TOOL_INPUT = {
  status: 'ok',
  chipTypes: [
    {
      proposalId: 'c1',
      primaryColour: 'red',
      secondaryColours: ['white'],
      pattern: 'edge spots',
      printedValue: 25,
      estimatedCount: 20,
      countConfidence: 'high',
      notes: null,
    },
  ],
  imageIssues: [],
  message: null,
};

function modelReply(input: unknown = TOOL_INPUT, extra: Record<string, unknown> = {}) {
  return Response.json({
    content: [
      { type: 'text', text: 'Here you go.' },
      { type: 'tool_use', id: 't1', name: 'report_chips', input },
    ],
    stop_reason: 'tool_use',
    ...extra,
  });
}

function request(
  body: Uint8Array | null = JPEG,
  headers: Record<string, string> = {},
  method = 'POST',
) {
  return new Request(`${ORIGIN}/api/analyse-chips`, {
    method,
    headers: {
      'content-type': 'image/jpeg',
      origin: ORIGIN,
      'x-test-ip': '1.2.3.4',
      ...headers,
    },
    ...(method === 'POST' ? { body } : {}),
  });
}

function deps(
  fetchImpl: (input: Parameters<typeof fetch>[0], init?: RequestInit) => Promise<Response>,
  over: Partial<AnalyseDeps> = {},
) {
  const log = vi.fn();
  const fetchMock = vi.fn(fetchImpl);
  return {
    log,
    fetchMock,
    deps: {
      fetch: fetchMock as unknown as typeof fetch,
      now: () => 1_000_000,
      limiter: createMemoryRateLimiter({ perIpPerHour: 10, dailyCap: 500 }),
      // Stands in for the host's trusted connection IP.
      clientIp: (req: Request) => req.headers.get('x-test-ip') ?? 'unknown',
      log,
      ...over,
    } satisfies AnalyseDeps,
  };
}

async function run(req: Request, d: AnalyseDeps, env: PhotoEnv = ENV) {
  const response = await handleAnalyseChips(req, env, d);
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe('handleAnalyseChips', () => {
  it('returns validated proposals on the happy path', async () => {
    const { deps: d, fetchMock, log } = deps(async () => modelReply());
    const { status, body } = await run(request(), d);
    expect(status).toBe(200);
    expect(body).toMatchObject({
      schemaVersion: 1,
      status: 'ok',
      chipTypes: [{ primaryColour: 'red' }],
    });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe('https://api.anthropic.com/v1/messages');
    const sent = JSON.parse(String(init?.body));
    expect(sent.model).toBe('test-model');
    expect(sent.tools[0]).toMatchObject({ name: 'report_chips', strict: true });
    expect(sent.messages[0].content[0].source).toMatchObject({
      type: 'base64',
      media_type: 'image/jpeg',
    });
    expect(new Headers(init?.headers).get('x-api-key')).toBe('test-key');

    // Only status, latency and code are logged: never the image or model output.
    expect(log).toHaveBeenCalledWith({ status: 200, latencyMs: 0 });
  });

  it('treats a non-JSON model reply as an invalid response', async () => {
    const { deps: d } = deps(async () => new Response('not json', { status: 200 }));
    expect(await run(request(), d)).toEqual({ status: 502, body: { error: 'invalid_response' } });
  });

  it('rejects model output that fails the schema', async () => {
    const { deps: d } = deps(async () =>
      modelReply({
        ...TOOL_INPUT,
        chipTypes: [{ ...TOOL_INPUT.chipTypes[0], estimatedCount: -3 }],
      }),
    );
    expect(await run(request(), d)).toEqual({ status: 502, body: { error: 'invalid_response' } });
  });

  it('rejects a reply without the tool call, or a refusal', async () => {
    const noTool = deps(async () => Response.json({ content: [{ type: 'text', text: 'hi' }] }));
    expect((await run(request(), noTool.deps)).body).toEqual({ error: 'invalid_response' });
    const refusal = deps(async () => modelReply(TOOL_INPUT, { stop_reason: 'refusal' }));
    expect((await run(request(), refusal.deps)).body).toEqual({ error: 'invalid_response' });
  });

  it('times out when the model call outlasts the budget', async () => {
    const { deps: d } = deps(
      (_url, init) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          ),
        ),
      { timeoutMs: 20 },
    );
    expect(await run(request(), d)).toEqual({ status: 504, body: { error: 'timeout' } });
  });

  it('retries once on overload, then succeeds', async () => {
    let calls = 0;
    const { deps: d, fetchMock } = deps(async () =>
      ++calls === 1 ? new Response('{}', { status: 529 }) : modelReply(),
    );
    expect((await run(request(), d)).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up after one retry on 5xx, and does not retry 4xx', async () => {
    const server = deps(async () => new Response('{}', { status: 500 }));
    expect(await run(request(), server.deps)).toEqual({ status: 502, body: { error: 'upstream' } });
    expect(server.fetchMock).toHaveBeenCalledTimes(2);
    const client = deps(async () => new Response('{}', { status: 400 }));
    expect((await run(request(), client.deps)).body).toEqual({ error: 'upstream' });
    expect(client.fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rate-limits per IP and fails closed at the daily cap', async () => {
    const perIp = deps(async () => modelReply(), {
      limiter: createMemoryRateLimiter({ perIpPerHour: 2, dailyCap: 100 }),
    });
    expect((await run(request(), perIp.deps)).status).toBe(200);
    expect((await run(request(), perIp.deps)).status).toBe(200);
    expect(await run(request(), perIp.deps)).toEqual({
      status: 429,
      body: { error: 'rate_limited' },
    });
    // Client-set forwarding headers don't reset the count; a different host IP is allowed.
    expect((await run(request(JPEG, { 'x-forwarded-for': '7.7.7.7' }), perIp.deps)).status).toBe(
      429,
    );
    expect((await run(request(JPEG, { 'x-test-ip': '5.6.7.8' }), perIp.deps)).status).toBe(200);

    const daily = deps(async () => modelReply(), {
      limiter: createMemoryRateLimiter({ perIpPerHour: 10, dailyCap: 1 }),
    });
    expect((await run(request(), daily.deps)).status).toBe(200);
    expect(await run(request(JPEG, { 'x-test-ip': '9.9.9.9' }), daily.deps)).toEqual({
      status: 429,
      body: { error: 'daily_cap' },
    });
    expect(daily.fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects oversized uploads, declared or streamed', async () => {
    const big = new Uint8Array(2 * 1024 * 1024 + 1);
    big.set(JPEG);
    const { deps: d, fetchMock } = deps(async () => modelReply());
    expect(await run(request(big), d)).toEqual({ status: 413, body: { error: 'too_large' } });
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(big);
        controller.close();
      },
    });
    const streamed = new Request(`${ORIGIN}/api/analyse-chips`, {
      method: 'POST',
      headers: { 'content-type': 'image/jpeg', origin: ORIGIN },
      body: stream,
      duplex: 'half',
    } as RequestInit);
    expect(await run(streamed, d)).toEqual({ status: 413, body: { error: 'too_large' } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects wrong magic bytes and mismatched content types', async () => {
    const { deps: d, fetchMock } = deps(async () => modelReply());
    const text = new TextEncoder().encode('<svg>not an image</svg>');
    expect(await run(request(text), d)).toEqual({ status: 400, body: { error: 'bad_image' } });
    expect((await run(request(PNG), d)).body).toEqual({ error: 'bad_image' });
    expect((await run(request(PNG, { 'content-type': 'image/png' }), d)).status).toBe(200);
    expect((await run(request(JPEG, { 'content-type': 'image/svg+xml' }), d)).body).toEqual({
      error: 'unsupported_type',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('checks method, origin and the feature flag before anything else', async () => {
    const { deps: d, fetchMock } = deps(async () => modelReply());
    expect((await run(request(null, {}, 'GET'), d)).status).toBe(405);
    expect((await run(request(JPEG, { origin: '' }), d)).status).toBe(403);
    expect(await run(request(JPEG, { origin: 'https://evil.example' }), d)).toEqual({
      status: 403,
      body: { error: 'origin' },
    });
    expect((await run(request(), d, { ...ENV, AI_PHOTO_ENABLED: 'false' })).body).toEqual({
      error: 'disabled',
    });
    expect((await run(request(), d, { ...ENV, ANTHROPIC_API_KEY: '' })).status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('parseToolInput', () => {
  it('trims to 12 proposals before validating', () => {
    const many = Array.from({ length: 15 }, (_, i) => ({
      ...TOOL_INPUT.chipTypes[0],
      proposalId: `c${i}`,
    }));
    expect(parseToolInput({ ...TOOL_INPUT, chipTypes: many }).chipTypes).toHaveLength(12);
  });
});

describe('sniffImage', () => {
  it('recognises JPEG, PNG and WebP only', () => {
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    expect(sniffImage(JPEG)).toBe('image/jpeg');
    expect(sniffImage(PNG)).toBe('image/png');
    expect(sniffImage(webp)).toBe('image/webp');
    expect(sniffImage(new Uint8Array([0x47, 0x49, 0x46, 0x38]))).toBeNull();
  });
});

describe('handleConfig', () => {
  it('reports the feature flag', async () => {
    const get = new Request(`${ORIGIN}/api/config`);
    expect(await handleConfig(get, ENV).json()).toEqual({ aiPhotoEnabled: true });
    expect(await handleConfig(get, { ...ENV, AI_PHOTO_ENABLED: undefined }).json()).toEqual({
      aiPhotoEnabled: false,
    });
  });
});

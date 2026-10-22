import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin, PreviewServer, ViteDevServer } from 'vite';
import { MAX_REQUEST_BYTES } from '../src/features/chip-inventory/photo/schema';
import { handleAnalyseChips, rateLimitsFrom, type PhotoEnv } from './analyse-chips';
import { handleConfig } from './config';
import { createMemoryRateLimiter } from './rate-limit';

// `npm run dev` / `vite preview` only: serves /api/* through the same Web Fetch handlers the host runs.

async function toRequest(req: IncomingMessage, origin: string): Promise<Request> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
    size += (chunk as Buffer).length;
    // Past the limit: stop buffering. What's kept is still over it, so the handler says 413.
    if (size > MAX_REQUEST_BYTES) break;
  }
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers.set(key, value);
  }
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  return new Request(new URL(req.url ?? '/', origin), {
    method: req.method ?? 'GET',
    headers,
    ...(hasBody ? { body: Buffer.concat(chunks) } : {}),
  });
}

async function send(res: ServerResponse, response: Response) {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.end(Buffer.from(await response.arrayBuffer()));
}

export function devApi(env: PhotoEnv): Plugin {
  const limiter = createMemoryRateLimiter(rateLimitsFrom(env));
  const mount = (server: ViteDevServer | PreviewServer) => {
    server.middlewares.use((req, res, next) => {
      const path = req.url?.split('?')[0];
      if (path !== '/api/config' && path !== '/api/analyse-chips') return next();
      const origin = `http://${req.headers.host ?? 'localhost'}`;
      void toRequest(req, origin)
        .then((request) =>
          path === '/api/config'
            ? handleConfig(request, env)
            : handleAnalyseChips(request, env, {
                fetch,
                now: () => Date.now(),
                limiter,
                clientIp: () => req.socket.remoteAddress ?? 'unknown',
                log: (entry) => server.config.logger.info(`analyse-chips ${JSON.stringify(entry)}`),
              }),
        )
        .then((response) => send(res, response))
        .catch(next);
    });
  };
  return { name: 'dev-api', configureServer: mount, configurePreviewServer: mount };
}

import { aiPhotoEnabled, type PhotoEnv } from './analyse-chips';

// GET /api/config (spec 06 §2): the client hides the photo route unless this says it's on.

export function handleConfig(request: Request, env: PhotoEnv): Response {
  if (request.method !== 'GET') return new Response(null, { status: 405 });
  return new Response(JSON.stringify({ aiPhotoEnabled: aiPhotoEnabled(env) }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

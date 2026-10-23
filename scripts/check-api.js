// Release check against a deployed site (spec 07 §4): security headers, CORS/origin refusal and
// a burst test of the per-IP limit. Up to `limit` burst requests reach the model (a 1×1 PNG), so
// it costs a few cents. Usage: node scripts/check-api.js https://your-site [burst=15] [limit=10]
const [site, burstArg = '15', limitArg = '10'] = process.argv.slice(2);
if (!site) {
  console.error('Usage: node scripts/check-api.js https://your-site [burst=15] [limit=10]');
  process.exit(2);
}
const origin = new URL(site).origin;
const burst = Number(burstArg);
const limit = Number(limitArg);
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);
const failures = [];
const check = (ok, message) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${message}`);
  if (!ok) failures.push(message);
};

const analyse = (from) =>
  fetch(`${origin}/api/analyse-chips`, {
    method: 'POST',
    headers: { origin: from, 'content-type': 'image/png' },
    body: PNG,
  });

const config = await fetch(`${origin}/api/config`);
const body = await config.json().catch(() => null);
check(config.status === 200 && body?.aiPhotoEnabled === true, '/api/config says AI photo is on');
check(config.headers.get('x-content-type-options') === 'nosniff', '/api/* sends nosniff');
check(config.headers.has('strict-transport-security'), '/api/* sends HSTS');

const page = await fetch(origin);
check(page.headers.has('content-security-policy'), 'pages send a CSP');
check(page.headers.has('strict-transport-security'), 'pages send HSTS');

const foreign = await analyse('https://evil.example');
check(foreign.status === 403, `a foreign Origin is refused (got ${foreign.status})`);
check(!foreign.headers.has('access-control-allow-origin'), 'no Access-Control-Allow-Origin');
const preflight = await fetch(`${origin}/api/analyse-chips`, {
  method: 'OPTIONS',
  headers: {
    origin: 'https://evil.example',
    'access-control-request-method': 'POST',
    'access-control-request-headers': 'content-type',
  },
});
check(!preflight.headers.has('access-control-allow-origin'), 'preflight grants no CORS');

const missing = await fetch(`${origin}/api/nope`);
check(missing.status === 404, `unknown /api path is a 404 (got ${missing.status})`);

const replies = await Promise.all(
  Array.from({ length: burst }, () =>
    analyse(origin).then(
      async (r) => `${r.status} ${(await r.json().catch(() => ({}))).error ?? 'ok'}`,
    ),
  ),
);
const tally = {};
for (const reply of replies) tally[reply] = (tally[reply] ?? 0) + 1;
console.log(`      burst of ${burst}: ${JSON.stringify(tally)}`);
const limited = replies.filter((r) => r === '429 rate_limited').length;
// Earlier runs in the same hour count too, so at most `limit` get through, never more.
check(burst - limited <= limit, `at most ${limit} of ${burst} passed the per-IP limit`);
if (burst > limit) check(limited > 0, `${limited} refused with 429 rate_limited`);
// A 1×1 PNG usually comes back 200 `not_chips`; no 200 at all means the model call is failing.
if (!replies.some((r) => r.startsWith('200 '))) console.log('WARN  no burst request got a 200');

if (failures.length > 0) process.exit(1);

// Response headers for every static page (D33). One source: the build writes them to `_headers`
// (Cloudflare Pages format) and `vite preview` sends them, so e2e runs under the same CSP.

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' blob: data:",
    "connect-src 'self'",
    "font-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

/** HTTPS only, hosted builds only (`vite preview` is plain HTTP). No includeSubDomains: the app may share a domain. */
export const HSTS = 'max-age=31536000';

/** Function responses (D33, D35): `_headers` doesn't reach them, so the host adapter adds these. */
export const API_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Strict-Transport-Security': HSTS,
};

/** Cloudflare Pages `_headers`: security headers everywhere; the service worker is never cached. */
export function headersFile(): string {
  const lines = Object.entries({ ...SECURITY_HEADERS, 'Strict-Transport-Security': HSTS }).map(
    ([name, value]) => `  ${name}: ${value}`,
  );
  return ['/*', ...lines, '', '/sw.js', '  Cache-Control: no-cache', ''].join('\n');
}

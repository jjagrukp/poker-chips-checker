# Deploy (Cloudflare Pages)

Static build in `dist` plus Pages Functions in `functions/api/*` (D7, D35). Rate-limit counters
live in a D1 database. Wrangler runs through `npx`; nothing to install.

## First deploy

1. `npx wrangler login`
2. `npx wrangler d1 create tournament-rate-limits`, then paste the printed `database_id`
   into `wrangler.toml`.
3. `npx wrangler d1 migrations apply tournament-rate-limits --remote`
4. `npx wrangler pages project create tournament-platform --production-branch main`
5. Choose the provider in `wrangler.toml` (`AI_PROVIDER = "anthropic"` or `"gemini"`), then set
   its key as a secret. Never put keys in `wrangler.toml` or in any `VITE_` variable.
   - `npx wrangler pages secret put ANTHROPIC_API_KEY`
   - `npx wrangler pages secret put GEMINI_API_KEY` (paid, billing-enabled key only; D34)
6. `npm run build && npx wrangler pages deploy`
   (`postbuild` fails the build if a key or key name shows up in `dist`).
7. Set a monthly spend limit in the provider's console. `DAILY_REQUEST_CAP` is the app's own cap.

Git-connected builds work too: build command `npm run build`, output `dist`, env `NODE_VERSION=22`.
The `wrangler.toml` vars and D1 binding still apply; set the secret in the dashboard.

## Environment

| Name | Where | Default |
|------|-------|---------|
| `AI_PHOTO_ENABLED` | `wrangler.toml` vars | `"true"`; `"false"` hides the photo option |
| `AI_PROVIDER` | vars | `anthropic`; unknown value turns AI off |
| `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` | secret | none; no key turns AI off |
| `CHIP_VISION_MODEL` | vars (optional) | `claude-haiku-5-5` / `gemini-3.8-flash` |
| `RATE_LIMIT_PER_IP_PER_HOUR` | vars | 10 |
| `DAILY_REQUEST_CAP` | vars | 500 |
| `APP_ORIGIN` | vars (optional) | the request's own origin. Leave unset, or preview URLs fail the origin check |
| `RATE_LIMIT_DB` | D1 binding | required; without it AI is reported off |

## Release checks (spec 07 §4)

- Secrets: `npm run build` runs `scripts/check-bundle-secrets.js` on `dist`.
- Live checks: `npm run check:api -- https://<project>.pages.dev` checks `/api/config`, security
  headers and HSTS on pages and `/api/*`, refusal of a foreign Origin (403, no CORS headers, preflight
  grants nothing), the JSON 404, and a 15-request burst where at most 10 get through and the rest are
  `429 rate_limited`. Up to 10 of those reach the model (a 1×1 PNG, a few cents), and they use up this
  IP's hour, so run it before game night, not during it.
- Limitations page: open `/limitations` on the live site.
- Game night: `docs/TEST-NIGHT.md`.

## Running Functions locally

`npm run dev` serves `/api/*` through the same handlers with an in-memory limiter. To run the real
Pages adapter and a local D1: put keys in `.dev.vars` (git-ignored), then
`npx wrangler d1 migrations apply tournament-rate-limits --local && npm run build && npx wrangler pages dev`.

## Turning AI off

Set `AI_PHOTO_ENABLED = "false"` and redeploy, or delete the secret. The app hides the photo option
and manual entry carries on.

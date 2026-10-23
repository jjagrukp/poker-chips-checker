# 08 — Screen share (phone as remote, TV as display)

Opt-in relay so a TV/laptop shows the live clock while the host controls it from a phone (D42).
The phone stays the source of truth (IndexedDB); the relay only holds the latest snapshot.

## 1. Flow
1. Live clock (controller only) → "Show on a TV". The app makes a share: an 8-character code
   (Crockford-style alphabet, no 0/O/1/I/L/U) and a 128-bit write key. Both are kept on this device
   (localStorage, Zod-parsed, `schemaVersion`), per tournament.
2. The panel shows the link `<origin>/screen/<CODE>`, the code formatted `ABCD-EFGH`, Copy and
   Share (Web Share API when present), status (live / sending / offline), and "Stop sharing".
3. Every committed clock change (command, edit, players, end, alert bookkeeping) pushes a snapshot.
   Pushes are latest-wins and retried with backoff (2 s doubling to 30 s) while offline.
4. TV: `/screen` asks for the code (big input, works with a TV remote); `/screen/:code` polls
   `GET /api/screens/:code` every 2 s and renders the clock in screen mode: no controls, no home
   link, large layout, wake lock on, alerts shown and sounded (after one press to unlock audio).
5. Offline TV keeps counting from the last snapshot and shows "Reconnecting…" after 3 failed polls.
   Unknown/expired code → "This screen link has ended". Finished tournament → finished message.
6. Stop sharing deletes the snapshot; the TV shows the ended message on its next poll.

## 2. Snapshot `{ schemaVersion: 1, tournament, schedule, sentAt }`
`tournament` and `schedule` are the persisted records (Zod-parsed with their own schemas on both
sides); `sentAt` is the phone's clock at send. Max 64 KB. No photos or inventory are sent.

## 3. Time
The TV maps its clock into the phone's: `phoneNow ≈ tvNow + (serverNow − tvReceivedAt) −
(receivedAt − sentAt)`, where `serverNow` comes with each GET and `receivedAt` is the server's clock
when it stored the snapshot. Error ≈ network latency (sub-second).

## 4. Endpoint `api/screens.ts` — `/api/screens/:code`
- `GET` → `200 { snapshot, receivedAt, serverNow }` or `404 { error: 'not_found' }`. No origin check
  (read-only). `cache-control: no-store`.
- `PUT` (header `x-screen-key`) → stores the snapshot. First write claims the code; later writes
  must carry the same key (stored as SHA-256), else `409 { error: 'taken' }`. Origin must match.
  Body ≤ 64 KB JSON; the relay Zod-checks the envelope (`wire.ts`, no `@/` imports so it bundles
  for Functions), and the TV parses the full Tournament/Schedule schemas on read. Per-IP limit
  1200 writes/hour → `429`.
- `DELETE` (same key) → removes it. `204`.
- Records expire 24 h after the last write; expired rows are pruned on writes.
- Storage: D1 table `screens` (`migrations/0002_screens.sql`); in-memory store in dev/preview.

## 5. Tests
Handler (claim, update, wrong key, size, bad code, origin, expiry, delete, rate limit), snapshot
schema, share storage, pusher (coalescing, backoff, status), clock-store `onSaved` hook, screen page
(renders clock, offset maths, not found, reconnecting), e2e: phone shares → second page shows timer.

# 02 — Architecture, domain model, persistence

## 1. Shape
Modular monolith, one repo, one deploy (static app + one serverless function).

```
src/
  app/            routes, layouts, configuration/ (brand.ts, features.ts)
  core/           tournaments/ participants/ scheduling/ timer/ events/ alerts/
                  persistence/ (interfaces only) validation/ modules/ (registry + contract)
  modules/games/texas-holdem/   manifest, config, duration-model, blind-ladder,
                  schedule-generator, schedule-validator, edits, display, tests/
  features/       tournament-setup/ chip-inventory/ (domain/ + ui/) chip-photo/
                  live-clock/ results/ presets/ settings/
  infrastructure/ indexeddb/ (repository implementations) audio/ wake-lock/ tab-lock/
  shared/         components/ messages/ utilities/ accessibility/
api/              analyse-chips.ts (serverless, Web Fetch handler)
tests/            e2e/ fixtures/   (unit tests colocated as *.test.ts)
```
Create folders only when something goes in them.

## 2. Boundaries (ESLint-enforced)
- `core` imports nothing from `modules`, `features`, `infrastructure`, `app`.
- `features/chip-inventory/domain` imports only `core` + `shared/utilities`.
- `modules/*` may import `core` and `features/chip-inventory/domain` (chip allocation).
- Modules are registered in `src/app/configuration/modules.ts` (composition root).

## 3. Core types (sketch — refine in M1, keep names)
```ts
type EpochMs = number; type Ms = number;
interface Clock { now(): EpochMs }

interface Segment {
  id: string;                     // stable, used for alert dedupe
  kind: 'level' | 'break';
  durationMs: Ms;
  levelNumber?: number;           // 'level' only, 1-based
  display: { title: string; lines: { label: string; value: string }[] }; // module-rendered
  data: unknown;                  // module-owned payload (e.g. blinds), opaque to core
  estimatedFinish?: boolean;      // module marks the projected finishing level
}

interface Schedule {
  id: string; moduleId: string; moduleVersion: string; generatorVersion: string;
  segments: Segment[]; createdAt: EpochMs; schemaVersion: number;
}

interface Tournament {
  id: string; schemaVersion: number; name?: string;
  moduleId: string; moduleVersion: string;
  status: 'draft' | 'ready' | 'active' | 'completed' | 'cancelled';
  config: unknown;                // module config, validated by module
  scheduleId?: string; inventoryId?: string; allocation?: AllocationResult;
  participants: { count: number; remaining: number; names?: string[] };
  clock?: ClockAnchor; settings: TournamentSettings;
  results?: TournamentResults;
  createdAt: EpochMs; updatedAt: EpochMs; startedAt?: EpochMs; endedAt?: EpochMs;
}
```
`ClockAnchor`, `deriveClock`, interludes: see 03.

## 4. Game module contract
```ts
interface GameModule<C> {
  id: string; version: string; displayName: string; description: string;
  formats: string[];                        // 'freezeout'
  playerRange: { min: number; max: number };
  configSchema: ZodType<C>;
  defaults(input: { players: number; targetDurationMin: number }): C;
  validateConfig(c: C, ctx: ModuleContext): ValidationReport;  // errors block, warnings inform
  generateSchedule(c: C, ctx: ModuleContext): { schedule: Schedule; report: ValidationReport };
  validateSchedule(s: Schedule, c: C, ctx: ModuleContext): ValidationReport;
  regenerateFrom?(s: Schedule, fromIndex: number, c: C, ctx: ModuleContext): Schedule;
  allocate?(c: C, inventory: ConfirmedInventory): AllocationResult; // optional
  liveExtras?(c: C, segment: Segment, t: Tournament): DisplayLine[]; // e.g. avg stack in BB
  migrateConfig?(raw: unknown, fromVersion: string): C;
}
interface ValidationReport { errors: Issue[]; warnings: Issue[] }
interface Issue { code: string; messageKey: string; params?: Record<string, unknown>; path?: string }
```
Issue messages are message-catalogue keys, so modules stay UI-free and translatable.

**Extensibility test (M1):** `tests/fixtures/mock-rounds-module.ts` — timed rounds, points
per round, no blinds. Must register, validate, generate, run through `deriveClock`, persist
(M2) and recover, with zero imports from `modules/games/texas-holdem`. Never shown in the UI.

## 5. Lifecycle (single service: `core/tournaments/lifecycle.ts`)
Transitions: draft→ready (config valid + schedule generated + allocation valid);
ready→draft (edit); ready→active (start); active→completed; draft|ready|active→cancelled.
Anything else throws `InvalidTransition`. Clock commands are only valid in `active`.
Every transition appends an event.

## 6. Results
On completion: finishing positions (optional names), winner, actual duration (derived from
events, editable), final schedule snapshot (already persisted), then actions: save as preset,
duplicate tournament, new tournament with same inventory. Payouts are future.

## 7. Persistence
### 7.1 Repositories (interfaces in core, IndexedDB impl in infrastructure)
`TournamentRepo`, `ScheduleRepo`, `EventRepo` (append + list by tournament),
`InventoryRepo`, `PresetRepo`, `SettingsRepo`. All async, all return Zod-parsed data.
A future cloud implementation replaces infrastructure only.

### 7.2 Stores
`tournaments`, `schedules`, `events` (index: tournamentId+seq), `inventories`, `presets`,
`settings`, `quarantine`, `meta` (db schema version).

### 7.3 Versioning
Every record has `schemaVersion`. Migration functions `vN → vN+1` per record type, run on
read (lazy) and written back. Schedules are snapshots: loading never regenerates from
newer presets. Presets have their own versions; a tournament stores the preset version it used.

### 7.4 Corruption
Parse failure → move raw record to `quarantine` with error, continue loading others, show
a non-blocking notice with "export quarantined data" and "delete". Never crash the app.

### 7.5 Write policy
Write on every lifecycle transition, clock command, participants change and wizard step.
Never per tick. Writes are serialised per tournament (simple promise queue).

### 7.6 Durability honesty
- Call `navigator.storage.persist()` on first tournament start; show result in Settings.
- One-time notice: data lives only in this browser; clearing site data, private browsing,
  or switching browser/device loses it; Safari may delete data from sites not visited for
  7 days unless installed to the Home Screen. Offer "Install app" and "Export backup".
- Export/import: single JSON file (all stores except quarantine, or one tournament),
  validated with Zod on import, IDs preserved, conflict = keep both (new IDs).

### 7.7 Multi-tab
Use the Web Locks API (`navigator.locks`) lock `tournament:<id>:controller`. The holder is
the controller; other tabs open the same tournament in read-only **viewer** mode (useful
for a second screen) and receive updates via `BroadcastChannel`. Viewer shows "Take control".
Fallback when Web Locks is missing: last-writer-wins + `revision` check on anchor writes.

# Phase 2 — Activity Capture + Offline Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the one flow that cannot fail — offline-capable activity capture behind the D55 interfaces, with an outbox that replays exactly-once, LWW stale-write rejection into a first-class error tray, and the D45 minimal capture UI.

**Architecture:** Next.js (App Router, TS) PWA with Serwist service worker; offline layer = `LocalStore`/`SyncEngine`/`BlobStore`/`PushChannel` interfaces (D55) with Dexie/IndexedDB implementations; sync talks to Supabase **directly** via supabase-js (D3/D62), never through Vercel routes. Custom access token hook injects the `org_id` claim (D18/D23); org switch = RPC + session refresh + local wipe (D60).

**Tech Stack:** Next.js 15 + React 19 + TypeScript, Tailwind CSS v4, Serwist, Dexie, @supabase/supabase-js + @supabase/ssr, Zod, Vitest + fake-indexeddb.

## Global Constraints (from D45–D62 / brief §2)

- No feature code imports IndexedDB/Dexie outside the `LocalStore`/`BlobStore` implementations (D55) — **enforced by ESLint `no-restricted-imports`**.
- Client-generated UUIDs are the record `id`; replay = upsert-ignore-duplicates on PK (D57).
- Scalar edits carry `base_version` (server `updated_at`); update filters `eq(updated_at, base_version)`; 0 rows ⇒ `rejected` ⇒ error tray — never clobber, never drop (D61/D62).
- Sync triggers: foreground / `online` / manual / foreground interval — **no Background Sync API** (D58). Always-visible "N unsynced" state.
- Signed upload URLs minted at **sync time**; blob purged after confirmed upload (D59).
- Wipe local DB on logout **and org switch**; no email bodies/attachments cached (D60).
- Default capture = **one note + follow-up flag** (D45); full form optional.
- TypeScript end-to-end; DB types via `supabase gen types`; Zod at the outbox boundary.

## File structure

```
supabase/migrations/20260722001400_auth_hook.sql   org_id claim hook + set_active_org RPC
supabase/tests/06_auth_hook.test.sql               hook claim/validation tests
src/lib/database.types.ts                          generated (supabase gen types --local)
src/lib/domain/enums.ts                            activity types, objectives, lead sources
src/lib/domain/schemas.ts                          Zod: ActivityCreate, NextActionCreate,
                                                   NextActionUpdate, OutboxRecord
src/lib/offline/types.ts                           LocalStore, SyncEngine, BlobStore,
                                                   PushChannel, SyncBackend interfaces
src/lib/offline/local-store.dexie.ts               Dexie impl (ONLY dexie import site #1)
src/lib/offline/blob-store.dexie.ts                (dexie import site #2)
src/lib/offline/sync-engine.ts                     drain/pull/single-flight/backoff
src/lib/offline/supabase-backend.ts                SyncBackend over supabase-js
src/lib/offline/push-channel.web.ts                no-op Web Push stub (interface holder)
src/lib/offline/index.ts                           wiring/factory + wipeLocalData()
src/lib/supabase/{client,server,middleware}.ts     @supabase/ssr plumbing
src/app/{layout,page}.tsx                          Home: quick actions, sync badge, tray link
src/app/login/page.tsx                             email/password (dev) + Google button
src/app/capture/page.tsx                           D45 capture (note + flag; optional fields)
src/app/tray/page.tsx                              error tray (first-class surface)
src/app/manifest.ts + src/app/sw.ts                PWA manifest + Serwist SW
src/lib/offline/__tests__/*.test.ts                Vitest: gate tests
.github/workflows/db-tests.yml                     + app-tests job (vitest)
```

## Key contracts

```ts
type OutboxStatus = 'pending' | 'syncing' | 'synced' | 'rejected'
interface OutboxRecord {
  clientId: string       // == payload.id (client-minted UUID, D57)
  entityType: 'activity' | 'next_action' | 'activity_account' | 'activity_contact'
  op: 'create' | 'update'
  payload: Record<string, unknown>
  baseVersion: string | null   // server updated_at at read time (updates only)
  blobRef: string | null
  status: OutboxStatus
  attempts: number
  lastError: string | null
  createdAt: string
}
interface SyncBackend {
  upsertIgnoreDuplicates(table: string, row: object): Promise<void>          // throws on network
  updateWithVersion(table: string, id: string, patch: object,
                    baseVersion: string): Promise<number>                    // affected rows
  createSignedUploadUrl(bucket: string, path: string): Promise<{url: string, token: string}>
  uploadToSignedUrl(bucket: string, path: string, token: string, blob: Blob): Promise<void>
  pullWorkingSet(): Promise<WorkingSet>                                      // D56 scope
}
interface SyncEngine {
  enqueue(rec: Omit<OutboxRecord,'status'|'attempts'|'lastError'|'createdAt'>): Promise<void>
  drain(): Promise<void>        // single-flight; FIFO over pending
  pull(): Promise<void>
  start(): void                 // wires foreground/online/interval triggers (D58)
  stop(): void
  status$: (cb: (s: {pending: number; rejected: number}) => void) => () => void
}
```

Rejection classification in `drain()`: HTTP 401/403 or PostgREST RLS error, or
`updateWithVersion` returning 0 ⇒ `rejected` (tray). Network/5xx ⇒ keep
`pending`, exponential backoff. 23505 on create ⇒ already synced ⇒ `synced`.

## Tasks

### Task 1: Auth hook migration + tests
`custom_access_token_hook(event jsonb)` — security definer, adds `org_id` claim
from `users.last_active_org_id` validated against an **active membership**
(fallback: earliest active membership). `set_active_org(uuid)` RPC (validates
membership, updates `last_active_org_id`). Grants: hook → `supabase_auth_admin`
only; RPC → authenticated. config.toml `[auth.hook.custom_access_token]`.
Seed: give test users real passwords (`extensions.crypt`). pgTAP suite 06.
- [ ] Migration + config + seed update; `db reset`; suite 06 green; commit.

### Task 2: App scaffold
Next.js 15 App Router hand-scaffold (package.json deps, tsconfig, Tailwind v4,
ESLint flat config with the dexie import ban, Serwist SW + manifest), @supabase/ssr
client/server/middleware, generated DB types, domain enums + Zod schemas.
- [ ] `npm run build` passes; `supabase gen types` checked in; commit.

### Task 3: Offline core — LocalStore + BlobStore (Dexie) with Vitest + fake-indexeddb
Object stores: read models (accounts, contacts, agenda, activities,
opportunities, relationships, meta) + outbox + blobs (D57). `wipe()` for
logout/org-switch (D60).
- [ ] Unit tests: enqueue persists; wipe clears all stores; commit.

### Task 4: SyncEngine (the gate lives here)
Drain semantics per contract; pull working set into read models; trigger
wiring (visibilitychange/online/interval); status$ for the "N unsynced" badge.
InMemory SyncBackend test double.
- [ ] **Gate test 1 — offline capture exactly-once:** enqueue while backend
      offline → drain fails, stays pending → backend online → drain → exactly
      one row in backend, record `synced`.
- [ ] **Gate test 2 — double-fired sync:** two concurrent `drain()` + a second
      sequential drain after reset → backend row count still 1 (single-flight
      + upsert-ignore-duplicates + 23505⇒synced).
- [ ] **Gate test 3 — stale edit to tray:** update with old `baseVersion` →
      `updateWithVersion` returns 0 → status `rejected`, surfaces in tray
      query, never retried, original payload preserved.
- [ ] Blob drain: signed URL minted at drain time (D59), blob purged after
      confirmed upload; RLS rejection at replay ⇒ `rejected` (D62).
- [ ] Commit.

### Task 5: Auth + org context in the app
Login page (password for dev; Google button behind provider check), middleware
session refresh, org switcher calling `set_active_org` + `refreshSession()` +
`wipeLocalData()`; logout wipes too (D60).
- [ ] Manual smoke against local stack (seeded users); commit.

### Task 6: Capture UI + Home + error tray
Home: Register Activity (primary), unsynced badge (always visible, D58), tray
entry. Capture: account picker (cached working set), note, follow-up flag —
submit = enqueue + optimistic local write; "More detail" disclosure for full
form (type, objective, outcomes, opportunity link). Tray: rejected records
with reason, discard / retry-against-fresh actions.
- [ ] `npm run build` + vitest green; commit.

### Task 7: CI + hygiene
- [ ] Add `app-tests` job (npm ci, lint, vitest, build) to db-tests.yml.
- [ ] Push; both CI jobs green (Phase 2 gate: the three gate tests run in CI).
- [ ] Update `00-PROJECT-CONTEXT.md` session state; note Q13 (iOS field test)
      as the remaining real-device validation; commit.
```

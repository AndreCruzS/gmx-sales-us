# HubSpot Sync Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mirror the app's CRM spine (accounts, contacts, opportunities, activities, next actions) into GMX's shared HubSpot portal with HubSpot as the pipeline source of truth, and give reps a deal create/advance UI that satisfies the DB stage gate.

**Architecture:** Supabase Postgres stays the app's operational store and offline substrate; a new `src/lib/hubspot/` module (port interface + raw REST adapter + pure fixture-testable sync core, exactly the shape of `src/lib/email/`) runs a 5-minute Vercel cron that pushes local changes up and pulls HubSpot changes down with snapshot-based echo suppression. Deal stage is always HubSpot-authoritative; inbound stage changes are applied by a SECURITY DEFINER function that injects a "review deal" next action so the deferred stage-gate trigger stays satisfied. Reps get a new deal form that replays through the outbox via an atomic `create_opportunity_with_action` RPC.

**Tech Stack:** Next.js 16 (App Router), Supabase (Postgres + RLS + Vault), Zod 4, Dexie outbox (existing), HubSpot CRM REST v3/v4 via plain `fetch` — **no HubSpot SDK dependency**, vitest, pgTAP.

**Spec:** `docs/superpowers/specs/2026-08-05-hubspot-integration-design.md` — read it before starting any task.

## Global Constraints

- **TDD every task**: failing test → verify fail → minimal code → verify pass → commit. Test commands: `npm test` (vitest), `npx supabase test db` (pgTAP; local stack must be running — `npx supabase start`), `npm run lint`, `npm run build`.
- **No new npm dependencies.** HubSpot is called with plain `fetch` (the Gmail adapter used raw REST + jose the same way).
- **No direct Dexie imports** outside `src/lib/offline/` (ESLint enforces this).
- Client-side writes go **only** through `layer.sync.enqueue(...)` (the outbox). Server-side HubSpot sync uses the service-role client and **never** runs in the rep's request path.
- `SUPABASE_SERVICE_ROLE_KEY` and the HubSpot token must never appear in client-bundle code (only under `src/app/api/` or `scripts/`).
- Cron/admin routes authenticate with `authorization: Bearer ${CRON_SECRET}` (pattern: `src/app/api/email/sync/route.ts`).
- Comment style: comments state constraints the code can't show (see any file in `src/lib/offline/`), never narrate the next line. Match existing density.
- The uuid Zod helper in `src/lib/domain/schemas.ts:18` (regex, not `z.uuid()`) is the only uuid validator to use.
- Custom HubSpot property names are prefixed `maximo_` and defined once in `src/lib/hubspot/properties.ts` (Task 7). Never inline a property name string elsewhere.
- Migration files: `supabase/migrations/20260805NNNNNN_<name>.sql`, following the header-comment style of the existing migrations. New pgTAP suites: `supabase/tests/10_hubspot.test.sql`, `11_deal_write.test.sql`, `12_hubspot_inbound.test.sql`. **Reuse the fixture-building idiom from the top of `supabase/tests/07_exceptions.test.sql`** (self-built org/membership/territory/account fixtures + the `request.jwt.claims`/`set local role authenticated` persona dance) — open it before writing any pgTAP.
- HubSpot's live API is never called from tests. Only the sandbox smoke (Task 14, manual) touches a real portal.

---

## File Structure

```
supabase/migrations/
  20260805000100_hubspot.sql          # enum value, hubspot_id cols, sync tables, secret fn
  20260805000200_deal_write.sql       # create_opportunity_with_action (rep path, invoker)
  20260805000300_hubspot_inbound.sql  # hubspot_apply_deal (service path, definer)
supabase/tests/
  10_hubspot.test.sql  11_deal_write.test.sql  12_hubspot_inbound.test.sql
src/lib/domain/
  enums.ts        # + OPPORTUNITY_STAGES
  schemas.ts      # + opportunityCreateSchema/opportunityUpdateSchema, ENTITY_TABLES.opportunity
src/lib/offline/
  types.ts            # + SyncBackend.createOpportunityWithAction
  supabase-backend.ts # + rpc call
  sync-engine.ts      # + opportunity:create dispatch
src/lib/hubspot/
  port.ts         # HubSpotPort interface + record types
  properties.ts   # custom property definitions + names (single source)
  mapping.ts      # pure row→props / props→patch mappers
  sync-core.ts    # pure outbound/inbound planners (echo suppression, LWW, stage rule)
  hubspot-api.ts  # fetch adapter, batching, 429 backoff
  supabase-store.ts
  run-sync.ts     # per-org pass orchestration + setup helpers (impure, thin)
  __tests__/mapping.test.ts  sync-core.test.ts  hubspot-api.test.ts
src/app/api/hubspot/
  sync/route.ts   # 5-min cron, per-org passes
  admin/route.ts  # setup + backfill, dry-run
  health/route.ts # admin-only error/cursor counts
src/components/
  deal-stage-sheet.tsx
src/app/accounts/[id]/
  new-deal/page.tsx
  page.tsx        # wire "New deal" button + stage sheet into the opportunities block (~line 435)
src/app/dashboard/page.tsx  # sync-health card (admin)
vercel.json       # + /api/hubspot/sync cron
```

---

### Task 1: Migration — HubSpot substrate (enum value, link columns, sync tables, secret accessor)

**Files:**
- Create: `supabase/migrations/20260805000100_hubspot.sql`
- Create: `supabase/tests/10_hubspot.test.sql`

**Interfaces:**
- Consumes: existing `organizations`, `integration_provider` enum, `private.set_updated_at()`.
- Produces: `hubspot_id` column on `accounts|contacts|opportunities|activities|next_actions`; tables `hubspot_sync_cursors(org_id, stream, cursor)`, `hubspot_sync_snapshots(org_id, entity_type, entity_id, hubspot_id, synced_props, synced_at)`, `hubspot_sync_errors(id, org_id, direction, entity_type, entity_id, hubspot_id, payload, error, retry_count, resolved_at)`; function `public.get_integration_secret(p_ref text) returns text` (service_role only). Later tasks depend on these exact names.

- [ ] **Step 1: Write the failing pgTAP test**

`supabase/tests/10_hubspot.test.sql` (adapt the `plan()` count as you finish; fixture idiom from `07_exceptions.test.sql`):

```sql
begin;
select plan(14);

-- enum gained the provider value
select ok(
  'hubspot' = any (enum_range(null::integration_provider)::text[]),
  'integration_provider has hubspot');

-- link columns
select has_column('public', 'accounts',      'hubspot_id', 'accounts.hubspot_id');
select has_column('public', 'contacts',      'hubspot_id', 'contacts.hubspot_id');
select has_column('public', 'opportunities', 'hubspot_id', 'opportunities.hubspot_id');
select has_column('public', 'activities',    'hubspot_id', 'activities.hubspot_id');
select has_column('public', 'next_actions',  'hubspot_id', 'next_actions.hubspot_id');

select has_table('public', 'hubspot_sync_cursors',   'cursors table');
select has_table('public', 'hubspot_sync_snapshots', 'snapshots table');
select has_table('public', 'hubspot_sync_errors',    'errors table');

-- default-deny: an authenticated caller sees nothing (no policies exist)
-- fixtures: build org + membership exactly as 07_exceptions.test.sql does,
-- then assume its persona and probe.
-- <persona setup as in 07>
select is_empty(
  $$ select * from hubspot_sync_errors $$,
  'sync errors invisible to authenticated');
select is_empty(
  $$ select * from hubspot_sync_cursors $$,
  'cursors invisible to authenticated');
select is_empty(
  $$ select * from hubspot_sync_snapshots $$,
  'snapshots invisible to authenticated');
reset role;

-- secret accessor exists and authenticated cannot execute it
select has_function('public', 'get_integration_secret', array['text']);
select throws_like(
  $$ set local role authenticated;
     select public.get_integration_secret('x') $$,
  '%permission denied%',
  'get_integration_secret denied to authenticated');

select * from finish();
rollback;
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx supabase test db`
Expected: suite 10 FAILS (missing enum value / columns / tables).

- [ ] **Step 3: Write the migration**

`supabase/migrations/20260805000100_hubspot.sql`:

```sql
-- HubSpot sync bridge · migration 1: substrate (spec 2026-08-05).
-- HubSpot is the pipeline system of record; these tables carry the ID links,
-- per-stream cursors, echo-suppression snapshots, and the never-drop error
-- log (same D62 posture as the outbox: failures are surfaced, not swallowed).

alter type integration_provider add value if not exists 'hubspot';

alter table accounts      add column hubspot_id text;
alter table contacts      add column hubspot_id text;
alter table opportunities add column hubspot_id text;
alter table activities    add column hubspot_id text;
alter table next_actions  add column hubspot_id text;

-- One HubSpot object per row per org; NULL = not yet linked.
create unique index accounts_hubspot_id_key      on accounts      (org_id, hubspot_id) where hubspot_id is not null;
create unique index contacts_hubspot_id_key      on contacts      (org_id, hubspot_id) where hubspot_id is not null;
create unique index opportunities_hubspot_id_key on opportunities (org_id, hubspot_id) where hubspot_id is not null;
create unique index activities_hubspot_id_key    on activities    (org_id, hubspot_id) where hubspot_id is not null;
create unique index next_actions_hubspot_id_key  on next_actions  (org_id, hubspot_id) where hubspot_id is not null;

-- stream examples: 'out:accounts', 'out:activities', 'in:deals'.
-- cursor is an ISO timestamp (outbound: our updated_at) or a ms-epoch string
-- (inbound: hs_lastmodifieddate) — text keeps both without casting games.
create table hubspot_sync_cursors (
  org_id     uuid not null references organizations (id),
  stream     text not null,
  cursor     text not null,
  updated_at timestamptz not null default now(),
  primary key (org_id, stream)
);

-- Last property values we synced, in HubSpot property space. A side that
-- still equals its snapshot has not really changed — that is the echo test.
create table hubspot_sync_snapshots (
  org_id       uuid not null references organizations (id),
  entity_type  text not null check (entity_type in ('account', 'contact', 'opportunity')),
  entity_id    uuid not null,
  hubspot_id   text not null,
  synced_props jsonb not null,
  synced_at    timestamptz not null default now(),
  primary key (org_id, entity_type, entity_id)
);

create table hubspot_sync_errors (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations (id),
  direction   text not null check (direction in ('outbound', 'inbound')),
  entity_type text not null,
  entity_id   uuid,
  hubspot_id  text,
  payload     jsonb not null,
  error       text not null,
  retry_count int  not null default 0,
  resolved_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger set_updated_at
  before update on hubspot_sync_errors
  for each row execute function private.set_updated_at();

-- Sync state is server-side machinery: RLS on, zero policies. Only the
-- service role (which bypasses RLS) reads or writes; admin visibility goes
-- through /api/hubspot/health, which checks the caller's membership role.
alter table hubspot_sync_cursors   enable row level security;
alter table hubspot_sync_snapshots enable row level security;
alter table hubspot_sync_errors    enable row level security;

-- Vault secrets are named by org_integrations.credential_ref (D20). PostgREST
-- cannot reach the vault schema, so the sync route fetches the token through
-- this function — executable by service_role alone.
create or replace function public.get_integration_secret(p_ref text)
returns text
language sql
security definer
set search_path = ''
as $$
  select decrypted_secret from vault.decrypted_secrets where name = p_ref;
$$;

revoke all on function public.get_integration_secret(text) from public, anon, authenticated;
grant execute on function public.get_integration_secret(text) to service_role;
```

- [ ] **Step 4: Apply and verify pass**

Run: `npx supabase db reset && npx supabase test db`
Expected: suite 10 PASSES; suites 01–09 still green (reset re-runs everything).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260805000100_hubspot.sql supabase/tests/10_hubspot.test.sql
git commit -m "feat(hubspot): sync substrate — link columns, cursors/snapshots/errors, vault accessor"
```

---

### Task 2: Migration — `create_opportunity_with_action` (the rep's atomic deal create)

**Files:**
- Create: `supabase/migrations/20260805000200_deal_write.sql`
- Create: `supabase/tests/11_deal_write.test.sql`

**Interfaces:**
- Consumes: `opportunities`, `next_actions`, the deferred `opportunity_stage_gate` trigger (`20260722000600_loop.sql:214`).
- Produces: `public.create_opportunity_with_action(p_opportunity jsonb, p_next_action jsonb) returns void` — SECURITY INVOKER (RLS applies to the calling rep), idempotent via `on conflict (id) do nothing` on both inserts, granted to `authenticated`. Task 4's backend calls it by this exact name and argument names.

- [ ] **Step 1: Write the failing pgTAP test**

`supabase/tests/11_deal_write.test.sql` — fixtures + persona per `07_exceptions.test.sql`; use fresh literal uuids for the new rows:

```sql
begin;
select plan(6);

-- <fixtures: org, territory, rep membership, one account — as in 07>
-- <persona: rep>

select has_function('public', 'create_opportunity_with_action', array['jsonb', 'jsonb']);

-- happy path: one call, both rows, gate satisfied at commit
select lives_ok($$
  select public.create_opportunity_with_action(
    '{"id":"aaaaaaaa-0000-0000-0000-000000000001","org_id":"<ORG>",
      "name":"Ganahl decking","primary_account_id":"<ACCOUNT>",
      "territory_id":"<TERRITORY>","owner_id":"<MEMBERSHIP>",
      "stage":"IDENTIFIED","current_status":"Intro made at counter",
      "lead_source":"EXISTING_RELATIONSHIP"}'::jsonb,
    '{"id":"aaaaaaaa-0000-0000-0000-000000000002","org_id":"<ORG>",
      "action":"Drop decking sample","owner_id":"<MEMBERSHIP>",
      "due_date":"2026-08-12","account_id":"<ACCOUNT>",
      "opportunity_id":"aaaaaaaa-0000-0000-0000-000000000001",
      "kind":"SAMPLE_FOLLOW_UP"}'::jsonb)
$$, 'create with bundled first action commits past the stage gate');

select is(
  (select count(*)::int from opportunities  where id = 'aaaaaaaa-0000-0000-0000-000000000001'), 1,
  'opportunity row landed');
select is(
  (select count(*)::int from next_actions where opportunity_id = 'aaaaaaaa-0000-0000-0000-000000000001'
     and completed_at is null), 1,
  'open first action landed');

-- idempotent replay (D57): the double-fired outbox op is a no-op
select lives_ok($$ <same call again verbatim> $$, 'replay is a no-op');
select is(
  (select count(*)::int from next_actions where opportunity_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 1,
  'no duplicate action on replay');

select * from finish();
rollback;
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx supabase test db`
Expected: suite 11 FAILS ("function ... does not exist").

- [ ] **Step 3: Write the migration**

`supabase/migrations/20260805000200_deal_write.sql`:

```sql
-- HubSpot sync bridge · migration 2: the rep deal-create path.
-- The generic outbox replays one op per statement, but the stage gate demands
-- opportunity + open next_action in the SAME transaction — so the create
-- travels as one RPC. SECURITY INVOKER: the rep's own RLS insert policies
-- re-check at replay (D62). on conflict do nothing = D57 idempotent replay.

create or replace function public.create_opportunity_with_action(
  p_opportunity jsonb,
  p_next_action jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.opportunities (
    id, org_id, name, primary_account_id, territory_id, owner_id,
    stage, current_status, current_blocker,
    estimated_revenue, probability, expected_close_date,
    product, competitor,
    lead_source, source_detail, referring_account_id, project_id
  )
  values (
    (p_opportunity->>'id')::uuid,
    (p_opportunity->>'org_id')::uuid,
    p_opportunity->>'name',
    (p_opportunity->>'primary_account_id')::uuid,
    (p_opportunity->>'territory_id')::uuid,
    (p_opportunity->>'owner_id')::uuid,
    coalesce((p_opportunity->>'stage')::public.opportunity_stage, 'IDENTIFIED'),
    p_opportunity->>'current_status',
    p_opportunity->>'current_blocker',
    (p_opportunity->>'estimated_revenue')::numeric,
    (p_opportunity->>'probability')::smallint,
    (p_opportunity->>'expected_close_date')::date,
    p_opportunity->>'product',
    p_opportunity->>'competitor',
    (p_opportunity->>'lead_source')::public.lead_source_value,
    p_opportunity->>'source_detail',
    (p_opportunity->>'referring_account_id')::uuid,
    (p_opportunity->>'project_id')::uuid
  )
  on conflict (id) do nothing;

  insert into public.next_actions (
    id, org_id, action, owner_id, due_date,
    account_id, opportunity_id, objective, objective_detail, kind
  )
  values (
    (p_next_action->>'id')::uuid,
    (p_next_action->>'org_id')::uuid,
    p_next_action->>'action',
    (p_next_action->>'owner_id')::uuid,
    (p_next_action->>'due_date')::date,
    (p_next_action->>'account_id')::uuid,
    (p_next_action->>'opportunity_id')::uuid,
    (p_next_action->>'objective')::public.visit_objective,
    p_next_action->>'objective_detail',
    (p_next_action->>'kind')::public.next_action_kind
  )
  on conflict (id) do nothing;
end;
$$;

grant execute on function public.create_opportunity_with_action(jsonb, jsonb) to authenticated;
```

Note: if `lead_source_value` is a domain rather than a type in your local schema dump, the cast syntax is identical — do not special-case it. Check `next_action_kind`'s exact type name in `supabase/migrations/20260729000100_routine.sql` before writing the cast; if `kind` is plain text there, drop the cast.

- [ ] **Step 4: Apply and verify pass**

Run: `npx supabase db reset && npx supabase test db`
Expected: suite 11 PASSES, suites 01–10 green.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260805000200_deal_write.sql supabase/tests/11_deal_write.test.sql
git commit -m "feat(deals): atomic create_opportunity_with_action RPC satisfying the stage gate"
```

---

### Task 3: Migration — `hubspot_apply_deal` (inbound writer that keeps the gate honest)

**Files:**
- Create: `supabase/migrations/20260805000300_hubspot_inbound.sql`
- Create: `supabase/tests/12_hubspot_inbound.test.sql`

**Interfaces:**
- Consumes: Task 2's function (test fixtures create a deal through it), `opportunity_stage_events` trigger (fires automatically on stage change).
- Produces: `public.hubspot_apply_deal(p_org_id uuid, p_opportunity_id uuid, p_patch jsonb, p_review_action jsonb) returns void` — SECURITY DEFINER, service_role-only. `p_patch` keys: `stage, current_status, current_blocker, estimated_revenue, expected_close_date, probability, name` (all optional; absent = keep current). `p_review_action` keys: `id, action, owner_id, due_date, account_id` (the auto "review" action; only inserted when the patch changes stage to a non-WON/LOST value and no open action exists). Task 11's store calls this by name.

- [ ] **Step 1: Write the failing pgTAP test**

`supabase/tests/12_hubspot_inbound.test.sql` — fixtures per 07; create the deal via `create_opportunity_with_action` as the rep, then `reset role` (postgres plays the service role — it also bypasses RLS):

```sql
begin;
select plan(7);

-- <fixtures + rep-created opportunity 'bbbb...01' with open action 'bbbb...02'>

select has_function('public', 'hubspot_apply_deal',
  array['uuid', 'uuid', 'jsonb', 'jsonb']);

-- 1. open action exists → stage change applies, NO extra action injected
select lives_ok($$
  select public.hubspot_apply_deal('<ORG>', 'bbbb...01',
    '{"stage":"QUALIFIED"}'::jsonb,
    '{"id":"bbbb...03","action":"Review deal — stage changed in HubSpot",
      "owner_id":"<MEMBERSHIP>","due_date":"2026-08-07","account_id":"<ACCOUNT>"}'::jsonb)
$$, 'stage change with open action applies');
select is((select stage::text from opportunities where id = 'bbbb...01'),
  'QUALIFIED', 'stage moved');
select is((select count(*)::int from next_actions where opportunity_id = 'bbbb...01'),
  1, 'no injected action when one is open');

-- 2. complete the open action, advance again → review action IS injected
update next_actions set completed_at = now() where id = 'bbbb...02';
select lives_ok($$
  select public.hubspot_apply_deal('<ORG>', 'bbbb...01',
    '{"stage":"DEVELOPMENT"}'::jsonb,
    '{"id":"bbbb...04","action":"Review deal — stage changed in HubSpot",
      "owner_id":"<MEMBERSHIP>","due_date":"2026-08-07","account_id":"<ACCOUNT>"}'::jsonb)
$$, 'stage change with no open action injects the review action');
select is((select count(*)::int from next_actions
  where opportunity_id = 'bbbb...01' and completed_at is null), 1,
  'review action injected');

-- 3. stage history recorded by the existing trigger
select cmp_ok((select count(*) from opportunity_stage_events
  where opportunity_id = 'bbbb...01'), '>=', 2::bigint,
  'stage events logged for both transitions');

select * from finish();
rollback;
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx supabase test db` — suite 12 FAILS.

- [ ] **Step 3: Write the migration**

`supabase/migrations/20260805000300_hubspot_inbound.sql`:

```sql
-- HubSpot sync bridge · migration 3: the inbound deal writer.
-- HubSpot is stage-authoritative (spec §2), but the stage gate (Rule 3) must
-- not erode: a stage arriving from HubSpot with no open next action gets a
-- "review" action injected in the same transaction — the gate stays satisfied
-- and the rep gets a to-do instead of a silently moved pipeline.
-- SECURITY DEFINER + service_role-only: this is the sync engine's pen, no
-- rep JWT ever reaches it. coalesce() semantics: an absent patch key keeps
-- the current value; inbound nulling of fields is deliberately unsupported.

create or replace function public.hubspot_apply_deal(
  p_org_id uuid,
  p_opportunity_id uuid,
  p_patch jsonb,
  p_review_action jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new_stage public.opportunity_stage := (p_patch->>'stage')::public.opportunity_stage;
begin
  if v_new_stage is not null
     and v_new_stage not in ('WON', 'LOST')
     and p_review_action is not null
     and not exists (
       select 1 from public.next_actions na
       where na.opportunity_id = p_opportunity_id
         and na.completed_at is null
     )
  then
    insert into public.next_actions (
      id, org_id, action, owner_id, due_date, account_id, opportunity_id, kind
    )
    values (
      (p_review_action->>'id')::uuid,
      p_org_id,
      p_review_action->>'action',
      (p_review_action->>'owner_id')::uuid,
      (p_review_action->>'due_date')::date,
      (p_review_action->>'account_id')::uuid,
      p_opportunity_id,
      'OTHER'::public.next_action_kind
    )
    on conflict (id) do nothing;
  end if;

  update public.opportunities o
     set stage               = coalesce(v_new_stage, o.stage),
         current_status      = coalesce(p_patch->>'current_status', o.current_status,
                                        case when v_new_stage is not null
                                             then 'Stage set in HubSpot' end),
         current_blocker     = coalesce(p_patch->>'current_blocker', o.current_blocker),
         estimated_revenue   = coalesce((p_patch->>'estimated_revenue')::numeric, o.estimated_revenue),
         expected_close_date = coalesce((p_patch->>'expected_close_date')::date, o.expected_close_date),
         probability         = coalesce((p_patch->>'probability')::smallint, o.probability),
         name                = coalesce(p_patch->>'name', o.name)
   where o.id = p_opportunity_id
     and o.org_id = p_org_id;
end;
$$;

revoke all on function public.hubspot_apply_deal(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.hubspot_apply_deal(uuid, uuid, jsonb, jsonb) to service_role;
```

(Same `next_action_kind` cast caveat as Task 2.)

- [ ] **Step 4: Apply and verify pass**

Run: `npx supabase db reset && npx supabase test db` — suites 01–12 green.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260805000300_hubspot_inbound.sql supabase/tests/12_hubspot_inbound.test.sql
git commit -m "feat(hubspot): inbound deal writer — stage-authoritative, gate-preserving"
```

---

### Task 4: Domain schemas + outbox dispatch for `opportunity`

**Files:**
- Modify: `src/lib/domain/enums.ts` (add `OPPORTUNITY_STAGES`)
- Modify: `src/lib/domain/schemas.ts` (two schemas, `ENTITY_TABLES`, `outboxPayloadSchemas`)
- Modify: `src/lib/offline/types.ts` (SyncBackend method)
- Modify: `src/lib/offline/supabase-backend.ts` (rpc impl)
- Modify: `src/lib/offline/sync-engine.ts:92-111` (dispatch)
- Test: extend the existing outbox vitest suite (find it: `Glob src/lib/offline/**/*.test.ts` — extend, don't fork, its fake backend)

**Interfaces:**
- Consumes: Task 2's RPC name/args.
- Produces: `OPPORTUNITY_STAGES` const; `opportunityCreateSchema` (with embedded `first_action`), `OpportunityCreate`; `opportunityUpdateSchema`, `OpportunityUpdate`; `ENTITY_TABLES.opportunity = "opportunities"`; `SyncBackend.createOpportunityWithAction(payload: Record<string, unknown>): Promise<void>`. Tasks 5, 6 enqueue `{entityType: "opportunity", op: "create"|"update"}` and rely on these.

- [ ] **Step 1: Write the failing tests** (in the existing outbox suite file)

```ts
describe("opportunity outbox entity", () => {
  const validCreate = {
    id: "11111111-1111-1111-1111-111111111111",
    org_id: "22222222-2222-2222-2222-222222222222",
    name: "Ganahl decking",
    primary_account_id: "33333333-3333-3333-3333-333333333333",
    territory_id: "44444444-4444-4444-4444-444444444444",
    owner_id: "55555555-5555-5555-5555-555555555555",
    stage: "IDENTIFIED",
    current_status: "Intro made",
    lead_source: "EXISTING_RELATIONSHIP",
    first_action: {
      id: "66666666-6666-6666-6666-666666666666",
      action: "Drop decking sample",
      due_date: "2026-08-12",
      kind: "SAMPLE_FOLLOW_UP",
    },
  };

  it("validates create and dispatches to createOpportunityWithAction", async () => {
    // arrange the engine with the suite's fake backend, spy on the new method
    await engine.enqueue({ entityType: "opportunity", op: "create", payload: validCreate });
    await engine.drain();
    expect(backend.createOpportunityWithAction).toHaveBeenCalledWith(validCreate);
    expect(backend.upsertIgnoreDuplicates).not.toHaveBeenCalledWith(
      "opportunities", expect.anything());
  });

  it("rejects a create without first_action at enqueue time", async () => {
    const { first_action: _drop, ...bad } = validCreate;
    await expect(engine.enqueue({ entityType: "opportunity", op: "create", payload: bad }))
      .rejects.toThrow();
  });

  it("rejects OTHER lead source without detail (D8) and referral without account (D7)", async () => {
    await expect(engine.enqueue({ entityType: "opportunity", op: "create",
      payload: { ...validCreate, lead_source: "OTHER" } })).rejects.toThrow();
    await expect(engine.enqueue({ entityType: "opportunity", op: "create",
      payload: { ...validCreate, lead_source: "REFERRAL_DEALER" } })).rejects.toThrow();
  });

  it("routes opportunity:update through updateWithVersion with LWW guard", async () => {
    await engine.enqueue({
      entityType: "opportunity", op: "update", baseVersion: "2026-08-05T00:00:00Z",
      payload: { id: validCreate.id, stage: "QUALIFIED" },
    });
    await engine.drain();
    expect(backend.updateWithVersion).toHaveBeenCalledWith(
      "opportunities", validCreate.id, { stage: "QUALIFIED" }, "2026-08-05T00:00:00Z");
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npm test` → new tests FAIL (schema missing).

- [ ] **Step 3: Implement**

`enums.ts` — mirror the DB enum (`20260722000200_enums.sql:32`):

```ts
// Mirrors opportunity_stage. WON/LOST are terminal; the stage gate exempts
// them from the open-next-action requirement (Rule 3).
export const OPPORTUNITY_STAGES = [
  "IDENTIFIED", "QUALIFIED", "DEVELOPMENT", "QUOTE", "DECISION",
  "WON", "LOST", "ON_HOLD",
] as const;
export type OpportunityStage = (typeof OPPORTUNITY_STAGES)[number];
```

`schemas.ts` — after `accountUpdateSchema`; import `OPPORTUNITY_STAGES`:

```ts
// Deal create travels as ONE op: the stage gate demands opportunity + open
// next_action in the same transaction, so first_action rides inside the
// payload and the backend replays both through create_opportunity_with_action.
export const opportunityCreateSchema = z
  .object({
    id: uuid,
    org_id: uuid,
    name: z.string().min(1),
    primary_account_id: uuid,
    territory_id: uuid,
    owner_id: uuid,
    stage: z.enum(OPPORTUNITY_STAGES).default("IDENTIFIED"),
    current_status: z.string().min(1),
    current_blocker: z.string().nullish(),
    estimated_revenue: z.number().nonnegative().nullish(),
    probability: z.number().int().min(0).max(100).nullish(),
    expected_close_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
    product: z.string().nullish(),
    competitor: z.string().nullish(),
    lead_source: z.enum(LEAD_SOURCES_ALL),
    source_detail: z.string().nullish(),
    referring_account_id: uuid.nullish(),
    project_id: uuid.nullish(),
    first_action: z.object({
      id: uuid,
      action: z.string().min(1),
      due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      objective: z.enum(VISIT_OBJECTIVES).nullish(),
      objective_detail: z.string().nullish(),
      kind: z.enum(["SAMPLE_FOLLOW_UP", "QUOTE_FOLLOW_UP", "VISIT", "OTHER"]).nullish(),
    }),
  })
  .refine((o) => o.lead_source !== "OTHER" || Boolean(o.source_detail), {
    message: "OTHER lead source needs a word on where it came from (D8)",
  })
  .refine(
    (o) =>
      !(REFERRAL_LEAD_SOURCES as readonly string[]).includes(o.lead_source) ||
      Boolean(o.referring_account_id),
    { message: "referral lead sources need the referring account (D7)" },
  );
export type OpportunityCreate = z.infer<typeof opportunityCreateSchema>;

// Scalar deal edits (stage advance included) ride the D61 LWW path.
export const opportunityUpdateSchema = z.object({
  id: uuid,
  stage: z.enum(OPPORTUNITY_STAGES).optional(),
  current_status: z.string().min(1).optional(),
  current_blocker: z.string().nullish(),
  estimated_revenue: z.number().nonnegative().nullish(),
  probability: z.number().int().min(0).max(100).nullish(),
  expected_close_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
});
export type OpportunityUpdate = z.infer<typeof opportunityUpdateSchema>;
```

Add to `ENTITY_TABLES`: `opportunity: "opportunities",` and to `outboxPayloadSchemas`: `"opportunity:create": opportunityCreateSchema, "opportunity:update": opportunityUpdateSchema,`.

`types.ts` — on `SyncBackend`:

```ts
  /** Deal create replays as one RPC — the stage gate needs both rows in one
   *  transaction, which per-op upserts cannot give. */
  createOpportunityWithAction(payload: Record<string, unknown>): Promise<void>;
```

`supabase-backend.ts`:

```ts
  async createOpportunityWithAction(payload: Record<string, unknown>): Promise<void> {
    const { first_action, ...opp } = payload as {
      first_action: Record<string, unknown>;
    } & Record<string, unknown>;
    const { error } = await this.supabase.rpc("create_opportunity_with_action", {
      p_opportunity: opp,
      p_next_action: {
        ...first_action,
        org_id: opp.org_id,
        owner_id: opp.owner_id,
        account_id: opp.primary_account_id,
        opportunity_id: opp.id,
      },
    });
    if (error) classify(error.code ?? null, error.message);
  }
```

`sync-engine.ts` `pushOne`, replacing the plain `if (rec.op === "create")` branch:

```ts
      if (rec.op === "create") {
        if (rec.entityType === "opportunity") {
          await this.backend.createOpportunityWithAction(rec.payload);
        } else {
          await this.backend.upsertIgnoreDuplicates(table, rec.payload);
        }
      } else {
```

Update the suite's fake backend with a vi.fn() `createOpportunityWithAction`.

- [ ] **Step 4: Verify** — `npm test` all green (existing 84 + new), `npm run lint`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/domain src/lib/offline
git commit -m "feat(deals): opportunity outbox entity — atomic create dispatch, LWW updates"
```

---

### Task 5: Deal create form

**Files:**
- Create: `src/app/accounts/[id]/new-deal/page.tsx`
- Modify: `src/app/accounts/[id]/page.tsx` (add a "New deal" link in the opportunities section header, ~line 435; also render the section when `opportunities.length === 0` so the button is reachable)

**Interfaces:**
- Consumes: `opportunityCreateSchema` shape from Task 4; `useOffline()` → `{ profile, layer }` (`profile.orgId`, `profile.membershipId`, `layer.sync.enqueue`); the account-load pattern and styling idiom of `src/app/accounts/new/page.tsx` (read it fully first — field markup, error display, submit states, `crypto.randomUUID()` id minting).
- Produces: route `/accounts/<id>/new-deal`.

- [ ] **Step 1: Manual-first note.** This is UI; the automated coverage came from Task 4 (payload validation + dispatch). Before writing code, read `src/app/accounts/new/page.tsx` end to end — reuse its exact form idiom (labels, `t-*` type classes, tinted cards, no hairline borders, pill tags), and the account page's account-fetch effect.

- [ ] **Step 2: Implement the page.** Client component. Content:

  - Load the account row (name, `territory_id`) with the same supabase fetch the account page uses; take the account id from `useParams()`.
  - Fields: deal name (text, required) · stage (select over `OPPORTUNITY_STAGES` minus WON/LOST — a new deal is never born closed; default IDENTIFIED) · estimated revenue (number, optional) · expected close date (date, optional) · current status (text, required — label it "Where does this stand?") · lead source (same select + conditional `source_detail` / referring-account picker as `accounts/new` — copy that block) · **first next action** (action text required, due date required, kind select over SAMPLE_FOLLOW_UP/QUOTE_FOLLOW_UP/VISIT/OTHER). Use `humanize()` from enums for all option labels; no enum jargon on screen (per the UX rule: rep language everywhere).
  - Submit builds the payload with `crypto.randomUUID()` for both ids and enqueues **one** op:

```ts
await layer.sync.enqueue({
  entityType: "opportunity",
  op: "create",
  payload: {
    id: dealId,
    org_id: profile.orgId,
    name: name.trim(),
    primary_account_id: accountId,
    territory_id: account.territory_id,
    owner_id: profile.membershipId,
    stage,
    current_status: currentStatus.trim(),
    estimated_revenue: revenue === "" ? null : Number(revenue),
    expected_close_date: closeDate || null,
    lead_source: leadSource,
    source_detail: sourceDetail || null,
    referring_account_id: referringAccountId || null,
    first_action: {
      id: actionId,
      action: actionText.trim(),
      due_date: actionDue,
      kind: actionKind,
    },
  },
});
router.push(`/accounts/${accountId}`);
```

  One op = no compensation loop needed (unlike `accounts/new`'s multi-op fan-out). Zod errors from `enqueue` surface in the form's error area (the schema throws before anything queues — same capture-time-failure philosophy as D45 forms).
  - Wire the entry point in `page.tsx`: in the opportunities section header row, a link styled like the page's other action links: `<Link href={`/accounts/${account.id}/new-deal`}>New deal</Link>`, and lift the section out of the `opportunities.length > 0 &&` guard (empty state: "No deals yet." + the link).

- [ ] **Step 3: Verify in the running app.** `npm run dev` against the local stack (`npx supabase start`), sign in as the seeded rep, open an account → New deal → submit with all required fields → back on the account page the deal appears after sync; check Supabase Studio (`http://127.0.0.1:54343` per the dev-setup memory) that `opportunities` + `next_actions` rows landed. Also verify the two Zod guards: OTHER source without detail and empty next action both block with a visible message.

- [ ] **Step 4: Gate** — `npm run lint && npm run build` clean.

- [ ] **Step 5: Commit**

```bash
git add "src/app/accounts/[id]/new-deal/page.tsx" "src/app/accounts/[id]/page.tsx"
git commit -m "feat(deals): create-deal form from the account page — first action required"
```

---

### Task 6: Stage advance sheet

**Files:**
- Create: `src/components/deal-stage-sheet.tsx`
- Modify: `src/app/accounts/[id]/page.tsx` (opportunity card opens the sheet; pass the open-actions set)

**Interfaces:**
- Consumes: `opportunityUpdateSchema` + `nextActionCreateSchema` payloads (Task 4); `useOffline()`; the account page already holds `next_actions` for the account — derive `hasOpenAction = nextActions.some(n => n.opportunity_id === opp.id && !n.completed_at)`.
- Produces: `<DealStageSheet opportunity={...} hasOpenAction={boolean} onClose={() => void} />` where `opportunity` carries `{ id, name, stage, current_status, updated_at, primary_account_id }`.

- [ ] **Step 1: Implement the sheet.** Bottom-sheet/dialog styled like the review sheet (find the idiom in `src/app/review/page.tsx`'s sheet markup). Contents:
  - Stage select (all `OPPORTUNITY_STAGES`, humanized), status text input prefilled with `current_status`.
  - **Rule 3 at edit time:** if the chosen stage is not WON/LOST and `hasOpenAction` is false, a required inline "Next action" block appears (action text + due date + kind — same trio as Task 5).
  - Save enqueues in FIFO-safe order — the outbox drains by `seq`, so the action (if any) must be enqueued **first**; the deferred gate then sees it when the update commits:

```ts
if (needsAction) {
  await layer.sync.enqueue({
    entityType: "next_action",
    op: "create",
    payload: {
      id: crypto.randomUUID(),
      org_id: profile.orgId,
      action: actionText.trim(),
      owner_id: profile.membershipId,
      due_date: actionDue,
      account_id: opportunity.primary_account_id,
      opportunity_id: opportunity.id,
      kind: actionKind,
    },
  });
}
await layer.sync.enqueue({
  entityType: "opportunity",
  op: "update",
  baseVersion: opportunity.updated_at,
  payload: { id: opportunity.id, stage, current_status: status.trim() },
});
```

  A stale `baseVersion` (deal moved in HubSpot meanwhile) lands in the error tray by design (D61) — no special handling here.
- [ ] **Step 2: Wire into the account page**: opportunity select must include `updated_at, current_status, primary_account_id` (add to the `.from("opportunities")` select at ~line 197 if absent); tapping the card's stage pill opens the sheet.
- [ ] **Step 3: Verify in the app**: advance a deal that has an open action (no action block shown) and one without (block required); confirm the stage change + new action in Studio, and that `opportunity_stage_events` grew.
- [ ] **Step 4: Gate** — `npm test && npm run lint && npm run build`.
- [ ] **Step 5: Commit**

```bash
git add src/components/deal-stage-sheet.tsx "src/app/accounts/[id]/page.tsx"
git commit -m "feat(deals): stage advance sheet — rule 3 enforced at edit time"
```

---

### Task 7: HubSpot port, property registry, and pure mappers

**Files:**
- Create: `src/lib/hubspot/port.ts`, `src/lib/hubspot/properties.ts`, `src/lib/hubspot/mapping.ts`
- Test: `src/lib/hubspot/__tests__/mapping.test.ts`

**Interfaces (Produces — later tasks import these exact names):**

`port.ts`:

```ts
export type HsObjectType =
  | "companies" | "contacts" | "deals"
  | "notes" | "meetings" | "calls" | "tasks";

export type HsProps = Record<string, string | null>;

export interface HsRecord {
  id: string;
  props: HsProps;
  lastModifiedAt: string; // ms-epoch string from hs_lastmodifieddate
}

export interface HsFilter {
  propertyName: string;
  operator: "EQ" | "GT";
  value: string;
}

export interface HubSpotPort {
  batchCreate(type: HsObjectType, inputs: { props: HsProps }[]): Promise<HsRecord[]>;
  batchUpdate(type: HsObjectType, inputs: { id: string; props: HsProps }[]): Promise<HsRecord[]>;
  searchModifiedSince(
    type: HsObjectType,
    sinceMs: string,
    extraFilters: HsFilter[],
    properties: string[],
    after?: string,
  ): Promise<{ results: HsRecord[]; after: string | null }>;
  /** v4 default association — no hardcoded association type ids. */
  associateDefault(
    fromType: HsObjectType, fromId: string,
    toType: HsObjectType, toId: string,
  ): Promise<void>;
  listOwners(): Promise<{ id: string; email: string }[]>;
  ensureProperty(objectType: "companies" | "contacts" | "deals", def: HsPropertyDef): Promise<void>;
  ensureDealPipeline(label: string, stageLabels: string[]): Promise<{
    pipelineId: string;
    stageIds: Record<string, string>; // stage label → HubSpot stage id
  }>;
}

export interface HsPropertyDef {
  name: string;
  label: string;
  type: "string" | "bool" | "enumeration";
  fieldType: "text" | "booleancheckbox" | "select";
  groupName: string;
  options?: { label: string; value: string }[];
}

export interface HubSpotOrgConfig {
  pipeline_id: string;
  stage_map: Record<string, string>;   // our stage enum → HubSpot stage id
  owner_map: Record<string, string>;   // membership_id → hubspot_owner_id
}
```

`properties.ts` — the single source for every custom property name and definition:

```ts
export const P = {
  managed: "maximo_managed",
  accountType: "maximo_account_type",
  leadSource: "maximo_lead_source",
  displayWall: "maximo_display_wall",
  isChampion: "maximo_is_champion",
  currentStatus: "maximo_current_status",
  currentBlocker: "maximo_current_blocker",
} as const;

export const COMPANY_PROPERTY_DEFS: HsPropertyDef[] = [ /* managed, accountType, leadSource, displayWall — groupName "companyinformation" */ ];
export const CONTACT_PROPERTY_DEFS: HsPropertyDef[] = [ /* managed, isChampion — groupName "contactinformation" */ ];
export const DEAL_PROPERTY_DEFS: HsPropertyDef[] = [ /* managed, currentStatus, currentBlocker, leadSource — groupName "dealinformation" */ ];
```

(Write the defs out fully — `managed` is `bool`/`booleancheckbox`; enum-ish fields are plain `string`/`text` in v1 so our enum stays authoritative.)

`mapping.ts` — all pure, all unit-tested:

```ts
export function accountToCompanyProps(a: AccountRow, ownerMap: Record<string, string>): HsProps
export function contactToContactProps(c: ContactRow, ownerMap: Record<string, string>): HsProps
export function opportunityToDealProps(o: OpportunityRow, cfg: HubSpotOrgConfig): HsProps
export function dealPropsToPatch(props: HsProps, cfg: HubSpotOrgConfig): DealPatch
  // inverse stage_map lookup; unknown stage id → throws MappingError
export function activityToEngagement(act: ActivityRow): {
  type: "meetings" | "calls" | "notes"; props: HsProps }
export function nextActionToTaskProps(n: NextActionRow, ownerMap: Record<string, string>): HsProps
export function splitName(full: string): { firstname: string; lastname: string }
```

Row types are minimal structural interfaces declared in `mapping.ts` (only the columns each mapper reads — do not import `database.types.ts` here; the store selects supply them).

**Mapping rules to implement and test (each is a test case):**
- Company: `name`, `city`, `P.accountType` = account_type, `P.leadSource` = lead_source, `P.displayWall` = `"true"/"false"` from `has_display_wall`, `P.managed` = `"true"`, `hubspot_owner_id` from ownerMap (absent membership → omit the key, never `""`).
- Contact: `splitName` → `firstname`/`lastname` (single word → lastname empty), `email`, `phone`, `jobtitle` = job_title, `P.isChampion`, `P.managed`.
- Deal: `dealname` = name, `pipeline` = cfg.pipeline_id, `dealstage` = cfg.stage_map[stage] (unknown → MappingError), `amount` = String(estimated_revenue) or null, `closedate` = ms-epoch string of `expected_close_date` at UTC midnight or null, `P.currentStatus`, `P.currentBlocker`, `P.leadSource`, `P.managed`.
- `dealPropsToPatch`: inverse of the above — `{ stage?, name?, estimated_revenue?, expected_close_date? (yyyy-mm-dd), current_status?, current_blocker? }`, keys present only when the HS prop is present.
- Engagement: activity_type ∈ {DEALER_VISIT, DISTRIBUTOR_VISIT, CONTRACTOR_MEETING, ARCHITECT_MEETING, JOBSITE_VISIT, PK_TRAINING} → `meetings` (`hs_meeting_title` = humanized type + account context handled by store; `hs_meeting_body` = composed body; `hs_timestamp` = occurred_at ISO); PHONE_CALL → `calls` (`hs_call_title`, `hs_call_body`); rest → `notes` (`hs_note_body`). Body = purpose/objective line + `what_happened` + humanized outcomes list, newline-joined, skipping empty parts.
- Task: `hs_task_subject` = action, `hs_timestamp` = due_date UTC-midnight ms string, `hs_task_status` = completed_at ? `"COMPLETED"` : `"NOT_STARTED"`, `hs_task_body` = objective_detail ?? null, `hubspot_owner_id` from ownerMap.

- [ ] **Step 1: Write the failing tests** — one `describe` per mapper covering every rule above plus: ownerMap miss omits `hubspot_owner_id`; `dealPropsToPatch` round-trips `opportunityToDealProps` output for a fully-populated deal; unknown inbound `dealstage` throws.
- [ ] **Step 2: `npm test`** → FAIL (module missing).
- [ ] **Step 3: Implement** `port.ts`, `properties.ts`, `mapping.ts` per the signatures above.
- [ ] **Step 4: `npm test`** → PASS. `npm run lint`.
- [ ] **Step 5: Commit** — `git add src/lib/hubspot && git commit -m "feat(hubspot): port interface, property registry, pure mappers"`

---

### Task 8: sync-core — outbound planning (echo suppression)

**Files:**
- Create: `src/lib/hubspot/sync-core.ts`
- Test: `src/lib/hubspot/__tests__/sync-core.test.ts`

**Interfaces (Produces):**

```ts
export interface Snapshot { entityId: string; hubspotId: string; props: HsProps }

export interface OutboundCandidate {
  entityType: "account" | "contact" | "opportunity";
  entityId: string;
  hubspotId: string | null;
  updatedAt: string;      // our updated_at ISO
  props: HsProps;         // already mapped (Task 7 mappers, applied by the store)
}

export interface OutboundPlan {
  creates: OutboundCandidate[];
  patches: { entityId: string; hubspotId: string; props: HsProps }[];
  echoes: string[];       // entityIds skipped as echoes
}

export function planOutbound(
  candidates: OutboundCandidate[],
  snapshots: Map<string, Snapshot>,   // key = entityId
): OutboundPlan
```

**Rules:** no `hubspotId` → `creates`. Has `hubspotId`: props deep-equal `snapshot.props` → `echoes` (this change is the inbound writer's own write coming back around). Otherwise → `patches` with **only the props that differ** from the snapshot (minimal patch keeps HubSpot's property history clean). No snapshot but has `hubspotId` (backfill-adopted record) → full-props patch.

- [ ] **Step 1: Failing tests** — four cases mirroring the four rules, plus: empty candidate list → empty plan; a candidate differing in exactly one prop patches only that prop.
- [ ] **Step 2: `npm test`** → FAIL.
- [ ] **Step 3: Implement** (deep-equal = key-set + value compare over the flat `HsProps` — write a tiny `propsEqual`; no lodash).
- [ ] **Step 4: `npm test`** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(hubspot): outbound sync planning with echo suppression"`

---

### Task 9: sync-core — inbound planning (stage-authoritative LWW, merges, team boundary)

**Files:**
- Modify: `src/lib/hubspot/sync-core.ts`
- Test: extend `src/lib/hubspot/__tests__/sync-core.test.ts`

**Interfaces (Produces):**

```ts
export interface LocalLink {
  entityId: string;
  updatedAt: string;
  props: HsProps;         // current local values mapped to HS prop space
}

export type InboundDecision =
  | { kind: "echo"; hubspotId: string }
  | { kind: "apply"; entityId: string; patch: HsProps; stageChanged: boolean }
  | { kind: "local-wins"; entityId: string; stagePatch: HsProps | null }
  | { kind: "unlinked"; hubspotId: string };  // no local row — store resolves (deal→create, else error row)

export function planInbound(
  records: HsRecord[],                 // pre-filtered by maximo_managed/pipeline upstream
  links: Map<string, LocalLink>,       // key = hubspot record id
  snapshots: Map<string, Snapshot>,    // key = entityId
  opts: { stagePropName: "dealstage" | null },  // null for companies/contacts
): InboundDecision[]
```

**Rules (each a test):**
1. Record's props equal the snapshot's → `echo`.
2. HS changed vs snapshot, local unchanged vs snapshot → `apply` (patch = only the changed props; `stageChanged` true when `dealstage` is among them).
3. Both changed (true conflict): newer timestamp wins (`lastModifiedAt` ms vs `updatedAt` ISO — normalize to ms). Local newer → `local-wins`, **but** if `opts.stagePropName` is set and the HS stage differs from local, `stagePatch = { dealstage: <hs value> }` (HubSpot is always stage-authoritative). HS newer → `apply`.
4. No `links` entry → `unlinked`.
5. A record with no snapshot but a link (adopted during backfill) → treat local as unchanged → rule 2.

- [ ] **Step 1: Failing tests** for all five rules + stage-only conflict (local newer, only stage differs → `local-wins` with `stagePatch`).
- [ ] **Step 2: FAIL** → **Step 3: Implement** → **Step 4: PASS + lint** → **Step 5: Commit** — `git commit -m "feat(hubspot): inbound planning — stage-authoritative conflicts, unlinked routing"`

---

### Task 10: HubSpot REST adapter

**Files:**
- Create: `src/lib/hubspot/hubspot-api.ts`
- Test: `src/lib/hubspot/__tests__/hubspot-api.test.ts`

**Interfaces:**
- Produces: `export class HubSpotApi implements HubSpotPort { constructor(private token: string, private fetchFn: typeof fetch = fetch) {} }` plus `export function backoffDelayMs(attempt: number, retryAfterHeader: string | null): number`.

**Implementation notes (exact endpoints):**
- Base `https://api.hubapi.com`; headers `authorization: Bearer <token>`, `content-type: application/json`.
- `batchCreate` → `POST /crm/v3/objects/{type}/batch/create` body `{ inputs: [{ properties }] }`; chunk inputs at 100; response `results[{id, properties, updatedAt}]` → map to `HsRecord` (`lastModifiedAt` from `properties.hs_lastmodifieddate` ?? `updatedAt`).
- `batchUpdate` → `POST /crm/v3/objects/{type}/batch/update` body `{ inputs: [{ id, properties }] }`, same chunking.
- `searchModifiedSince` → `POST /crm/v3/objects/{type}/search` body `{ filterGroups: [{ filters: [{ propertyName: "hs_lastmodifieddate", operator: "GT", value: sinceMs }, ...extraFilters] }], sorts: ["hs_lastmodifieddate"], properties, limit: 100, after }`.
- `associateDefault` → `PUT /crm/v4/objects/{fromType}/{fromId}/associations/default/{toType}/{toId}` (empty body).
- `listOwners` → `GET /crm/v3/owners?limit=100` (follow `paging.next.after`).
- `ensureProperty` → `GET /crm/v3/properties/{objectType}/{name}`; on 404, `POST /crm/v3/properties/{objectType}` with the def.
- `ensureDealPipeline` → `GET /crm/v3/pipelines/deals`; if a pipeline with `label` exists, return its id + stage map (stage label → stage id); else `POST /crm/v3/pipelines/deals` with `{ label, displayOrder: 10, stages: stageLabels.map((l, i) => ({ label: l, displayOrder: i, metadata: { probability: l === "Won" ? "1.0" : l === "Lost" ? "0.0" : "0.5" } })) }` and build the map from the response.
- Every request funnels through one private `request()` that: retries on 429 and 5xx up to 5 attempts using `backoffDelayMs` (honor `Retry-After` seconds when present, else `min(2^attempt * 1000, 30_000)`); throws `HubSpotApiError` (exported, carries `status` + response body text) on other non-2xx.

- [ ] **Step 1: Failing tests** — inject a stub `fetchFn`: (a) `backoffDelayMs` honors Retry-After and caps at 30s; (b) a 429-then-200 sequence resolves without throwing and called fetch twice; (c) `batchCreate` with 250 inputs issues 3 requests of ≤100; (d) a 400 throws `HubSpotApiError` with the body text; (e) `searchModifiedSince` sends the exact body shape above (assert via the stub's captured request).
- [ ] **Step 2: FAIL** → **Step 3: Implement** → **Step 4: PASS + lint** → **Step 5: Commit** — `git commit -m "feat(hubspot): REST adapter with batching and 429 backoff"`

---

### Task 11: Store + cron route (the live sync pass)

**Files:**
- Create: `src/lib/hubspot/supabase-store.ts`
- Create: `src/lib/hubspot/run-sync.ts`
- Create: `src/app/api/hubspot/sync/route.ts`
- Test: `src/lib/hubspot/__tests__/run-sync.test.ts`
- Modify: `vercel.json` (add `{ "path": "/api/hubspot/sync", "schedule": "*/5 * * * *" }` to `crons`)

**Interfaces:**
- Consumes: everything from Tasks 1, 3, 7–10.
- Produces: `export class HubSpotStore { constructor(service: SupabaseClient, orgId: string) }` (in `supabase-store.ts`) with the methods listed below, and `runOrgSync(port: HubSpotPort, store: HubSpotStore, cfg: HubSpotOrgConfig): Promise<SyncReport>` (in `run-sync.ts` — the impure orchestration layer; `sync-core.ts` stays pure).

`HubSpotStore` methods (all service-role, all org-scoped):

```ts
getCursor(stream: string): Promise<string | null>
setCursor(stream: string, cursor: string): Promise<void>
changedAccountsSince(iso: string | null): Promise<AccountRow[]>      // limit 200, order updated_at asc
changedContactsSince(iso: string | null): Promise<ContactRow[]>
changedOpportunitiesSince(iso: string | null): Promise<OpportunityRow[]>
changedActivitiesSince(iso: string | null): Promise<ActivityRow[]>   // hubspot_id is null only (append-only: push once)
changedNextActionsSince(iso: string | null): Promise<NextActionRow[]>
linkHubspotId(table: string, id: string, hubspotId: string): Promise<void>
loadSnapshots(entityType: string, entityIds: string[]): Promise<Map<string, Snapshot>>
saveSnapshot(entityType: string, s: Snapshot): Promise<void>
loadLinksByHubspotId(table: string, hubspotIds: string[]): Promise<Map<string, LocalLink>>  // maps via mapping.ts
applyCompanyPatch/applyContactPatch(entityId, patch): Promise<void>          // plain update
applyDealPatch(entityId, patch: DealPatch, review: ReviewAction | null): Promise<void>
   // rpc hubspot_apply_deal; review = { id: crypto.randomUUID(), action: "Review deal — stage changed in HubSpot", owner_id: <deal owner>, due_date: <today+2d>, account_id: <deal primary account> }
createDealFromHubSpot(record: HsRecord, cfg): Promise<void>
   // rpc create_opportunity_with_action with defaults: lead_source "OTHER",
   // source_detail "Created in HubSpot", owner/territory from the associated
   // company's account row; no resolvable company → recordError instead
recordError(direction, entityType, entityId, hubspotId, payload, error): Promise<void>
```

`runOrgSync` pass order (each stream wrapped in try/catch → `recordError` + continue; cursor advances only past successfully processed rows):
1. **Outbound accounts** → planOutbound → batchCreate/batchUpdate companies → linkHubspotId + saveSnapshot; parent/child: after creates, for rows with `parent_account_id` whose parent has a `hubspot_id`, `associateDefault("companies", child, "companies", parent)`.
2. **Outbound contacts** (same; then `associateDefault("contacts", contact, "companies", company)`).
3. **Outbound deals** (same; associate deal→company).
4. **Outbound activities** → engagement create (single batch per type) → linkHubspotId; associate to company + deal + contacts (via `activity_contacts`).
5. **Outbound next_actions** → tasks: no `hubspot_id` → create + link; has one and completed → batchUpdate `hs_task_status: "COMPLETED"`.
6. **Inbound companies, contacts** → search (`P.managed EQ true`) → planInbound(stagePropName null) → apply patches (`dealPropsToPatch` equivalents from mapping) + saveSnapshot; `unlinked` → recordError (v1: companies/contacts born in HubSpot need admin mapping).
7. **Inbound deals** → search (filters: `P.managed EQ true`, `pipeline EQ cfg.pipeline_id`) → planInbound(stagePropName "dealstage") → `applyDealPatch` (+ review action when `stageChanged`) / `createDealFromHubSpot` for `unlinked` / `local-wins` with `stagePatch` → applyDealPatch with just the stage.
8. Advance inbound cursors to the max `lastModifiedAt` seen; outbound cursors to the max `updated_at` pushed.

Route `src/app/api/hubspot/sync/route.ts` — mirror `email/sync/route.ts` exactly: `export const maxDuration = 300;` cron-mode only (no caller mode — reps never trigger this): verify `Bearer ${CRON_SECRET}`, service client, load `org_integrations` where `provider = 'hubspot'` and `status = 'active'`, per org: token = `service.rpc("get_integration_secret", { p_ref: row.credential_ref })`, cfg from `row.config`; missing token/config → org skipped with a note in the response; run `runOrgSync`, return `{ results }`. No token configured anywhere → readable 501 (same courtesy as the Gmail route).

- [ ] **Step 1: Failing test** — `run-sync.ts` is thin orchestration over tested parts; add one vitest with a fake `HubSpotPort` + fake store (in-memory maps) driving a full pass: 1 new account, 1 changed deal both-sides (HubSpot stage wins), 1 inbound-only deal stage change (review action recorded), 1 unlinked inbound deal (create called). Assert call order (companies before contacts before deals) and cursor advancement.
- [ ] **Step 2: FAIL** → **Step 3: Implement store, run-sync, route, vercel.json** → **Step 4: `npm test`, `npm run lint`, `npm run build`** → **Step 5: Commit** — `git commit -m "feat(hubspot): org sync pass — store, cron route, 5-min schedule"`

---

### Task 12: Admin route — portal setup + backfill (dry-run first)

**Files:**
- Create: `src/app/api/hubspot/admin/route.ts`

**Interfaces:**
- Consumes: `ensureProperty`/`ensureDealPipeline`/`listOwners` (Task 10), property defs (Task 7), store (Task 11).
- Produces: `POST /api/hubspot/admin` body `{ action: "setup" | "backfill", org_id: string, dry_run?: boolean }`, auth `Bearer ${CRON_SECRET}`.

**setup** (idempotent, safe to re-run): ensure all property defs on companies/contacts/deals; `ensureDealPipeline("MAXIMO USA", ["Identified","Qualified","Development","Quote","Decision","Won","Lost","On hold"])`; build `stage_map` keyed by our enum (`IDENTIFIED` → id of "Identified", etc. — define the label↔enum pairs as a const, not by humanize()); `listOwners()` matched against `memberships → users.email` (active memberships of the org) → `owner_map`; unmatched memberships reported in the response, not fatal; persist `{ pipeline_id, stage_map, owner_map }` into `org_integrations.config` (merge, don't clobber). `dry_run`: report what would be created/written, write nothing (pass a recording no-op port wrapper).

**backfill** (per spec §6, FK order): all accounts with `hubspot_id is null` → planned company creates; contacts — those with an email get a HubSpot search (`email EQ`) first: hit → **adopt** (linkHubspotId + patch with our props + `P.managed`), miss/no-email → create; opportunities → deal creates. Everything then flows through the same code path as Task 11's outbound pass (reuse `runOrgSync`'s stream functions — backfill is "outbound with a null cursor", so implement it as: seed no cursors, call the outbound streams with `iso = null` meaning "all rows", which `changed*Since` already supports). `dry_run` returns counts + first 10 planned items per stream.

- [ ] **Step 1: Failing test** — vitest on the setup helpers `buildOwnerMap(owners, memberships)` and the `STAGE_LABELS` const, both exported from `run-sync.ts` (pure despite the module's impure neighbors): owner matched by email case-insensitively; unmatched listed; stage_map keys are exactly the 8 enum values.
- [ ] **Step 2: FAIL** → **Step 3: Implement** → **Step 4: PASS + lint + build** → **Step 5: Commit** — `git commit -m "feat(hubspot): admin setup + backfill with dry-run"`

---

### Task 13: Sync health for admins

**Files:**
- Create: `src/app/api/hubspot/health/route.ts`
- Modify: `src/app/dashboard/page.tsx` (one card)

**Interfaces:**
- Consumes: `hubspot_sync_errors`, `hubspot_sync_cursors` (service client — RLS denies direct reads by design).
- Produces: `GET /api/hubspot/health` → `{ configured: boolean, unresolvedErrors: number, lastPassAt: string | null }`.

- [ ] **Step 1: Implement the route**: session required (same `getSupabaseServerClient` + `orgIdFromJwt` dance as `email/sync/route.ts` — extract that helper into `src/lib/supabase/jwt.ts` and reuse in both rather than copy a third time); then service-client check that the caller's active membership in that org has `role in ('manager','admin')` — others get 403; `configured` = an active `org_integrations` hubspot row exists; counts from the two tables (`resolved_at is null`; `lastPassAt` = max cursor `updated_at`).
- [ ] **Step 2: Dashboard card**: on the dashboard page, fetch `/api/hubspot/health`; render nothing on 403/!configured; else a small card in the page's existing card idiom: "HubSpot sync" + "Up to date · last pass HH:MM" or "N changes need attention" when `unresolvedErrors > 0`. Rep language, no jargon (not "sync errors": "N changes need attention").
- [ ] **Step 3: Verify in the app** (as the seeded manager; rep sees nothing). **Step 4: lint + build.** **Step 5: Commit** — `git commit -m "feat(hubspot): admin sync-health card"`

---

### Task 14: Full gate + sandbox smoke checklist

**Files:**
- Modify: `src/lib/database.types.ts` (regenerated)
- Create: `docs/hubspot-go-live.md` (checklist)

- [ ] **Step 1: Regenerate types**: `npm run db:types` (local stack running). Fix any type fallout in touched files.
- [ ] **Step 2: Full gate**: `npm test` (all vitest), `npx supabase test db` (all 12 suites), `npm run lint` (0 errors), `npm run build` (clean). Fix before proceeding — evidence before assertions.
- [ ] **Step 3: Write `docs/hubspot-go-live.md`** — the manual steps no test can cover, as a literal checklist:
  1. GMX HubSpot super-admin creates a **private app** with scopes: `crm.objects.companies.read/write`, `crm.objects.contacts.read/write`, `crm.objects.deals.read/write`, `crm.objects.owners.read`, `crm.schemas.companies/contacts/deals.read`, engagement scopes (`crm.objects.notes/meetings/calls/tasks` read+write — verify exact names in the private-app scope picker, they shift), pipeline read/write.
  2. Store the token: Supabase Vault secret named `hubspot-<org-slug>`; insert the `org_integrations` row (`provider 'hubspot'`, `credential_ref` = that name, `status 'active'`).
  3. Run setup dry-run → review → run live: `curl -X POST .../api/hubspot/admin -H "authorization: Bearer $CRON_SECRET" -d '{"action":"setup","org_id":"…","dry_run":true}'`.
  4. **Association-type verification** (the one hardcoding risk): in the sandbox, confirm `associateDefault` company→company yields the *child-to-parent* direction we intend — if HubSpot's default flips it, switch to the v4 labeled endpoint with `associationTypeId` 13/14 (parent↔child) and note which.
  5. Backfill dry-run → review counts → live backfill.
  6. One full round-trip on the sandbox portal: create a deal in the app → appears in the MAXIMO pipeline; drag it a stage in HubSpot → within 5 min the app shows the new stage + a "Review deal" item; log an activity → note on the company timeline.
  7. Q-C from the spec: confirm shared-contact etiquette with the Lumber Plus team before the live backfill.
- [ ] **Step 4: Update `00-PROJECT-CONTEXT.md`** session-state (one paragraph: HubSpot bridge built, link to spec/plan, go-live doc pending client console steps) — supersede, never delete.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "chore(hubspot): regen types, go-live checklist, context update"`

---

## Self-review notes (already applied)

- Spec §2 "merges/deletes": merge remap is Task 9 rule 4 + Task 11 store (`loadLinksByHubspotId` returning the surviving id path); HubSpot deletions surface as `unlinked`-style errors on the next inbound pass — explicitly logged via `recordError`, no local delete. Covered.
- Spec §4 kanban cut, §8 multi-tenancy (config all per-org), §7 hermetic tests: covered by construction.
- Deliberate deviation from spec §5: one `hubspot_sync_state` table became three (`cursors`/`snapshots`/`errors`) — same content, cleaner keys; spec's intent (cursors, errors, snapshots) is preserved.
- Not in this plan (matches spec cuts): webhooks, projects sync, association labels for deal role FKs, HubSpot-form ingestion.

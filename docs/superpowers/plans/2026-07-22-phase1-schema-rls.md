# Phase 1 — Schema + RLS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the complete Postgres foundation — enums, all tables (incl. email/candidate tables), check constraints, triggers (stage transitions), default-deny RLS with manager-down visibility, `user_hierarchy` strategy, storage policies, seed script — with the cross-tenant leakage suite and constraint tests green in CI.

**Architecture:** Numbered SQL migrations under `supabase/migrations/`, applied by the Supabase CLI to a local stack (CI: GitHub Actions + `supabase db start` + `supabase test db`). Tests are pgTAP, simulating authenticated users by setting `request.jwt.claims` (incl. the custom `org_id` claim) and `set local role authenticated`. RLS helpers live in a non-exposed `private` schema as `security definer` functions.

**Tech Stack:** Supabase Postgres 15+, Supabase CLI, pgTAP, pg_trgm, GitHub Actions.

## Global Constraints (from D1–D62 / build brief §2)

- `org_id` on **every** table incl. joins (D16/D17); all unique constraints org-scoped.
- Every policy: `org_id = (select private.jwt_org_id())` **and** active-membership check (D18/D23/D24). Never the claim alone.
- Visibility fans out manager-down, never peer-to-peer; support role reads/writes for assigned reps (D53).
- Default-deny: `enable row level security` on every table + explicit policies; shared predicates in `security definer` helpers, `search_path = ''`, EXECUTE revoked from client roles.
- Every table: `id uuid pk`, `org_id`, `created_at`, `updated_at` (trigger-maintained — LWW version key, D61).
- Enums as Postgres enum types, **except `lead_source`** → check-constrained text **domain** (admin-promotion path, brief §4 conventions; chosen over lookup table — promotion is a 2-line migration and the D7/D8 constraint logic stays beside the column).
- Client-generated UUIDs: the client supplies `id` itself → PK conflict = idempotent replay (D57). No separate `client_id` column.
- Storage paths org-prefixed with matching Storage RLS; signed URLs only (D21/D38).
- Leakage suite + constraint tests are part of this phase's deliverable, not a follow-up.

## Implementation decisions locked by this plan (surfaced to user, no invented D-numbers)

1. **Ownership is membership-scoped:** all `owner_id` / `created_by` FKs point at `memberships(id)`, not `users(id)`. Consistent with D22 (org-scoped actor) and makes the manager chain (also on memberships) one graph. RLS resolves `auth.uid()` → active membership.
2. **`user_hierarchy` strategy = closure table** (`ancestor_id`, `descendant_id`, `depth`, incl. self at depth 0), rebuilt per-org by trigger on `memberships` insert/update-of-`manager_id`/delete, with a cycle guard. Spec §4 explicitly offers this for performance; org headcounts are small so whole-org rebuild is simple and correct.
3. **Stage-gate trigger is a DEFERRABLE INITIALLY DEFERRED constraint trigger** on opportunities (insert + update of stage): requires `current_status IS NOT NULL` always, and an open `next_action` (`completed_at IS NULL`, `due_date NOT NULL`) for **non-terminal** stages (`WON`/`LOST` exempt — a closed deal needs no next action; `ON_HOLD` still requires one, it's a revisit date). Deferred so app/outbox can insert opportunity + next_action in one transaction.
4. **Rule 3 for activities = app-level guard + exception view** (spec §3 allows "trigger or app-level guard"). A hard insert-time trigger would break D45's one-note-plus-flag capture. `activities.follow_up_required` + `next_actions.activity_id` provide the data; the Phase 3 exception engine surfaces violations. The Phase 1 gate only requires D7/D8 + stage trigger tests.
5. **Unspecified small value-lists** (relationship_status, influence_level, strength, project_status, strategic_importance, candidate/email statuses) get pragmatic enum values, flagged for review — the spec names the fields but not the values.
6. **LWW stale-write rejection (D61) is client-protocol, not a DB trigger:** outbox updates filter on `updated_at = base_version`; 0 rows updated = conflict → error tray. The DB contribution is the trigger-maintained `updated_at`.

---

## File Structure

```
supabase/
  config.toml                                (supabase init)
  seed.sql                                   two orgs, users, memberships, fixtures
  migrations/
    20260722000100_extensions.sql            pg_trgm, private schema, set_updated_at()
    20260722000200_enums.sql                 all enum types + lead_source domain
    20260722000300_tenancy.sql               organizations, org_integrations
    20260722000400_identity.sql              users, territories, memberships,
                                             support_assignments, user_hierarchy + triggers
    20260722000500_crm.sql                   accounts, contacts, account_relationships
    20260722000600_loop.sql                  projects, project_stakeholders, opportunities,
                                             activities, activity_* joins, next_actions,
                                             stage-gate trigger
    20260722000700_intake.sql                voice_captures, contact_candidates
    20260722000800_email.sql                 email_threads/messages/attachments,
                                             email_sync_state, org_email_exclusions
    20260722000900_rls_helpers.sql           private.* security definer functions
    20260722001000_rls_policies.sql          enable RLS + policies, every table
    20260722001100_storage.sql               voice/cards/email buckets + storage RLS
    20260722001200_indexes.sql               org composites, FK, partial, trgm indexes
  tests/
    01_schema.test.sql                       tables/columns/RLS-enabled sanity
    02_leakage.test.sql                      cross-tenant: zero foreign rows, every table
    03_visibility.test.sql                   rep/peer/manager/admin/support matrix
    04_constraints.test.sql                  D7/D8, self-refs, champion, uniques
    05_stage_trigger.test.sql                stage gate incl. deferred behavior
.github/workflows/db-tests.yml               CI: supabase db start + test db
```

## Schema reference (columns per table)

Every table implicitly: `id uuid primary key default gen_random_uuid()`, `org_id uuid not null references organizations(id)` (except `organizations`, `users`), `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()` + `set_updated_at` trigger.

- **organizations**: name, slug (unique), workspace_domain (unique), status org_status.
- **org_integrations**: provider integration_provider, credential_ref text (Vault name — never a plain secret), config jsonb, status text, last_verified_at. UNIQUE(org_id, provider).
- **users** (identity only, id = auth.users.id FK): email, full_name, avatar_url, last_active_org_id.
- **territories**: name, region. UNIQUE(org_id, name).
- **memberships**: user_id→users, role membership_role, territory_id→territories, manager_id→memberships, status membership_status, debrief_language text default 'en' (Q7), joined_at. UNIQUE(org_id, user_id); CHECK(manager_id <> id).
- **support_assignments** (D53): support_membership_id, rep_membership_id → memberships. UNIQUE(org_id, support_membership_id, rep_membership_id); CHECK(support<>rep).
- **user_hierarchy** (closure): ancestor_id, descendant_id → memberships, depth int. PK(ancestor_id, descendant_id). RLS enabled, **no policies** (server-internal only).
- **accounts**: name, account_type, website, address, city, state, territory_id, owner_id→memberships, strategic_importance, relationship_status, lead_source lead_source_value, source_detail, referring_account_id→accounts, parent_account_id→accounts (D49), has_display_wall bool default false, display_last_verified_at (D52). UNIQUE(org_id, name); CHECKs: OTHER⇒source_detail (D8), referral⇒referring_account_id (D7), no self parent/referral.
- **contacts**: account_id, name, job_title, email, phone, influence_level, relationship_status, is_champion bool default false (D50, partial unique index one per account).
- **account_relationships**: account_a_id, relationship_type, account_b_id, strength, status, notes, created_by→memberships, last_confirmed_at. CHECK(a<>b); UNIQUE(org_id, account_a_id, relationship_type, account_b_id).
- **projects**: name, location, project_type text, estimated_construction_date date, estimated_completion_date date, status project_status, estimated_size text, notes, created_by→memberships. Org-visible (convergence object — no owner in spec).
- **project_stakeholders**: project_id, account_id, stakeholder_role. UNIQUE(org_id, project_id, account_id, stakeholder_role).
- **opportunities**: name, project_id?, primary_account_id, territory_id, owner_id, product, application, estimated_quantity numeric, quantity_unit text, estimated_revenue numeric(14,2), probability smallint 0–100, expected_close_date date, distributor_id/dealer_id (channel), architect_id/contractor_id/builder_id/developer_id (influencers) → accounts, competitor, alternative_product, risk, stage opportunity_stage default 'IDENTIFIED', current_status, current_blocker, lead_source + source_detail + referring_account_id (D6; same D7/D8 CHECKs).
- **activities**: activity_type, primary_account_id, owner_id, occurred_at default now(), location, purpose, was_planned bool default false, planned_action_id→next_actions (D46), objective visit_objective?, objective_detail, what_happened (the D45 note), key_information, commercial_potential, outcomes activity_outcome[] default '{}', follow_up_required bool default false (D45), opportunity_id? (Rule 2).
- **activity_accounts**: activity_id, account_id, role activity_account_role. UNIQUE(org_id, activity_id, account_id).
- **activity_contacts**: activity_id, contact_id. UNIQUE(org_id, activity_id, contact_id).
- **next_actions**: action text, owner_id, due_date date, completed_at, account_id?, project_id?, opportunity_id?, activity_id? (spawned-from, Rule 3 linkage), objective visit_objective? (D48), objective_detail, calendar_event_id text (D15). CHECK(objective='OTHER' ⇒ objective_detail).
- **voice_captures**: owner_id, audio_path, duration_seconds int, transcript, ai_draft jsonb, status voice_capture_status default 'PENDING', language text, activity_id?, reviewed_at, sent_at.
- **contact_candidates** (D39): created_by→memberships, source candidate_source, raw_ref, extracted jsonb (per-field confidence), matched_contact_id?, matched_account_id?, status candidate_status default 'PENDING', resolved_at.
- **email_threads** (D28): membership_id, gmail_thread_id, subject, participants jsonb, matched_account_id?, matched_contact_id?, first_message_at, last_message_at, last_direction email_direction, open_commitments jsonb, status text, linked_opportunity_id?, linked_project_id?, last_extracted_at. UNIQUE(org_id, membership_id, gmail_thread_id).
- **email_messages**: thread_id, gmail_message_id, from_addr, to_addrs text[], cc_addrs text[], sent_at, direction, snippet, body_ref (Storage, TTL), has_attachments bool. UNIQUE(org_id, thread_id, gmail_message_id).
- **email_attachments**: message_id, filename, mime_type, size_bytes bigint, sha256 text (D30 dedupe), storage_path, classification attachment_classification, linked_opportunity_id?, linked_project_id?. UNIQUE(org_id, message_id, sha256).
- **email_sync_state** (D33): membership_id, history_id text, last_synced_at, status text. UNIQUE(org_id, membership_id).
- **org_email_exclusions** (D27, optional net): pattern text, reason. UNIQUE(org_id, pattern).

## Enum values

- `org_status`: active · suspended
- `membership_role`: rep · manager · admin · support
- `membership_status`: active · suspended
- `integration_provider`: anthropic · openai · google · workspace
- `account_type` / `activity_type` / `activity_outcome` / `opportunity_stage` / `relationship_type` / `voice_capture_status`: exactly as spec §2
- `visit_objective` (D48): COLLECT_QUOTE · MEET_CONTRACTOR · CONVERT_STOCKING_DEALER · FOLLOW_UP_LEAD · PK_DELIVERY · MERCHANDISING_CHECK · RELATIONSHIP_MAINTENANCE · OTHER
- `candidate_source` (D39): MANUAL · VOICE · BUSINESS_CARD · EMAIL_METADATA
- `candidate_status`*: PENDING · CONFIRMED · MERGED · DISCARDED
- `email_direction`: INBOUND · OUTBOUND
- `attachment_classification` (D31): QUOTE · SPEC_SHEET · DRAWING · SUBMITTAL · PHOTO · INVOICE · OTHER
- `strategic_importance`*: STRATEGIC · HIGH · MEDIUM · LOW
- `relationship_status_value`* (accounts & contacts): PROSPECT · DEVELOPING · ESTABLISHED · AT_RISK · DORMANT
- `influence_level`*: LOW · MEDIUM · HIGH · DECISION_MAKER
- `relationship_strength`*: WEAK · MODERATE · STRONG
- `relationship_state`* (account_relationships.status): ACTIVE · INACTIVE · UNCONFIRMED
- `project_status`*: PLANNING · DESIGN · BIDDING · UNDER_CONSTRUCTION · COMPLETED · ON_HOLD · CANCELLED
- `activity_account_role`: PRIMARY · INVOLVED
- `lead_source_value` **domain** (check-constrained text): REFERRAL_DEALER · REFERRAL_DISTRIBUTOR · REFERRAL_CONTRACTOR · REFERRAL_ARCHITECT · SPEC_DRIVEN · REFERRAL_OTHER · PK_CLASS · JOBSITE · COLD_OUTREACH · EXISTING_RELATIONSHIP · TRADE_SHOW · INBOUND_WEB · MARKETING_CAMPAIGN · MANUFACTURER_LEAD · SOCIAL · OTHER

\* = values proposed by this plan (spec names field, not values) — review with client.

## RLS design

Helpers in `private` (security definer, `set search_path = ''`, EXECUTE revoked from anon/authenticated/public where server-internal; the policy-called ones granted to authenticated):

```sql
private.jwt_org_id() returns uuid          -- (select nullif(auth.jwt()->>'org_id',''))::uuid
private.active_membership_id() returns uuid -- membership for (auth.uid(), jwt_org_id), status='active'
private.is_active_member() returns boolean
private.is_admin() returns boolean
private.visible_membership_ids() returns setof uuid
  -- admin: all memberships in org
  -- else: self ∪ descendants via user_hierarchy ∪ support_assignments(rep side, where I'm support)
private.visible_territory_ids() returns setof uuid  -- territory_id of visible memberships
private.can_see_account(uuid) / can_see_activity(uuid) / can_see_opportunity(uuid)
  / can_see_project(uuid) / can_see_contact(uuid) returns boolean  -- for join/child tables,
  -- re-implements parent visibility without recursive RLS
```

Policy template (every table): USING/WITH CHECK always starts
`org_id = (select private.jwt_org_id()) and (select private.is_active_member())`, then:

| Table | select | insert/update/delete |
|---|---|---|
| organizations | member of that org | update: admin |
| org_integrations | admin | admin |
| users | own row ∪ co-members of active org | update own row |
| territories | any active member | admin |
| memberships | own ∪ visible ∪ admin | admin |
| support_assignments | admin ∪ party to the row | admin |
| user_hierarchy | none (deny-all) | none |
| accounts | owner∈visible ∪ territory∈visible_territories ∪ admin | owner∈visible (write-down incl. support) |
| contacts | can_see_account(account_id) | same |
| account_relationships | can_see_account(a) or can_see_account(b) | created_by∈visible + can_see_account(a) |
| projects | any active member (org-wide convergence object) | insert any member (created_by = self-chain); update creator-chain ∪ admin |
| project_stakeholders | can_see_project | as projects update |
| opportunities | owner∈visible ∪ admin | owner∈visible |
| activities | owner∈visible | owner∈visible |
| activity_accounts / activity_contacts | can_see_activity | can_see_activity |
| next_actions | owner∈visible | owner∈visible |
| voice_captures | owner∈visible | owner∈visible |
| contact_candidates | created_by∈visible | created_by∈visible |
| email_threads/messages/attachments/sync_state | membership∈visible (messages/attachments via thread) | none for clients (service-role ingestion bypasses RLS); update of link/status fields: thread owner |
| org_email_exclusions | admin | admin |

Storage (buckets `voice`, `cards`, `email`; all private):
- voice: insert/select for authenticated where `(storage.foldername(name))[1] = jwt_org_id()::text` and `[2] = auth.uid()::text` (path `{org_id}/{user_id}/{capture_id}`, spec §4a).
- cards: insert/select where org prefix matches + active member (`{org_id}/cards/...`, D42).
- email: **no client policies** — service-role only (D38; bodies/attachments served via signed URLs, never cached offline per D60).

## Test matrix

- **02_leakage**: for **every** public table with `org_id`: as org2 rep, `count(*) where org_id = :org1` is 0 **and** unfiltered `count(*)` returns only org2 rows; discovered dynamically from `information_schema` so a new table without policies fails the suite (default-deny ⇒ 0 rows everywhere, which also passes — the real guard is the second assertion plus 01_schema's "RLS enabled on all tables" check).
- **03_visibility** (org1 fixtures): rep TJ sees own activities, not Deon's; Deon sees own-territory accounts, not Buffalo's; manager João sees both reps' activities/next_actions; admin sees org-wide; support Eric sees/writes TJ's rows (D53), not Deon's; rep cannot insert an activity owned by a peer.
- **04_constraints**: D8 (OTHER w/o source_detail ⟶ 23514), D7 (REFERRAL_DEALER w/o referring_account_id ⟶ fails; with ⟶ ok), relationship self-ref, relationship (a,type,b) dupe, second champion on an account, cross-org unique account names allowed / same-org rejected, next_action objective OTHER w/o detail.
- **05_stage_trigger**: update stage w/o open next_action + `set constraints all immediate` ⟶ error; insert opp + next_action in one txn (deferred) ⟶ ok; stage→WON with no next action ⟶ ok; stage change with `current_status` null ⟶ error.

---

### Task 1: Toolchain + project scaffold
- [ ] Verify `supabase` CLI and Docker locally; `supabase init` (creates `supabase/config.toml`). If Docker unavailable locally, CI is the verification path.
- [ ] Commit scaffold.

### Task 2: Extensions, private schema, enums (migrations 000100, 000200)
- [ ] Write both migrations exactly per "Enum values" above; `set_updated_at()` trigger fn in 000100.
- [ ] Commit.

### Task 3: Tenancy + identity (000300, 000400)
- [ ] organizations/org_integrations; users/territories/memberships/support_assignments/user_hierarchy per schema reference; closure rebuild + cycle-guard triggers.
- [ ] Commit.

### Task 4: CRM + loop tables (000500, 000600)
- [ ] accounts/contacts/account_relationships with all D7/D8/D49/D50/D52 constraints; projects/opportunities/activities/joins/next_actions; stage-gate constraint trigger (deferred, security definer).
- [ ] Commit.

### Task 5: Intake + email tables (000700, 000800)
- [ ] voice_captures, contact_candidates, email_* per schema reference.
- [ ] Commit.

### Task 6: RLS helpers + policies + storage (000900, 001000, 001100)
- [ ] Helpers per RLS design; enable RLS + `force row level security` on every table; policies per matrix; storage buckets + policies.
- [ ] Commit.

### Task 7: Indexes (001200)
- [ ] Org-leading composites on hot paths: accounts(org_id,territory_id), (org_id,owner_id) everywhere owned, next_actions(org_id,owner_id,due_date) partial `completed_at is null`, next_actions(opportunity_id) partial (stage-gate lookup), all FK columns, contacts(org_id, lower(email)), contacts name gin_trgm (D40), activities(org_id, primary_account_id, occurred_at desc), user_hierarchy(descendant_id), email uniques.
- [ ] Commit.

### Task 8: Seed (seed.sql)
- [ ] Two orgs (gmx-us, acme-test), fixed-UUID auth.users + public.users (Bianca admin, João manager, TJ rep Buffalo, Deon rep SoCal, Eric support→TJ; org2 admin+rep), territories, support assignment, accounts (incl. parent branch pair + display wall), contacts (champion), relationships, project+stakeholders, opportunity (+open next_action so the gate passes), activities (planned + unplanned), voice capture, contact candidate, email thread fixture. `tests` helper schema: `tests.authenticate_as(email, org_slug)` setting `request.jwt.claims` (sub, role=authenticated, org_id claim) + `set local role authenticated`; `tests.clear_auth()`.
- [ ] Commit.

### Task 9: pgTAP suites (tests/01–05) — write tests, watch them fail without policies? (order: tests are written after schema here; the red-green cycle is per-suite: run, fix, re-run)
- [ ] Implement the four suites per Test matrix + 01_schema (every public table has RLS enabled + org_id + updated_at trigger).
- [ ] `supabase test db` locally (if Docker) — iterate to green.
- [ ] Commit.

### Task 10: CI + hygiene
- [ ] `.github/workflows/db-tests.yml`: checkout → supabase/setup-cli@v1 → `supabase db start` → `supabase test db`.
- [ ] Push; verify Actions green (this is the phase gate).
- [ ] Update `00-PROJECT-CONTEXT.md` Session state (+ decisions proposals for the user); `supabase/README.md` documenting implementation decisions 1–6 above.
- [ ] Commit.

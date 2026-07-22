# CLAUDE.md — Commercial Operating System · Build Session Brief

> **Purpose:** boot file for a Claude coding session (Claude Code or chat) building
> the Commercial Operating System. Read this first, then the three project docs.
> This file tells you *how to work*; the project docs tell you *what is decided*.
>
> **Current build position:** design is complete and locked (D1–D62).
> **Next deliverable: Postgres DDL** — enums, tables, constraints, RLS policies —
> then Activity capture with the offline layer.

---

## 0. Required reading, in order

1. `00-PROJECT-CONTEXT.md` — what we're building, the stack, the full Decisions
   Log (D1–D62), open questions, build sequencing. **Single source of truth.**
2. `01-TECHNICAL-SPEC.md` — entity model, enums, DB constraints, tenancy, RLS,
   voice pipeline, Gmail ingestion, contact intake, Workspace integration,
   rep-routine findings (D45–D54).
3. `02-OFFLINE-MOBILE-ARCHITECTURE.md` — offline read cache + write outbox,
   sync engine, iOS constraints, conflict policy (D55–D62).

Do not re-litigate locked decisions. If implementation reveals a genuine
contradiction, surface it explicitly as a proposed **superseding** decision
(new D-number) — never silently deviate, never delete log entries.

---

## 1. What this is, in one paragraph

A multi-tenant, mobile-first PWA CRM for building-materials two-step
distribution (`Manufacturer → Distributor → Dealer → Contractor/A&D`), built on
Next.js + Vercel + Supabase (Postgres/Auth/Storage) + Google Workspace
(delegated service account). Core principle: **record once → update everything**
— the rep logs one Activity; agenda, account history, opportunity timelines and
dashboards are *derived views*, never separately maintained. Three operating
rules: (1) every activity is recorded even if no opportunity results; (2) one
opportunity links many activities; (3) every important activity/opportunity
ends with a next action + date (DB-enforced).

---

## 2. Non-negotiables (violating any of these is a bug)

### Tenancy & security
- `org_id` on **every** table, join tables included (D16/D17). All unique
  constraints scoped by org.
- Tenant identity = custom JWT claim (`auth.jwt() ->> 'org_id'`), **and** every
  policy verifies an active `memberships` row for that org (D18/D23/D24). Never
  trust the claim alone.
- RLS visibility fans out **manager-down, never peer-to-peer**: rep sees own
  rows + territory accounts; manager sees their `manager_id` chain; admin sees
  org-wide; support role reads/writes for assigned reps (D53).
- Storage paths are org-prefixed (`{org_id}/...`) with matching Storage RLS;
  serve via signed URLs only (D21/D38). Storage is a leak vector outside the DB
  — never skip its policies.
- **Cross-tenant leakage test suite ships with the schema, runs in CI** (spec
  §4 testing note): seed two orgs, authenticate as each, assert zero foreign
  rows on every table. Write this *before* building features on RLS.

### Data model invariants
- `users` = identity only; `memberships` = org-scoped role/territory/manager
  (D22). Accounts are **branch-level** with `parent_account_id` roll-up (D49).
- Project ≠ Opportunity (D5). Activity ≠ pipeline stage.
- Lead source lives on **both** Account and Opportunity (D6); referral sources
  require `referring_account_id` and write an `account_relationships` row (D7);
  `OTHER` requires `source_detail` via check constraint (D8). All required at
  creation.
- Opportunity stage transitions require `current_status` + next action + date
  (trigger). Important activities cannot close without a linked `next_action`
  (Rule 3, trigger or app guard).
- One `is_champion` contact per account (D50); `has_display_wall` +
  `display_last_verified_at` on accounts (D52).

### AI & review gates
- **Nothing AI-drafted becomes a record without human review** — voice, email
  extraction, business cards all land in the same review queues (D9/D32/D39).
- AI is provider-agnostic via Vercel AI SDK; per-org credentials in
  `org_integrations` via Supabase Vault, never plain columns (D20).
  Transcription = OpenAI or Google STT (Anthropic can't transcribe audio).
- Gmail: contact matching **is** the privacy boundary (D35); unknown senders =
  metadata only (D36); match contacts *before* any AI call (D34).

### Offline & sync
- Sync layer talks to **Supabase directly, never through Vercel** (D3/D62).
- No feature code imports IndexedDB/Dexie directly — everything behind
  `LocalStore` / `SyncEngine` / `BlobStore` / `PushChannel` (D55).
- Client-generated UUIDs everywhere; server upserts on `client_id` →
  idempotent replay (D57).
- No Background Sync API. Foreground/`online`/manual/interval triggers only;
  always-visible "N unsynced" indicator (D58).
- Signed upload URLs minted at **sync time**, blob purged after confirmed
  upload (D59). Wipe local DB on logout **and org switch**; no email bodies or
  attachments cached on the PWA path (D60).
- Conflicts: appends never conflict; scalar edits = LWW on server `updated_at`
  with stale writes **rejected to the error tray**, never clobbered or dropped
  (D61/D62). The error tray is a first-class UI surface and must exist before
  offline writes ship.

### Google Workspace
- One External OAuth client for sign-in (all tenants); one service account with
  domain-wide delegation, authorized per tenant by their Workspace admin
  (D19/D25). Validate at sign-in that email domain matches `workspace_domain`.
- Calendar = **projection** of `next_actions` (one-way write unless Q5 changes);
  one secondary calendar per rep owned by the service account; ACLs per
  calendar, no default/domain rules; `next_action_id` in event
  `extendedProperties` (D11/D12/D15).
- Workspace mail is the guaranteed alert channel; Web Push is enhancement only
  (iOS reality, D25 + offline doc §6).

### Infra
- Supavisor (transaction mode) from all Vercel functions.
- Colocate Vercel + Supabase region (west US).
- Vercel Cron **triggers**; Postgres (SQL views, triggers, pg_cron) **does**
  the derivation (D13).

---

## 3. Build order & phase gates

Follow context §6. Do not start a phase before its predecessor's gate passes.

| Phase | Deliverable | Gate to pass before moving on |
|---|---|---|
| **1. Schema + RLS** ← *you are here* | Migration files: enums, all tables (incl. email/candidate tables), check constraints, triggers (stage transitions, Rule 3), RLS policies, `user_hierarchy` strategy, seed script | Cross-tenant leakage suite green in CI; rep/manager/admin/support visibility tests green; constraint tests (D7/D8, stage trigger) green |
| **2. Activity capture + offline layer** | Capture UI (default = one note + follow-up flag, D45; full form optional), `LocalStore`/`SyncEngine`/`BlobStore`/`PushChannel` interfaces, outbox, error tray | Airplane-mode capture → reconnect → exactly-once record; double-fired sync produces no duplicates; stale edit lands in error tray |
| **3. Agenda + exception engine** | Agenda w/ planned-vs-actual (D46), required objective picklist (D48), Friday-deadline exception (D47), all §8 exceptions as SQL views + cron scan | Each exception fires on seeded fixtures and clears when resolved |
| **4. Voice debrief** | Record → outbox → signed-URL upload → transcribe → extract Activity + Next Actions → review gate → fan-out (D9/D10) | No record created without review; pipeline rejoins standard activity flow; offline capture survives |
| **5. Dashboards + weekly review** | Derived views, management dashboard, AI weekly narrative | Pure derivation — zero new writable state |
| **6. Calendar + mail** (parallel w/ 4–5) | Per-rep secondary calendars, next-action projection, `gmail.send` alerts, later Gmail Tier-2 ingestion (D26–D38) | Idempotent event upsert; ACL topology matches RLS hierarchy |

Home screen: two modes on one data model (D54) — quote/email-driven (TJ
archetype) vs agenda/visit-driven (California archetype). Navigation per spec
§9; Home is operational (Today · Quick Actions · My Week · Requires Attention),
never a table dump.

---

## 4. Working conventions for this session

- **Migrations:** numbered SQL files under `supabase/migrations/`; every table
  gets `id uuid pk`, `org_id`, `created_at`, `updated_at` (trigger-maintained —
  it's the LWW version key, D61). Enums as Postgres enum types, except
  lead-source-style lists that D-decisions say may grow via admin promotion —
  prefer a check-constrained text or lookup table there and say which you chose.
- **RLS:** default-deny (`alter table … enable row level security` + explicit
  policies). Every policy includes the org clause *and* the membership check.
  Factor shared predicates into `security definer` helper functions.
- **Tests before features:** the leakage suite and constraint tests are part of
  Phase 1's deliverable, not a follow-up.
- **TypeScript end-to-end;** generate DB types from the schema
  (`supabase gen types`). Zod at the API/outbox boundary.
- **Offline discipline:** any PR/change that imports Dexie outside the
  `LocalStore` implementation is rejected on sight (D55).
- **When something is ambiguous:** check the Decisions Log first; if genuinely
  unresolved, list options + a recommendation and ask — don't invent a D-number.

---

## 5. Open questions — defaults to assume until answered

| Q | Question | Default for now |
|---|---|---|
| Q2 | Who receives voice debrief summaries | Route to the rep's `manager_id` chain; make recipient configurable per org |
| Q3 | AI extraction depth | **Full extraction** into Activity + Next Actions (spec's own recommendation) |
| Q5 | Two-way calendar sync | **One-way write** (Postgres → Calendar) |
| Q6 | Lead-source enum validation vs real leads | Ship the enum as spec'd; keep the admin `OTHER`-promotion path |
| Q7 | Spanish debriefs | Assume yes — make transcription language per-membership config |
| Q8 | `MANUFACTURER_LEAD` applies | Keep it in the enum |
| Q10 | Email monitoring in writing (HR) | Blocker for enabling Gmail ingestion per tenant — not for building it |
| Q12 | `gmail.readonly` delegation vs Google security assessment | Verify before Phase 6 email work goes live |
| Q13 | iOS PWA field reliability | Ship PWA; Capacitor shell only on field-test evidence (D55) |

None of these block Phase 1 DDL.

---

## 6. End-of-session hygiene

Before closing a working session:
1. Append new decisions to the log in `00-PROJECT-CONTEXT.md` (supersede, never
   delete), move resolved questions out of §5 there.
2. Update the **Session state** block in `00-PROJECT-CONTEXT.md`: last updated,
   completed, next up.
3. Leave the repo in a state where `migrations apply + tests` runs green.

**Resume prompt for the next session:**
> Read `CLAUDE-BUILD-SESSION.md` and the three project docs. We're continuing
> the Commercial Operating System build. Last completed: **[X]**. Next: **[Y]**.

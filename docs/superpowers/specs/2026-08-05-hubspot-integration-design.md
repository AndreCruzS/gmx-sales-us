# HubSpot integration — sync bridge design

Date: 2026-08-05
Status: approved in brainstorming (Andre), pending spec review

## Why

GMX management set a development policy: this system must fully integrate with
the company HubSpot account — "the forms we get and the pipeline need to live
there mainly." Clarified with Andre:

- **HubSpot is the source of truth for the deal pipeline.** Deals are the
  record management works from, in HubSpot's UI.
- **"Forms" means our app's forms feed HubSpot.** Everything reps capture
  (accounts, contacts, activities) flows up into HubSpot as the main record.
- **Activities too** — visits, debriefs, notes, and follow-ups appear on
  HubSpot company/deal timelines so managers see the full story there.
- **Reps create and advance deals from our app**, syncing up. The app gains a
  deal write UI (opportunities are read-only today — no create/edit form
  exists anywhere in `src/app`).
- **Portal reality:** one shared GMX Group portal. Other teams (e.g. Lumber
  Plus) have heavy data; the MAXIMO USA team is nearly empty, so we define
  its pipeline and properties — but everything must be team-scoped and must
  not collide with other teams' records.

Approach chosen: **A — sync bridge**. Supabase Postgres stays the app's
operational store and offline substrate (the outbox/RLS/derived-view
architecture is untouched); a server-side sync layer mirrors Supabase and
HubSpot. Rejected: writing to HubSpot directly from the app (guts the offline
outbox, puts HubSpot rate limits in the field path, kills dashboards) and
off-the-shelf iPaaS sync (cannot express the stage gate, referral fan-out,
outbox idempotency, team scoping, or multi-tenancy).

## 1. Object mapping

| Ours | HubSpot | Direction | Notes |
|---|---|---|---|
| `accounts` | Companies | two-way | `parent_account_id` → native parent/child company association. Account type, lead source, display-wall status → custom properties. |
| `contacts` | Contacts | two-way | HubSpot dedupes by email **portal-wide**. If the email already exists (possibly under another team), update/associate — never duplicate. `is_champion` → custom property. Email-less contacts are allowed; identity then rests on our ID mapping. |
| `opportunities` | Deals | two-way, **HubSpot wins** | Dedicated "MAXIMO USA" pipeline, stages mirroring ours 1:1: IDENTIFIED → QUALIFIED → DEVELOPMENT → QUOTE → DECISION → WON / LOST, plus ON_HOLD as a stage. Amount = `estimated_revenue`; close date = `expected_close_date`; `current_status`, `current_blocker`, lead source → custom deal properties. Associated to the primary company and stakeholder contacts. |
| `activities` | Meetings / Calls / Notes | one-way up | Visit-type activities → Meetings, calls → Calls, everything else → Notes. Body carries objective, outcome, and the AI debrief summary. Associated to company, contacts, and deal (when the activity links to an opportunity). |
| `next_actions` | Tasks | one-way up | Assigned to the rep's HubSpot owner, due date carried over, completed in HubSpot when completed in our app. |
| `projects` | — (v1 cut) | — | HubSpot custom objects require Enterprise tier. Deferred until tier confirmed (open question Q-A). Project name rides on the deal name. |

**Team boundary in the shared portal.** Every record we create or adopt gets a
`maximo_managed = true` custom property and a HubSpot owner belonging to the
MAXIMO USA team (owners mapped to our `users` by email). Inbound sync pulls
**only** records carrying that flag; deals are additionally filtered by our
pipeline ID. Lumber Plus data never enters our database; our records are
clearly labeled for them.

## 2. Sync engine

New module `src/lib/hubspot/`, same shape as the Gmail and Calendar
integrations (D55 philosophy — port interface + raw REST adapter + pure core):

- `port.ts` — `HubSpotPort` interface (batch upsert companies/contacts/deals,
  create engagements/tasks, search by modified-since, property/pipeline
  admin calls for setup).
- `hubspot-api.ts` — raw HubSpot REST v3 adapter. Auth: **private-app access
  token** per org, stored in Supabase Vault via `org_integrations`
  (`credential_ref`); portal ID, team ID, pipeline ID, stage-ID map, and
  owner map live in that row's config jsonb. Requires one migration adding
  `hubspot` to the `integration_provider` enum.
- `sync-core.ts` — pure, fixture-testable sync pass: diffing, echo
  suppression, conflict resolution, mapping. No network, no Supabase.
- `supabase-store.ts` — cursor + mapping persistence.
- `src/app/api/hubspot/sync/route.ts` — Vercel cron every 5 minutes,
  `authorization: Bearer ${CRON_SECRET}`, same pattern as `/api/email/sync`.

**Outbound (Supabase → HubSpot).** Cursor poll on `updated_at` of the synced
tables. Records with no `hubspot_id` are created; records with one are
patched. HubSpot batch endpoints (100 records/call). FK order: companies →
contacts → deals → engagements/tasks.

**Inbound (HubSpot → Supabase).** Poll the HubSpot Search API for objects
with `hs_lastmodifieddate` past the cursor, filtered to `maximo_managed`
(deals: our pipeline ID). **Polling, not webhooks** — same rationale as D33
(Gmail): webhooks add a public-endpoint + subscription failure mode not
needed at this volume; 5-minute freshness is fine for field sales. Webhooks
are a clean later upgrade. Inbound writes go through a service-role writer
that stamps org_id and respects all constraints.

**Conflict policy.** Last-writer-wins by timestamp per record, with one
exception: **deal stage, where HubSpot is always authoritative.** A
`last-synced snapshot` of each record's synced properties is stored and used
to suppress echoes — a change we pushed up must not come back down as a
"change" (and vice versa), or the two sides ping-pong.

**Failures and limits.** Backoff on 429s; per-record error state in
`hubspot_sync_state` with the failing payload preserved; sync never blocks or
surfaces in the rep's flow. Admin-facing sync health (pending / error counts,
last successful pass) on the dashboard. Retryable vs. permanent errors follow
the outbox's existing classification philosophy (D62): nothing is silently
dropped.

**Merges and deletes in HubSpot.** A merged contact remaps our `hubspot_id`
to the surviving record. A deletion in HubSpot never deletes our record — the
link is marked broken and surfaces as an admin exception to resolve.

## 3. The stage gate survives

The DB refuses any deal stage without `current_status` and an open
`next_actions` row (operating rule 3, enforced by the deferrable trigger in
`20260722000600_loop.sql`; WON/LOST exempt). HubSpot must not erode this:
when a stage change arrives from HubSpot, the inbound writer applies it in
one transaction that auto-creates a next action — kind `OTHER`, title
"Review deal — stage changed in HubSpot", due in 2 days, owned by the deal's
rep — **only if no open next action exists**. The gate stays satisfied, the
`opportunity_stage_events` log keeps recording (its trigger fires on any
stage change), and the rep gets a to-do instead of the pipeline moving
silently under them.

## 4. Deal UI in the app (new)

Opportunities gain a write path — required by the mandate, and also the
missing piece of our own model:

- **Create deal** from the account page. Fields: name, stage (default
  IDENTIFIED), estimated revenue, expected close date, current status
  (required), and a **required first next action** (kind + date). The form
  bundles the action because the DB gate demands both at commit. Outbox: new
  `opportunity` entity whose create payload **embeds the first next action**;
  the sync backend replays it via a new Postgres function
  (`create_opportunity_with_action`, SECURITY INVOKER so RLS applies) that
  inserts both rows in one transaction — the generic per-op outbox replay
  cannot span two inserts atomically.
- **Advance stage** from the deal card on the account page: a stage picker;
  if no open next action exists, the UI requires one before saving ("what's
  the next action?") — rule 3 enforced at edit time, mirroring the gate at
  commit time. Stage updates ride the existing `update`/`baseVersion` LWW
  path.
- Lead-source rules D6–D8 apply in the form exactly as they do for accounts
  (OTHER requires detail; referral sources require the referring account).
- **No kanban board in the app.** HubSpot's pipeline board is that surface
  now. Our dashboards (`dashboard_pipeline` etc.) keep working unchanged —
  Postgres still holds everything.

## 5. Schema changes (one migration + type/schema updates)

- `hubspot_id text` on `accounts`, `contacts`, `opportunities`, `activities`,
  `next_actions` — nullable, unique per org where not null.
- `hubspot_sync_state` table: org-scoped cursors (outbound per table, inbound
  per object type), per-record error rows (entity ref, failing payload,
  error, retry count), and last-synced property snapshots for echo
  suppression. RLS: admin-read, service-role write.
- `hubspot` added to the `integration_provider` enum.
- `create_opportunity_with_action(...)` function (SECURITY INVOKER).
- App layer: `opportunity` added to `ENTITY_TABLES` and
  `outboxPayloadSchemas` (`src/lib/domain/schemas.ts`) with
  `opportunityCreateSchema` (embedding the first action) and
  `opportunityUpdateSchema`; regenerate `database.types.ts`.

## 6. Portal setup & backfill (one-time, scripted, dry-run first)

1. GMX's HubSpot super-admin creates the private app and grants scopes
   (crm.objects.{companies,contacts,deals}.{read,write},
   crm.schemas.*.read, crm.objects.owners.read, plus engagements/tasks
   scopes — exact list finalized during implementation) and hands us the
   token; stored via `org_integrations`/Vault.
2. Setup script (admin API route or `scripts/`, idempotent): create the
   MAXIMO USA pipeline + stages, the custom properties
   (`maximo_managed`, account type, lead source, status, blocker,
   champion, display-wall), verify every active membership's email resolves
   to a HubSpot owner on the MAXIMO USA team; write the resulting ID maps
   into the org's integration config.
3. Backfill: push existing accounts → contacts → opportunities in FK order.
   Contacts are searched by email first; portal-wide matches are **adopted**
   (updated + flagged + associated), never duplicated. Dry-run mode prints
   the full plan (creates / adopts / skips) before any write.

## 7. Testing

- **Fixture tests on `sync-core`** (vitest, hermetic — the Gmail pattern):
  echo suppression both directions, LWW conflicts, HubSpot-wins-on-stage,
  stage-gate next-action injection, contact-merge remapping, team-boundary
  filtering (a non-`maximo_managed` record never enters), 429/backoff
  classification, FK-ordered batching.
- **pgTAP**: migration shape, `hubspot_id` uniqueness per org,
  `create_opportunity_with_action` satisfies the gate and RLS, sync-state
  RLS posture.
- **Vitest on the outbox**: `opportunity` entity validation + replay.
- **Live smoke** against a HubSpot developer sandbox portal before the real
  portal: setup script, one full round-trip (create in app → appears in
  HubSpot; stage-drag in HubSpot → arrives in app with the auto next
  action), backfill dry-run.

## 8. Multi-tenancy

Nothing HubSpot-specific is hardcoded: token, portal, team, pipeline, stage
and owner maps are all per-org in `org_integrations`. MAXIMO USA is the first
configured tenant.

## Open questions (carried, non-blocking)

- **Q-A: Portal tier** (Pro vs Enterprise) — decides whether `projects` can
  become a custom object later, and whether association labels are available
  for role FKs (distributor/dealer/architect on deals) and referral edges.
  V1 syncs only the primary company association on deals.
- **Q-B: Who is the HubSpot super-admin** for the private app + property
  creation, and what's the lead time?
- **Q-C: Shared-contact etiquette** — when an email collides with another
  team's contact, we adopt and co-own. Confirm GMX is fine with cross-team
  shared contact records (this is HubSpot's native model, but it's a people
  agreement, not a technical one).

## Explicit v1 cuts (YAGNI)

- No webhooks (polling first; upgrade path noted).
- No projects sync (Q-A).
- No deal role-FK / referral association labels (Q-A).
- No kanban in the app.
- No HubSpot → app form-lead ingestion (out of scope per Andre — "forms"
  means our forms feeding HubSpot; revisit if marketing forms enter the
  picture).
- `account_relationships` (the commercial network) stays app-only — HubSpot
  has no portable equivalent below custom objects.

# HubSpot sync bridge — go-live checklist

Manual steps for turning on the HubSpot bridge for a real org. Nothing here
is covered by an automated test — that's exactly why it's a checklist.
Everything the code can verify (mapping, cursors, replay-safety, RLS) is
already proven by `npm test` (202) + `npx supabase test db` (153 across 12
suites); see the Task 14 gate record in
`.superpowers/sdd/2026-08-05-hubspot-sync-bridge/task-14-report.md`.

Spec: `docs/superpowers/specs/2026-08-05-hubspot-integration-design.md`
Plan: `docs/superpowers/plans/2026-08-05-hubspot-sync-bridge.md`

---

## 1. Create the HubSpot private app

Someone with **super-admin** access to the GMX HubSpot portal (Q-B in the
spec — confirm who that is and their lead time before scheduling this)
creates a private app:

1. HubSpot → Settings → Integrations → Private Apps → Create a private app.
2. Name it something identifiable, e.g. `GMX Sales System — <org>`.
3. Grant these scopes (exact names shift in the scope picker across
   HubSpot releases — verify against what's actually offered, don't
   assume the labels below are verbatim):
   - `crm.objects.companies.read`, `crm.objects.companies.write`
   - `crm.objects.contacts.read`, `crm.objects.contacts.write`
   - `crm.objects.deals.read`, `crm.objects.deals.write`
   - `crm.objects.owners.read`
   - `crm.schemas.companies.read`, `crm.schemas.contacts.read`,
     `crm.schemas.deals.read` (property/schema introspection — the setup
     pass calls `ensureProperty`/`ensureDealPipeline`, which need these)
   - Engagement scopes, read + write: notes, meetings, calls, tasks
     (`crm.objects.notes`, `crm.objects.meetings`, `crm.objects.calls`,
     `crm.objects.tasks` — again, verify exact scope names in the picker)
   - Pipelines: read + write (deal pipeline / stage creation)
4. Create the app, copy the generated access token immediately — HubSpot
   shows it once.

## 2. Store the token

The app never sees a raw token in an env var; it goes through Supabase
Vault + `org_integrations`, same pattern as the other per-org integrations
(D20).

1. Insert the Vault secret, named `hubspot-<org-slug>` (e.g.
   `hubspot-maximo-usa`) — this exact name becomes `credential_ref`:

   ```sql
   select vault.create_secret(
     '<the private-app token>',
     'hubspot-<org-slug>'
   );
   ```

2. Insert (or update) the `org_integrations` row for that org:

   ```sql
   insert into org_integrations (org_id, provider, credential_ref, status)
   values ('<org uuid>', 'hubspot', 'hubspot-<org-slug>', 'active')
   on conflict (org_id, provider) do update
     set credential_ref = excluded.credential_ref,
         status = 'active';
   ```

   `config` (pipeline id, stage map, owner map) is populated by the setup
   call in the next step — leave it as the default `{}` here.

## 3. Run setup: dry-run → review → live

The admin route (`src/app/api/hubspot/admin/route.ts`) is POST-only,
authenticated with the same `CRON_SECRET` bearer token the cron routes use
— no rep session ever reaches it. `maxDuration = 300`.

Dry-run first — it makes zero writes to HubSpot (property/pipeline creation
are recorded, not sent) and zero writes to `org_integrations.config`:

```bash
curl -X POST https://<app-domain>/api/hubspot/admin \
  -H "authorization: Bearer $CRON_SECRET" \
  -H "content-type: application/json" \
  -d '{"action":"setup","org_id":"<org uuid>","dry_run":true}'
```

Review the response: `would_write.pipeline_label`, `would_write.stage_map`
(should cover all 8 stages — Identified, Qualified, Development, Quote,
Decision, Won, Lost, On hold), `would_write.owner_map`, and
`unmatched_memberships` (active reps with no matching HubSpot owner email —
expected for reps without a HubSpot seat, but worth eyeballing for typos).

Then run it live (creates the `MAXIMO USA` pipeline + all 8 stages + every
company/contact/deal property in `src/lib/hubspot/properties.ts`, and
writes `pipeline_id` / `stage_map` / `owner_map` into
`org_integrations.config`):

```bash
curl -X POST https://<app-domain>/api/hubspot/admin \
  -H "authorization: Bearer $CRON_SECRET" \
  -H "content-type: application/json" \
  -d '{"action":"setup","org_id":"<org uuid>","dry_run":false}'
```

Confirm the response's `config` block matches what the dry run promised.

## 4. Association-type verification (the one hardcoding risk)

The bridge associates a branch account to its banner/parent
(`parent_account_id`, D49) using HubSpot's **default** association endpoint:

```
PUT /crm/v4/objects/companies/{fromId}/associations/default/companies/{toId}
```

(`src/lib/hubspot/hubspot-api.ts`, `associateDefault`; called from
`src/lib/hubspot/run-sync.ts`'s `syncOutboundAccounts`, with `hsId` = the
branch/child and `parentHsId` = the banner/parent — i.e. we call it
child→parent and assume HubSpot's *default* company↔company association
type preserves that direction.)

**Before the live backfill**, in the sandbox portal:

1. Sync one branch account with a `parent_account_id` set (or trigger it
   via backfill on a single test account).
2. In HubSpot, open the child company record → Associated Companies. Confirm
   the parent company shows up labeled as the **parent**, not the child.
3. If HubSpot's default direction is flipped (parent record shows the child
   as its "parent" instead), the default endpoint is not safe to rely on.
   Switch `associateDefault`'s company→company call to the v4 **labeled**
   endpoint with an explicit `associationTypeId`:
   - `14` = Company to Company (Parent Company — used on the *child's*
     association record, i.e. "this company's parent is...")
   - `13` = Company to Company (Child Company — used on the *parent's*
     association record, i.e. "this company's child is...")

   (`PUT /crm/v4/objects/companies/{fromId}/associations/companies/{toId}`
   with body `[{"associationCategory":"HUBSPOT_DEFINED","associationTypeId":14}]`
   called from the child.)
4. **Record which path was used** (default vs. typed 13/14) here, in this
   file, once verified against the real portal — this is a note for
   whoever runs the next org's go-live, not a decision to make twice:

   > _Verified: ☐ default direction correct as-is ☐ switched to typed
   > `associationTypeId: 14` on the child — filled in during go-live._

## 5. Backfill: dry-run → review → live

Same dry-run-first discipline. Backfill is "outbound sync with a null
cursor" — it walks every account/contact/opportunity, not just what changed
since the last cursor, since nothing has synced yet.

```bash
curl -X POST https://<app-domain>/api/hubspot/admin \
  -H "authorization: Bearer $CRON_SECRET" \
  -H "content-type: application/json" \
  -d '{"action":"backfill","org_id":"<org uuid>","dry_run":true}'
```

Review `streams.accounts` / `streams.contacts` / `streams.opportunities` —
each reports `would_create`, `would_patch`, `would_echo`, and a `sample` of
the first 10 planned items (flagged `adopt` where an existing HubSpot
contact matched by email will be linked rather than duplicated). Check
`streams.opportunities.mapping_errors` for any row whose `stage` didn't
resolve through `stage_map` (would mean setup's stage_map is incomplete).

**Do not run the live backfill until §7 (Lumber Plus shared-contact
etiquette) is confirmed.**

Then live:

```bash
curl -X POST https://<app-domain>/api/hubspot/admin \
  -H "authorization: Bearer $CRON_SECRET" \
  -H "content-type: application/json" \
  -d '{"action":"backfill","org_id":"<org uuid>","dry_run":false}'
```

Response includes `contacts_adopted` (existing HubSpot contacts linked by
email match) and per-stream `succeeded`/`errors` counts. Any errors land in
`hubspot_sync_errors` (§8) — check that table, don't rely on the HTTP
response alone.

## 6. One full round-trip on the sandbox portal

Before calling it live, prove all three directions end to end:

1. **App → HubSpot:** create a deal in the app for a test account. Confirm
   it appears in HubSpot under the **MAXIMO USA** pipeline, correct stage.
2. **HubSpot → App:** in HubSpot, drag that deal to a different stage.
   Within 5 minutes (the cron cadence, §8 below) the app should show the
   new stage on the opportunity, and a "Review deal" item should appear
   (the auto-generated next action HubSpot-side stage moves create).
3. **Activity → HubSpot:** log an activity (note) against the test account
   in the app. Confirm it lands as a note on the company's timeline in
   HubSpot.

## 7. Q-C — confirm shared-contact etiquette with Lumber Plus

Per spec §"Open questions": when an email address collides with a contact
another HubSpot team already owns, this bridge **adopts and co-owns** it —
that's HubSpot's native contact model, not something the sync invents, but
it's a people agreement, not a technical one. **Confirm with the Lumber
Plus team, in writing, before the live backfill runs** — a stocking-dealer
contact backfilled from our side will visibly show up owned/co-owned in
their pipeline too. If they want a different model (e.g. do-not-adopt),
that's a scope change to `findContactAdoptionTargets`
(`src/app/api/hubspot/admin/route.ts`) — raise it before backfill, not
after contacts have already merged.

---

## 8. Operational reference

### Cron cadence

`vercel.json`: `/api/hubspot/sync` runs every 5 minutes (`*/5 * * * *`),
GET+POST (Vercel Cron calls GET; the route also accepts POST for manual
triggering with the same `CRON_SECRET` bearer auth). It walks every org
with an `active` `hubspot_sync_errors`/`org_integrations` row — no
`org_id` in the cron call, unlike the admin route.

### Where sync health surfaces

- **Dashboard card** (`src/app/dashboard/page.tsx`, "HubSpot sync"):
  manager/admin only, and only rendered once `/api/hubspot/health` reports
  `configured: true` for the caller's org. Shows either "N changes need
  attention" (unresolved `hubspot_sync_errors` rows) or "Up to date · last
  pass <time>".
- **`hubspot_sync_errors` table**: the durable record. RLS is on with zero
  policies — only `service_role` reads it directly; the health route is the
  one place a browser session can see a rollup of it (role-gated to
  manager/admin). Every outbound and inbound failure lands here with
  `direction`, `entity_type`, `entity_id`, `payload`, and `error` — check
  this table directly (via Studio or the service role) when debugging,
  don't rely on the dashboard card alone.
- **`hubspot_sync_cursors`**: per-org, per-stream (`out:accounts`,
  `out:contacts`, `out:deals`, `in:deals`, etc.) high-water mark. If a
  stream looks stuck, this is the first table to check.

### Admin route quick reference

Base: `POST /api/hubspot/admin`, header `authorization: Bearer $CRON_SECRET`,
body `{"action": "setup" | "backfill", "org_id": "<uuid>", "dry_run": true | false}`.
See §3 and §5 above for full examples. `dry_run` defaults to `false` if
omitted — always pass it explicitly.

### Runbook: crash between HubSpot create and local link (rare)

Outbound sync creates the HubSpot object first (`batchCreate`), then links
it locally (`linkHubspotId`, which stores the returned `hubspot_id` on the
local row). If the process crashes, times out, or the network drops
**between** those two steps, the local row is left with no `hubspot_id`
even though the HubSpot object now exists. The next sync pass has no way to
know that — it still sees an unlinked local row and will create a **second**
HubSpot object for it, producing a duplicate.

This is rare (a narrow crash window) and does not corrupt data — it's
purely a HubSpot-side duplicate.

- **Detection:** two HubSpot objects with the same name/email pointing at
  what should be one local record; or a manual check of
  `hubspot_sync_errors` around the time of a deploy/restart.
- **Resolution:** merge the two objects in the HubSpot UI (standard HubSpot
  merge). The sync bridge already handles merges correctly on replay — a
  merge remaps to the surviving HubSpot id
  (`loadLinksByHubspotId`/Task 9 rule 4), so no code change or manual DB
  surgery is needed. Just merge and let the next pass reconcile.
- **Scope:** this is an outbound (app → HubSpot) failure mode. The inbound
  equivalent (HubSpot deal → local opportunity) already has a replay guard
  (`createDealFromHubSpot` checks for an existing `hubspot_id` link before
  creating) — see task-11 finding F5.

---

## 9. Explicit v1 cuts (carried from spec, not go-live blockers)

- No webhooks — polling only (5-min cron cadence is the real-world latency
  bound; the round-trip test in §6 exercises this).
- No projects sync, no deal role-FK / referral association labels — gated
  on Q-A (portal tier: Pro vs Enterprise). Revisit if the tier changes.
- No kanban in the app.
- No HubSpot → app form-lead ingestion.

# Database — Phase 1 (Schema + RLS)

Migrations, seed and pgTAP suites for the Commercial Operating System schema.
Design authority: `00-PROJECT-CONTEXT.md` (Decisions Log D1–D62),
`01-TECHNICAL-SPEC.md`, `02-OFFLINE-MOBILE-ARCHITECTURE.md`.

## Running

```bash
npx supabase db start   # local Postgres + migrations + seed
npx supabase test db    # pgTAP suites (the Phase 1 gate)
npx supabase db reset   # re-apply from scratch
```

CI runs the same two commands on every push/PR (`.github/workflows/db-tests.yml`).

## Migration map

| File | Contents |
|---|---|
| `…000100_extensions` | pg_trgm, `private` schema, `set_updated_at()` |
| `…000200_enums` | all enum types; `lead_source_value` domain; referral-set helper |
| `…000300_tenancy` | organizations, org_integrations (D20 Vault refs) |
| `…000400_identity` | users, territories, memberships, support_assignments (D53), user_hierarchy closure + triggers |
| `…000500_crm` | accounts (D6–D8, D49–D52), contacts, account_relationships (D4) |
| `…000600_loop` | projects (D5), opportunities, activities (D45/D46), joins, next_actions, stage gate |
| `…000700_intake` | voice_captures (D9/D10), contact_candidates (D39–D44) |
| `…000800_email` | email_threads/messages/attachments, sync state, exclusions (D26–D38) |
| `…000900_rls_helpers` | `private.*` security definer helpers |
| `…001000_rls_policies` | default-deny RLS on every table |
| `…001100_storage` | voice/cards/email buckets + storage RLS (D21/D38/D42) |
| `…001200_indexes` | RLS/agenda/dedupe indexes |

## Implementation decisions made in this phase

These implement locked D-numbers; none contradicts the Decisions Log. Flagged
here for review (details in `docs/superpowers/plans/2026-07-22-phase1-schema-rls.md`):

1. **Ownership is membership-scoped** — `owner_id`/`created_by` FKs point at
   `memberships(id)`, not `users(id)` (consistent with D22; the manager chain
   lives on memberships). RLS resolves `auth.uid()` → active membership.
2. **`user_hierarchy` = closure table** (self at depth 0), rebuilt per-org by
   trigger on memberships, cycle-guarded. Spec §4's "materialized table"
   option, chosen over per-query recursive CTEs.
3. **Stage gate is a deferred constraint trigger**; WON/LOST exempt from the
   open-next-action requirement (a closed deal needs no next action); ON_HOLD
   still requires one. `current_status` required at every stage incl. terminal.
4. **Rule 3 for activities = app guard + Phase 3 exception view** (spec §3
   explicitly allows this); a hard insert trigger would break D45's
   one-note-plus-flag capture. Data support: `activities.follow_up_required`,
   `next_actions.activity_id`.
5. **`lead_source` is a check-constrained text domain**, not an enum — the
   admin `OTHER`-promotion path (Q6) makes promotion a 2-line migration.
6. **LWW rejection (D61) is client protocol**: outbox updates filter on
   `updated_at = base_version`; 0 rows affected ⇒ conflict ⇒ error tray. The
   DB provides the trigger-maintained `updated_at` only.
7. **No `FORCE ROW LEVEL SECURITY`** — the security definer helpers/triggers
   run as table owner and must bypass RLS (forcing it would recurse policies);
   clients only ever hold `anon`/`authenticated`; `service_role` bypasses via
   its BYPASSRLS attribute.
8. **Deletes are admin-only on record-of-truth tables** (record once → history
   is an asset). Owners can delete only queue/draft items (voice_captures,
   contact_candidates) and activity join rows.
9. **Proposed enum values** for fields the spec names without values
   (`strategic_importance`, `relationship_status`, `influence_level`,
   relationship `strength`/`status`, `project_status`, candidate/email
   statuses) — validate with the client alongside Q6's lead-source check.

## Test suites (`supabase/tests`)

| Suite | Asserts |
|---|---|
| `01_schema` | RLS enabled on every table; `org_id` + `updated_at` trigger everywhere |
| `02_leakage` | cross-tenant: zero foreign rows on every org_id table, filtered + unfiltered, both directions; tampered claim (no membership) sees nothing (D24); non-vacuous controls |
| `03_visibility` | rep own-rows + territory; no peer visibility; manager chain; admin org-wide; support read/write for assigned reps only (D53) |
| `04_constraints` | D7/D8 on accounts + opportunities; domain rejection; relationship self-ref/dupes; one champion (D50); org-scoped uniques; D48 objective detail; manager-cycle guard |
| `05_stage_trigger` | deferred gate: insert w/o next action fails; same-txn pair passes; missing current_status fails; advance w/o open action fails; WON/LOST exempt |

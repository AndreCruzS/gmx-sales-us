-- Take my fixtures out of the client's live system.
--
-- Andre asked what the $180,000 "Open pipeline" was and whether it was hardcoded.
-- It was not hardcoded, which is worse: dashboard_pipeline is a real view summing
-- real rows, and the row it was summing was one I invented — "Tower —
-- Thermo-Ayous Cladding", $180,000, against a contractor called ABC
-- Construction. It was not alone. Development fixtures were loaded into the live
-- project on 12 August and have been furnishing that dashboard ever since:
--
--   1  opportunity        the $180,000 Tower deal
--   1  project            "Anaheim Mixed-Use Tower", with 2 stakeholders
--   3  contacts           Mike Torres, Sam Lee, Paula Ortiz — all @*.example
--   2  activities         a dealer visit and a PK training that never happened
--   7  next actions       which is where "4 of 6 planned visits" came from
--   1  email thread       from mike.torres@ganahl.example, gmail id msg_gmx_001
--   1  voice capture      pending review, of nothing
--  18  exception snapshots  the whole "What's slipping" list, including one still
--                           naming "Ganahl Orange", an account I later renamed
--                           because Ganahl has no Orange yard
--   2  account relationships  a referral and a purchases-from I made up
--   1  contractor account  ABC Construction
--
-- The client is going to look at this and expect what they see to be true. A
-- manager's home page asserting $180,000 of open business and four completed
-- visits is not a slightly-stale figure, it is a claim about work nobody did.
--
-- WHAT STAYS, and why each one earns it:
--
-- · THE SELL-THROUGH. 186 rows, 83,153 LF, Boise Cascade's real July. This is the
--   only data in the system that came from the client, and the reason the rest of
--   it has to go.
-- · THE DEALER AND DISTRIBUTOR ACCOUNTS. Ganahl Lumber (Banner) already carries
--   18,564 LF of that real volume; deleting it would take the attribution with
--   it. Ganahl Anaheim, Ganahl Buena Park and Buffalo Lumber Co are real
--   companies rather than invented ones, and 64,590 LF of the file is still
--   unmatched — they are candidates for it, not clutter. ABC Construction is the
--   one account here that is genuinely fictional, so it is the one that goes.
-- · THE TERRITORY MAP, its regions, its states, and the three Market Owners. All
--   of it is the client's own document.
--
-- WHAT I HAVE NOT TOUCHED, deliberately, because it is not mine to decide:
-- the five user accounts and their memberships. Bianca, João and Deonn are real
-- people; tj@ and eric@ came out of the same seed as everything above and may
-- well be nobody. Removing a login is a different kind of change from removing a
-- fake deal, and it needs Andre to say so.
--
-- ── Two safety properties, both deliberate ─────────────────────────────────
--
-- CUTOFF, NOT "EVERYTHING". Every delete is bounded by created_at < 2026-08-13 —
-- after the fixture load on the 12th and before anything real. If somebody starts
-- entering genuine work while this is being written, their work survives. A
-- migration that emptied these tables outright would be a worse bug than the one
-- it fixes.
--
-- NO-OP LOCALLY, BY CONSTRUCTION. Migrations run against an EMPTY database before
-- seed.sql, so all of this deletes nothing on `supabase db reset` and the seed
-- then puts the fixtures back. Development keeps its furniture; production does
-- not. That is the same property every reference-data migration in this repo
-- relies on, used in the opposite direction for once.
--
-- Order is children-before-parents throughout: some of these FKs cascade and most
-- do not, and relying on the ones that happen to would break the first time a
-- column changed.
--
-- AND THERE IS A CYCLE, which I found by running this against a seeded database
-- rather than by reading the schema. activities.planned_action_id points at
-- next_actions and next_actions.activity_id points back at activities — a
-- planned visit and the visit that happened are each other's context. No delete
-- order can satisfy both, so the two links are nulled first and the rows deleted
-- after. voice_captures.planned_action_id is the same shape.

do $$
declare
  org  uuid := '11111111-1111-1111-1111-111111111111';
  -- After the fixture load, before any real work.
  cut  timestamptz := '2026-08-13 00:00:00+00';
  n    integer;
  gone jsonb := '{}'::jsonb;
begin
  -- ── Break the cycle before deleting anything ──────────────────────────────
  --
  -- A planned action and the activity that fulfilled it reference each other, so
  -- there is no order that works. Nulling first is not a workaround: these rows
  -- are all about to go, and the link is the only thing standing between them.
  update activities set planned_action_id = null
   where org_id = org and created_at < cut and planned_action_id is not null;
  update voice_captures set planned_action_id = null
   where org_id = org and created_at < cut and planned_action_id is not null;
  update next_actions set activity_id = null
   where org_id = org and created_at < cut and activity_id is not null;

  -- ── Join tables and leaves ────────────────────────────────────────────────
  --
  -- These reference two parents each, so neither parent's cascade covers them.
  delete from activity_contacts ac
   where exists (select 1 from activities a
                  where a.id = ac.activity_id and a.org_id = org and a.created_at < cut);
  get diagnostics n = row_count; gone := gone || jsonb_build_object('activity_contacts', n);

  delete from activity_accounts aa
   where exists (select 1 from activities a
                  where a.id = aa.activity_id and a.org_id = org and a.created_at < cut);
  get diagnostics n = row_count; gone := gone || jsonb_build_object('activity_accounts', n);

  delete from opportunity_stage_events where org_id = org and created_at < cut;
  get diagnostics n = row_count; gone := gone || jsonb_build_object('opportunity_stage_events', n);

  delete from email_attachments where org_id = org and created_at < cut;
  get diagnostics n = row_count; gone := gone || jsonb_build_object('email_attachments', n);
  delete from email_messages where org_id = org and created_at < cut;
  get diagnostics n = row_count; gone := gone || jsonb_build_object('email_messages', n);
  delete from email_threads where org_id = org and created_at < cut;
  get diagnostics n = row_count; gone := gone || jsonb_build_object('email_threads', n);

  delete from contact_candidates where org_id = org and created_at < cut;
  get diagnostics n = row_count; gone := gone || jsonb_build_object('contact_candidates', n);

  -- Before activities: voice_captures.activity_id points at one.
  delete from voice_captures where org_id = org and created_at < cut;
  get diagnostics n = row_count; gone := gone || jsonb_build_object('voice_captures', n);

  -- A snapshot, not a record: whatever is true gets recomputed. Every row in here
  -- today describes an account going quiet or a deal not followed up, which is a
  -- story about activity that did not happen.
  delete from exception_snapshots where org_id = org and created_at < cut;
  get diagnostics n = row_count; gone := gone || jsonb_build_object('exception_snapshots', n);

  delete from account_relationships where org_id = org and created_at < cut;
  get diagnostics n = row_count; gone := gone || jsonb_build_object('account_relationships', n);

  delete from project_stakeholders ps
   where exists (select 1 from projects p
                  where p.id = ps.project_id and p.org_id = org and p.created_at < cut);
  get diagnostics n = row_count; gone := gone || jsonb_build_object('project_stakeholders', n);

  delete from account_rollout where org_id = org and created_at < cut;
  get diagnostics n = row_count; gone := gone || jsonb_build_object('account_rollout', n);

  -- ── Now the parents, innermost first ──────────────────────────────────────
  delete from next_actions where org_id = org and created_at < cut;
  get diagnostics n = row_count; gone := gone || jsonb_build_object('next_actions', n);

  delete from activities where org_id = org and created_at < cut;
  get diagnostics n = row_count; gone := gone || jsonb_build_object('activities', n);

  delete from opportunities where org_id = org and created_at < cut;
  get diagnostics n = row_count; gone := gone || jsonb_build_object('opportunities', n);

  delete from projects where org_id = org and created_at < cut;
  get diagnostics n = row_count; gone := gone || jsonb_build_object('projects', n);

  delete from contacts where org_id = org and created_at < cut;
  get diagnostics n = row_count; gone := gone || jsonb_build_object('contacts', n);

  -- ── The one account that is a placeholder rather than a company ───────────
  --
  -- By id AND by name, so this can never reach a real account somebody creates
  -- later. No cascade: a foreign key refusing here means I misread the graph, and
  -- stopping is the right outcome.
  delete from accounts
   where id = 'd0000000-0000-0000-0000-000000000004'
     and org_id = org
     and name = 'ABC Construction';
  get diagnostics n = row_count; gone := gone || jsonb_build_object('accounts', n);

  raise notice 'demo data removed: %', gone::text;
end
$$;

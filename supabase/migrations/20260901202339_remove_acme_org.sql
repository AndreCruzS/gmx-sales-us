-- The other tenant leaves the building.
--
-- The 2026-08-17 remove_demo_data migration took the dev fixtures out of
-- GMX USA (org 1111…) — but the seed had planted a SECOND org entirely:
-- "Acme Building Products" (org 2222…), the leakage-test tenant, with its own
-- two logins (alex@acme.test, riley@acme.test), territory ("Acme Metro"),
-- two accounts (Acme Dealer Central, Acme Contractor LLC), a contact, an
-- opportunity, a project, an activity, a next action, a voice capture, an
-- email thread and six exception snapshots. That org existed so the RLS test
-- suite could prove tenant isolation; in production it is furniture from a
-- play nobody is staging. Andre asked (2026-09-01) for only real data to
-- remain, so the whole tenant goes.
--
-- Also swept, in GMX USA itself:
-- · exception_snapshots whose subject is a membership that no longer exists
--   ("TJ Rep" — removed when the roster was fixed on 2026-08-28; three
--   NEXT_WEEK_NOT_PLANNED rows still point at the ghost)
-- · one voice capture from 2026-08-17, "BI Test Profile", already DISCARDED —
--   a mic test, not a visit.
--
-- WHAT STAYS: everything real. The sell-through (825 rows), the dealer and
-- distributor accounts (Ganahl ×3 carries real attribution; Boise Cascade and
-- Hardwoods Specialty are the client's distributors), the territory map, the
-- seven real logins — and today's first genuine rep work (Jason's Big Creek
-- Lumber debrief, its next action, its voice capture). The engine's exception
-- history about real subjects also stays: it is a true record of true silence.
--
-- Same two safety properties as remove_demo_data:
-- · GUARDED, NOT BLIND. The org-wide deletes only run if org 2222 still
--   answers to the fixture's exact name; the login deletes require the login
--   to hold no membership anywhere.
-- · NO-OP LOCALLY, BY CONSTRUCTION. Migrations run against an empty database
--   before seed.sql, so `supabase db reset` deletes nothing and the seed then
--   rebuilds Acme for the leakage tests. Development keeps its second tenant;
--   production loses it.

do $$
declare
  acme uuid := '22222222-2222-2222-2222-222222222222';
  gmx  uuid := '11111111-1111-1111-1111-111111111111';
  n int; gone jsonb := '{}'::jsonb;
begin
  if exists (select 1 from organizations
              where id = acme and name = 'Acme Building Products') then

    -- The same reference cycle remove_demo_data found: a planned action and
    -- the activity that fulfilled it point at each other. Null first.
    update activities     set planned_action_id = null where org_id = acme;
    update voice_captures set planned_action_id = null where org_id = acme;
    update next_actions   set activity_id       = null where org_id = acme;

    -- Children before parents; every delete bounded by the org.
    delete from exception_snapshots      where org_id = acme;
    get diagnostics n = row_count; gone := gone || jsonb_build_object('exception_snapshots', n);
    delete from opportunity_stage_events where org_id = acme;
    get diagnostics n = row_count; gone := gone || jsonb_build_object('opportunity_stage_events', n);
    delete from email_attachments        where org_id = acme;
    delete from email_messages           where org_id = acme;
    delete from email_threads            where org_id = acme;
    delete from email_sync_state         where org_id = acme;
    delete from org_email_exclusions     where org_id = acme;
    delete from contact_candidates       where org_id = acme;
    delete from voice_captures           where org_id = acme;
    delete from account_relationships    where org_id = acme;
    delete from project_stakeholders     where org_id = acme;
    delete from account_rollout          where org_id = acme;
    delete from next_actions             where org_id = acme;
    delete from activities               where org_id = acme;
    delete from opportunities            where org_id = acme;
    delete from projects                 where org_id = acme;
    delete from contacts                 where org_id = acme;
    delete from accounts                 where org_id = acme;
    get diagnostics n = row_count; gone := gone || jsonb_build_object('accounts', n);
    delete from user_hierarchy           where org_id = acme;
    delete from support_assignments      where org_id = acme;
    delete from memberships              where org_id = acme;
    get diagnostics n = row_count; gone := gone || jsonb_build_object('memberships', n);
    delete from territory_states ts using territories t
      where t.id = ts.territory_id and t.org_id = acme;
    delete from territories              where org_id = acme;
    delete from org_integrations         where org_id = acme;

    -- The two fixture logins — only while they hold no membership anywhere,
    -- so this can never take a real person's login with it.
    update users set last_active_org_id = null where last_active_org_id = acme;
    delete from public.users u
     where u.email in ('alex@acme.test', 'riley@acme.test')
       and not exists (select 1 from memberships m where m.user_id = u.id);
    get diagnostics n = row_count; gone := gone || jsonb_build_object('users', n);
    delete from auth.users u
     where u.email in ('alex@acme.test', 'riley@acme.test')
       and not exists (select 1 from public.users p where p.id = u.id);

    delete from organizations where id = acme;
    get diagnostics n = row_count; gone := gone || jsonb_build_object('organizations', n);
  end if;

  -- GMX USA: snapshots about ghosts. The exceptions the app shows are computed
  -- live from the exception_* views, so these rows are history only — but
  -- history about a membership that never belonged to a person is not history.
  delete from exception_snapshots s
   where s.org_id = gmx
     and s.subject_type = 'membership'
     and not exists (select 1 from memberships m where m.id = s.subject_id);
  get diagnostics n = row_count; gone := gone || jsonb_build_object('ghost_membership_snapshots', n);

  -- The mic test. Already DISCARDED by its own author; by id, org and status
  -- so it can never touch a real capture.
  delete from voice_captures
   where id = 'a036092b-f13f-402a-bca0-f1fa0591196c'
     and org_id = gmx and status = 'DISCARDED';
  get diagnostics n = row_count; gone := gone || jsonb_build_object('test_voice_capture', n);

  raise notice 'acme org removed: %', gone::text;
end
$$;

-- Phase 5 tests · 08: dashboards + weekly review (spec §15/§16).
-- Gate: pure derivation, RLS-scoped — one view serves rep, manager and admin,
-- each seeing exactly their own slice.
--
-- Seed reference (org1 = gmx-us):
--   Deon  c0…004, SoCal   — owns opportunity f0…0001 (180k, IDENTIFIED),
--                            next actions f1…0001 (+7d) and f1…0002 (today),
--                            activity ac…0002 (planned, links f1…0002)
--   TJ    c0…003, Buffalo — activity ac…0001 (unplanned, yesterday)
--   org2  = acme-test     — Riley owns opportunity f0…0002 (45k)
begin;
create extension if not exists pgtap with schema extensions;

select plan(24);

-- ── Stage events (D64) ─────────────────────────────────────────────

select is(
  (select count(*)::int from opportunity_stage_events
    where opportunity_id = 'f0000000-0000-0000-0000-000000000001'
      and from_stage is null and to_stage = 'IDENTIFIED'),
  1, 'creating an opportunity records its opening stage event'
);

-- Advance the seeded opportunity (its next action is still open, so the
-- deferred stage gate passes).
update opportunities
   set stage = 'QUALIFIED', current_status = 'Budget confirmed'
 where id = 'f0000000-0000-0000-0000-000000000001';

select is(
  (select count(*)::int from opportunity_stage_events
    where opportunity_id = 'f0000000-0000-0000-0000-000000000001'
      and from_stage = 'IDENTIFIED' and to_stage = 'QUALIFIED'),
  1, 'advancing a stage records the transition'
);

select is(
  (select count(*)::int from opportunity_stage_events
    where opportunity_id = 'f0000000-0000-0000-0000-000000000001'),
  2, 'the log holds exactly the creation and the advance'
);

-- Editing a non-stage column must not create an event.
update opportunities set current_blocker = 'lead time'
 where id = 'f0000000-0000-0000-0000-000000000001';
select is(
  (select count(*)::int from opportunity_stage_events
    where opportunity_id = 'f0000000-0000-0000-0000-000000000001'),
  2, 'editing other fields records nothing'
);

-- The log is append-only for clients: no insert policy exists.
create temp table _dml (check_name text primary key, sqlstate text);
grant select, insert on _dml to authenticated;

do $$
begin
  perform tests.set_claims('deon@gmxgroup.com', 'gmx-us');
  perform set_config('role', 'authenticated', true);
  begin
    insert into public.opportunity_stage_events (org_id, opportunity_id, to_stage)
    values ('11111111-1111-1111-1111-111111111111',
            'f0000000-0000-0000-0000-000000000001', 'WON');
    insert into _dml values ('client_insert', '00000');
  exception when others then
    insert into _dml values ('client_insert', sqlstate);
  end;
  -- No UPDATE policy exists, so RLS filters every row out rather than raising:
  -- the statement "succeeds" having rewritten nothing. Assert the history, not
  -- the sqlstate.
  update public.opportunity_stage_events set to_stage = 'WON'
   where opportunity_id = 'f0000000-0000-0000-0000-000000000001';
  perform set_config('role', 'postgres', true);
end;
$$;

select is((select sqlstate from _dml where check_name = 'client_insert'), '42501',
  'clients cannot insert stage events (trigger-written only)');
select is(
  (select count(*)::int from opportunity_stage_events
    where opportunity_id = 'f0000000-0000-0000-0000-000000000001'
      and to_stage = 'WON'),
  0, 'a client UPDATE rewrites no stage history (RLS filters every row)'
);

-- ── Derived aggregates ──────────────────────────────────────────────────────

select is(
  (select opportunity_count::int from dashboard_pipeline
    where owner_id = 'c0000000-0000-0000-0000-000000000004'
      and stage = 'QUALIFIED'),
  1, 'dashboard_pipeline counts the opportunity under its current stage'
);

select is(
  (select total_value from dashboard_pipeline
    where owner_id = 'c0000000-0000-0000-0000-000000000004'
      and stage = 'QUALIFIED'),
  180000.00::numeric, 'dashboard_pipeline sums estimated revenue'
);

-- Weighted pipeline = value × probability (spec §15).
update opportunities set probability = 40
 where id = 'f0000000-0000-0000-0000-000000000001';
select is(
  (select weighted_value from dashboard_pipeline
    where owner_id = 'c0000000-0000-0000-0000-000000000004'
      and stage = 'QUALIFIED'),
  72000.000::numeric, 'weighted pipeline applies probability'
);

select is(
  (select advanced::int from dashboard_stage_flow
    where owner_id = 'c0000000-0000-0000-0000-000000000004'
      and week_start = date_trunc('week', now())::date),
  1, 'dashboard_stage_flow counts the advance (the metric D64 exists for)'
);

select is(
  (select created::int from dashboard_stage_flow
    where owner_id = 'c0000000-0000-0000-0000-000000000004'
      and week_start = date_trunc('week', now())::date),
  4, 'dashboard_stage_flow separates creations from advances'
);

-- D46: planned vs actual for the current week.
select is(
  (select planned_total::int from dashboard_planned_vs_actual
    where owner_id = 'c0000000-0000-0000-0000-000000000004'
      and week_start = date_trunc('week', current_date)::date),
  4, 'planned_total counts this week''s agenda commitments'
);

select is(
  (select planned_done::int from dashboard_planned_vs_actual
    where owner_id = 'c0000000-0000-0000-0000-000000000004'
      and week_start = date_trunc('week', current_date)::date),
  3, 'planned_done counts agenda items an activity linked back to (D46)'
);

select is(
  (select unplanned::int from dashboard_planned_vs_actual
    where owner_id = 'c0000000-0000-0000-0000-000000000003'
      and week_start = date_trunc('week', now() - interval '1 day')::date),
  1, 'unplanned counts activities with no advance commitment'
);

-- Rep scorecard.
select is(
  (select open_next_actions::int from dashboard_rep_scorecard
    where membership_id = 'c0000000-0000-0000-0000-000000000004'),
  3, 'rep scorecard counts open next actions'
);

select is(
  (select quotes_outstanding::int from dashboard_rep_scorecard
    where membership_id = 'c0000000-0000-0000-0000-000000000004'),
  1, 'rep scorecard counts quotes outstanding'
);

-- Territory rollup: SoCal holds banner + 2 branches + contractor + 2 distributors.
select is(
  (select account_count::int from dashboard_territory
    where territory_id = 'b0000000-0000-0000-0000-000000000002'),
  6, 'territory rollup counts its accounts'
);

-- Weekly review inputs.
select is(
  (select count(*)::int from weekly_review_recent_activity
    where org_id = '11111111-1111-1111-1111-111111111111'),
  5, 'weekly review picks up both reps'' recent activity'
);

select cmp_ok(
  (select count(*)::int from weekly_review_upcoming
    where owner_id = 'c0000000-0000-0000-0000-000000000004'),
  '>=', 1, 'weekly review lists upcoming commitments'
);

-- ── RLS scoping: the same view, three audiences ─────────────────────────────

create temp table _scope (check_name text primary key, val int);
grant select, insert on _scope to authenticated;

do $$
begin
  -- TJ (rep, Buffalo) must not see Deon's pipeline or scorecard.
  perform tests.set_claims('tj@gmxgroup.com', 'gmx-us');
  perform set_config('role', 'authenticated', true);
  insert into _scope
    select 'tj_sees_deon_pipeline', count(*) from public.dashboard_pipeline
     where owner_id = 'c0000000-0000-0000-0000-000000000004';
  insert into _scope
    select 'tj_scorecard_rows', count(*) from public.dashboard_rep_scorecard;
  perform set_config('role', 'postgres', true);

  -- Manager sees the chain; admin sees the org.
  perform tests.set_claims('joao@gmxgroup.com', 'gmx-us');
  perform set_config('role', 'authenticated', true);
  insert into _scope
    select 'manager_scorecard_rows', count(*) from public.dashboard_rep_scorecard;
  perform set_config('role', 'postgres', true);

  -- Cross-tenant: org2 rep sees only their own org's pipeline.
  perform tests.set_claims('riley@acme.test', 'acme-test');
  perform set_config('role', 'authenticated', true);
  insert into _scope
    select 'org2_foreign_pipeline', count(*) from public.dashboard_pipeline
     where org_id <> '22222222-2222-2222-2222-222222222222';
  insert into _scope
    select 'org2_own_pipeline', count(*) from public.dashboard_pipeline;
  perform set_config('role', 'postgres', true);
end;
$$;

select is((select val from _scope where check_name = 'tj_sees_deon_pipeline'), 0,
  'a rep sees no peer pipeline in the dashboard views');
select is((select val from _scope where check_name = 'tj_scorecard_rows'), 1,
  'a rep''s scorecard shows only themselves');
select is((select val from _scope where check_name = 'manager_scorecard_rows'), 3,
  'a manager sees their whole chain (both reps + self)');
select is((select val from _scope where check_name = 'org2_foreign_pipeline'), 0,
  'dashboards never leak across tenants');
select cmp_ok((select val from _scope where check_name = 'org2_own_pipeline'), '>', 0,
  'control: the org2 rep does see their own pipeline');

select * from finish();
rollback;

-- Phase 1 tests · 05: opportunity stage gate (source PDF rule — every stage
-- requires current_status + open next action with a date; deferred so the
-- opportunity and its next_action can land in one transaction; WON/LOST exempt).
--
-- Pattern: each scenario runs inside a plpgsql exception block within one DO —
-- `set constraints all immediate` forces the queued deferred event to fire,
-- an exception rolls the scenario's subtransaction (rows + queued events) back
-- automatically, and the outcome sqlstate lands in a temp table. '00000' means
-- the gate accepted the scenario. Assertions stay top-level so pgTAP's test
-- counter is never rolled back.
begin;
create extension if not exists pgtap with schema extensions;

select plan(6);

create temp table _gate (check_name text primary key, sqlstate text);

do $$
declare
  v_org1 uuid := '11111111-1111-1111-1111-111111111111';
  v_acct uuid := 'd0000000-0000-0000-0000-000000000004';
  v_terr uuid := 'b0000000-0000-0000-0000-000000000002';
  v_own  uuid := 'c0000000-0000-0000-0000-000000000004';
begin
  -- 1. Insert without any next action → rejected.
  begin
    insert into public.opportunities (id, org_id, name, primary_account_id,
      territory_id, owner_id, stage, current_status, lead_source)
    values ('f0000000-0000-0000-0000-00000000aa01', v_org1, 'Gate NoNA',
            v_acct, v_terr, v_own, 'IDENTIFIED', 'status set', 'JOBSITE');
    set constraints all immediate;
    insert into _gate values ('insert_without_na', '00000');
  exception when others then
    insert into _gate values ('insert_without_na', sqlstate);
  end;

  -- 2. Insert with an open next action in the same transaction → accepted.
  begin
    insert into public.opportunities (id, org_id, name, primary_account_id,
      territory_id, owner_id, stage, current_status, lead_source)
    values ('f0000000-0000-0000-0000-00000000aa02', v_org1, 'Gate WithNA',
            v_acct, v_terr, v_own, 'IDENTIFIED', 'status set', 'JOBSITE');
    insert into public.next_actions (org_id, action, owner_id, due_date, opportunity_id)
    values (v_org1, 'Qualify budget', v_own, current_date + 5,
            'f0000000-0000-0000-0000-00000000aa02');
    set constraints all immediate;
    set constraints all deferred;
    insert into _gate values ('insert_with_na', '00000');
  exception when others then
    insert into _gate values ('insert_with_na', sqlstate);
  end;

  -- 3. Missing current_status → rejected even with a next action.
  begin
    insert into public.opportunities (id, org_id, name, primary_account_id,
      territory_id, owner_id, stage, lead_source)
    values ('f0000000-0000-0000-0000-00000000aa03', v_org1, 'Gate NoStatus',
            v_acct, v_terr, v_own, 'IDENTIFIED', 'JOBSITE');
    insert into public.next_actions (org_id, action, owner_id, due_date, opportunity_id)
    values (v_org1, 'na', v_own, current_date + 1,
            'f0000000-0000-0000-0000-00000000aa03');
    set constraints all immediate;
    insert into _gate values ('missing_current_status', '00000');
  exception when others then
    insert into _gate values ('missing_current_status', sqlstate);
  end;

  -- 4. Advancing the seeded opportunity while its next action is open → accepted.
  begin
    update public.opportunities
       set stage = 'QUALIFIED', current_status = 'Budget confirmed'
     where id = 'f0000000-0000-0000-0000-000000000001';
    set constraints all immediate;
    set constraints all deferred;
    insert into _gate values ('advance_with_open_na', '00000');
  exception when others then
    insert into _gate values ('advance_with_open_na', sqlstate);
  end;

  -- 5. Advancing after the only next action is completed → rejected.
  begin
    update public.next_actions set completed_at = now()
     where opportunity_id = 'f0000000-0000-0000-0000-000000000001'
       and completed_at is null;
    update public.opportunities
       set stage = 'DEVELOPMENT', current_status = 'Samples in hand'
     where id = 'f0000000-0000-0000-0000-000000000001';
    set constraints all immediate;
    insert into _gate values ('advance_without_open_na', '00000');
  exception when others then
    insert into _gate values ('advance_without_open_na', sqlstate);
  end;

  -- 6. Terminal stages are exempt from the next-action requirement.
  begin
    update public.next_actions set completed_at = now()
     where opportunity_id = 'f0000000-0000-0000-0000-000000000001'
       and completed_at is null;
    update public.opportunities
       set stage = 'LOST', current_status = 'Competitor won on price'
     where id = 'f0000000-0000-0000-0000-000000000001';
    set constraints all immediate;
    set constraints all deferred;
    insert into _gate values ('terminal_stage_exempt', '00000');
  exception when others then
    insert into _gate values ('terminal_stage_exempt', sqlstate);
  end;
end;
$$;

select is((select sqlstate from _gate where check_name = 'insert_without_na'),
  '23514', 'opportunity without an open next action is rejected');
select is((select sqlstate from _gate where check_name = 'insert_with_na'),
  '00000', 'opportunity + next action created together pass the gate');
select is((select sqlstate from _gate where check_name = 'missing_current_status'),
  '23514', 'stage change without current_status is rejected');
select is((select sqlstate from _gate where check_name = 'advance_with_open_na'),
  '00000', 'stage advance with an open next action passes');
select is((select sqlstate from _gate where check_name = 'advance_without_open_na'),
  '23514', 'stage advance with no open next action is rejected');
select is((select sqlstate from _gate where check_name = 'terminal_stage_exempt'),
  '00000', 'WON/LOST require no open next action');

select * from finish();
rollback;

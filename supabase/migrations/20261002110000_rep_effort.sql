-- WHAT COUNTS AS THE REP'S WORK ON A DEALER (Andre, 2026-10-02).
--
-- "we are assuming every dealer which got back buying was because of reps
-- effort" — and that is a gift the number should not be handing out. A dealer
-- that stopped and came back is the rep's success only when something they did
-- is on the record against that dealer. Returns with nothing behind them are
-- good news and nobody's score.
--
-- One view, because the signals are scattered across five tables today and two
-- more are coming: the order system is to say whose order it was and whether a
-- rep initiated it, and the Gmail connection is to start landing messages.
-- When those arrive they become two more branches of this union and every
-- screen that reads effort gets them at once.
--
-- WHAT IS DELIBERATELY NOT HERE: anything the rep did not do. A sell-through
-- row is the dealer buying, not the rep working, and counting it would make
-- the measure circular — the purchase proving the effort that the purchase is
-- supposed to be evidence of.
create or replace view rep_effort with (security_invoker = true) as
  -- A visit or any logged activity, against every account it names.
  select a.org_id,
         aa.account_id,
         a.owner_id as membership_id,
         coalesce(a.occurred_at, a.created_at) as happened_at,
         'VISIT'::text as kind
  from activities a
  join activity_accounts aa on aa.activity_id = a.id
  union all
  -- The activity's own primary account, which does not always get a row of its
  -- own in activity_accounts.
  select a.org_id, a.primary_account_id, a.owner_id,
         coalesce(a.occurred_at, a.created_at), 'VISIT'
  from activities a
  where a.primary_account_id is not null
  union all
  -- A promise made on the agenda, kept or not: the planning is the work.
  select n.org_id, n.account_id, n.owner_id,
         coalesce(n.completed_at, n.created_at), 'PLANNED'
  from next_actions n
  where n.account_id is not null
  union all
  -- Somebody wrote down what happened with this account.
  select t.org_id, t.account_id, t.author_id, t.created_at, 'NOTE'
  from account_notes t
  union all
  -- A quote is effort whatever becomes of it.
  select o.org_id, coalesce(o.dealer_id, o.primary_account_id), o.owner_id,
         o.created_at, 'QUOTE'
  from opportunities o
  where coalesce(o.dealer_id, o.primary_account_id) is not null
  union all
  -- The PK class actually held — the counter staff were taught.
  select r.org_id, r.account_id, r.updated_by, r.updated_at, 'PK_CLASS'
  from account_rollout r
  where r.pk_count > 0;

comment on view rep_effort is
  'Every recorded trace of a rep working an account, one row per trace. The '
  'conversion rate counts a dealer''s return only when a trace exists in the '
  'window. Order attribution and e-mail are not here yet — neither exists.';

grant select on rep_effort to authenticated;

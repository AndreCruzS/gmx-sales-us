-- Phase 1 · migration 10: RLS policies — default-deny on every table.
--
-- Every policy carries the tenant gate (org claim + active membership, D24)
-- and nests the rep/manager/admin/support hierarchy inside it (spec §4).
-- Helpers are wrapped in scalar subselects so they evaluate once per query,
-- not once per row.
--
-- FORCE ROW LEVEL SECURITY is deliberately NOT used: the security definer
-- helpers and triggers run as the table owner (postgres) and must bypass RLS;
-- service_role bypasses via its BYPASSRLS attribute. Clients only ever hold
-- anon/authenticated.
--
-- Deletes are admin-only on record-of-truth tables (record once → history is
-- an asset); owners may delete only their own drafts/queue items
-- (voice_captures, contact_candidates) and their own outbox-managed joins.

-- Tenancy ---------------------------------------------------------------------

alter table organizations enable row level security;

create policy organizations_select on organizations
  for select to authenticated
  using (
    id = (select private.jwt_org_id())
    and (select private.is_active_member())
  );

create policy organizations_update on organizations
  for update to authenticated
  using (
    id = (select private.jwt_org_id())
    and (select private.is_admin())
  )
  with check (
    id = (select private.jwt_org_id())
    and (select private.is_admin())
  );

alter table org_integrations enable row level security;

create policy org_integrations_admin on org_integrations
  for all to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_admin())
  )
  with check (
    org_id = (select private.jwt_org_id())
    and (select private.is_admin())
  );

-- Identity --------------------------------------------------------------------

alter table users enable row level security;

create policy users_select on users
  for select to authenticated
  using (
    id = (select auth.uid())
    or id in (select private.visible_user_ids())
  );

create policy users_update_self on users
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

alter table territories enable row level security;

create policy territories_select on territories
  for select to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
  );

create policy territories_admin_write on territories
  for all to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_admin())
  )
  with check (
    org_id = (select private.jwt_org_id())
    and (select private.is_admin())
  );

alter table memberships enable row level security;

create policy memberships_select on memberships
  for select to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and (
      user_id = (select auth.uid())
      or id in (select private.visible_membership_ids())
      or (select private.is_admin())
    )
  );

create policy memberships_admin_write on memberships
  for all to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_admin())
  )
  with check (
    org_id = (select private.jwt_org_id())
    and (select private.is_admin())
  );

alter table support_assignments enable row level security;

create policy support_assignments_select on support_assignments
  for select to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and (
      (select private.is_admin())
      or support_membership_id = (select private.active_membership_id())
      or rep_membership_id = (select private.active_membership_id())
    )
  );

create policy support_assignments_admin_write on support_assignments
  for all to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_admin())
  )
  with check (
    org_id = (select private.jwt_org_id())
    and (select private.is_admin())
  );

-- Server-internal: RLS on, zero policies — no client role reads the closure.
alter table user_hierarchy enable row level security;

-- CRM -------------------------------------------------------------------------

alter table accounts enable row level security;

-- Rep: own + territory accounts; manager: chain; support: assigned reps; admin: org.
create policy accounts_select on accounts
  for select to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and (
      owner_id in (select private.visible_membership_ids())
      or territory_id in (select private.visible_territory_ids())
      or (select private.is_admin())
    )
  );

create policy accounts_insert on accounts
  for insert to authenticated
  with check (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and owner_id in (select private.visible_membership_ids())
  );

create policy accounts_update on accounts
  for update to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and (
      owner_id in (select private.visible_membership_ids())
      or territory_id in (select private.visible_territory_ids())
      or (select private.is_admin())
    )
  )
  with check (
    org_id = (select private.jwt_org_id())
    and owner_id in (select private.visible_membership_ids())
    or (select private.is_admin()) and org_id = (select private.jwt_org_id())
  );

create policy accounts_delete on accounts
  for delete to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_admin())
  );

alter table contacts enable row level security;

create policy contacts_select on contacts
  for select to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and (select private.can_see_account(account_id))
  );

create policy contacts_write on contacts
  for insert to authenticated
  with check (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and (select private.can_see_account(account_id))
  );

create policy contacts_update on contacts
  for update to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and (select private.can_see_account(account_id))
  )
  with check (
    org_id = (select private.jwt_org_id())
    and (select private.can_see_account(account_id))
  );

create policy contacts_delete on contacts
  for delete to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_admin())
  );

alter table account_relationships enable row level security;

create policy account_relationships_select on account_relationships
  for select to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and (
      (select private.can_see_account(account_a_id))
      or (select private.can_see_account(account_b_id))
    )
  );

create policy account_relationships_insert on account_relationships
  for insert to authenticated
  with check (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and (select private.can_see_account(account_a_id))
  );

create policy account_relationships_update on account_relationships
  for update to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and (
      (select private.can_see_account(account_a_id))
      or (select private.can_see_account(account_b_id))
    )
  )
  with check (
    org_id = (select private.jwt_org_id())
    and (select private.can_see_account(account_a_id))
  );

create policy account_relationships_delete on account_relationships
  for delete to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_admin())
  );

-- The loop --------------------------------------------------------------------

alter table projects enable row level security;

-- Projects are org-wide convergence points (multiple territories' accounts on
-- one jobsite); no owner in the spec, so read is org-scoped.
create policy projects_select on projects
  for select to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
  );

create policy projects_insert on projects
  for insert to authenticated
  with check (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and (created_by is null or created_by in (select private.visible_membership_ids()))
  );

create policy projects_update on projects
  for update to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and (
      created_by in (select private.visible_membership_ids())
      or (select private.is_admin())
    )
  )
  with check (org_id = (select private.jwt_org_id()));

create policy projects_delete on projects
  for delete to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_admin())
  );

alter table project_stakeholders enable row level security;

create policy project_stakeholders_select on project_stakeholders
  for select to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.can_see_project(project_id))
  );

create policy project_stakeholders_write on project_stakeholders
  for insert to authenticated
  with check (
    org_id = (select private.jwt_org_id())
    and (select private.can_see_project(project_id))
  );

create policy project_stakeholders_update on project_stakeholders
  for update to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.can_see_project(project_id))
  )
  with check (org_id = (select private.jwt_org_id()));

create policy project_stakeholders_delete on project_stakeholders
  for delete to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_admin())
  );

alter table opportunities enable row level security;

create policy opportunities_select on opportunities
  for select to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and (
      owner_id in (select private.visible_membership_ids())
      or (select private.is_admin())
    )
  );

create policy opportunities_insert on opportunities
  for insert to authenticated
  with check (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and owner_id in (select private.visible_membership_ids())
  );

create policy opportunities_update on opportunities
  for update to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and (
      owner_id in (select private.visible_membership_ids())
      or (select private.is_admin())
    )
  )
  with check (
    org_id = (select private.jwt_org_id())
    and (
      owner_id in (select private.visible_membership_ids())
      or (select private.is_admin())
    )
  );

create policy opportunities_delete on opportunities
  for delete to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_admin())
  );

alter table activities enable row level security;

create policy activities_select on activities
  for select to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and (
      owner_id in (select private.visible_membership_ids())
      or (select private.is_admin())
    )
  );

create policy activities_insert on activities
  for insert to authenticated
  with check (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and owner_id in (select private.visible_membership_ids())
  );

create policy activities_update on activities
  for update to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and (
      owner_id in (select private.visible_membership_ids())
      or (select private.is_admin())
    )
  )
  with check (
    org_id = (select private.jwt_org_id())
    and (
      owner_id in (select private.visible_membership_ids())
      or (select private.is_admin())
    )
  );

create policy activities_delete on activities
  for delete to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_admin())
  );

alter table activity_accounts enable row level security;

create policy activity_accounts_select on activity_accounts
  for select to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.can_see_activity(activity_id))
  );

create policy activity_accounts_write on activity_accounts
  for insert to authenticated
  with check (
    org_id = (select private.jwt_org_id())
    and (select private.can_see_activity(activity_id))
  );

create policy activity_accounts_update on activity_accounts
  for update to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.can_see_activity(activity_id))
  )
  with check (org_id = (select private.jwt_org_id()));

create policy activity_accounts_delete on activity_accounts
  for delete to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.can_see_activity(activity_id))
  );

alter table activity_contacts enable row level security;

create policy activity_contacts_select on activity_contacts
  for select to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.can_see_activity(activity_id))
  );

create policy activity_contacts_write on activity_contacts
  for insert to authenticated
  with check (
    org_id = (select private.jwt_org_id())
    and (select private.can_see_activity(activity_id))
  );

create policy activity_contacts_delete on activity_contacts
  for delete to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.can_see_activity(activity_id))
  );

alter table next_actions enable row level security;

create policy next_actions_select on next_actions
  for select to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and (
      owner_id in (select private.visible_membership_ids())
      or (select private.is_admin())
    )
  );

create policy next_actions_insert on next_actions
  for insert to authenticated
  with check (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and owner_id in (select private.visible_membership_ids())
  );

create policy next_actions_update on next_actions
  for update to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and (
      owner_id in (select private.visible_membership_ids())
      or (select private.is_admin())
    )
  )
  with check (
    org_id = (select private.jwt_org_id())
    and (
      owner_id in (select private.visible_membership_ids())
      or (select private.is_admin())
    )
  );

create policy next_actions_delete on next_actions
  for delete to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_admin())
  );

-- Capture pipelines -----------------------------------------------------------

alter table voice_captures enable row level security;

create policy voice_captures_select on voice_captures
  for select to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and (
      owner_id in (select private.visible_membership_ids())
      or (select private.is_admin())
    )
  );

create policy voice_captures_insert on voice_captures
  for insert to authenticated
  with check (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and owner_id in (select private.visible_membership_ids())
  );

create policy voice_captures_update on voice_captures
  for update to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and owner_id in (select private.visible_membership_ids())
  )
  with check (
    org_id = (select private.jwt_org_id())
    and owner_id in (select private.visible_membership_ids())
  );

create policy voice_captures_delete on voice_captures
  for delete to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and owner_id in (select private.visible_membership_ids())
  );

alter table contact_candidates enable row level security;

create policy contact_candidates_select on contact_candidates
  for select to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and (
      created_by in (select private.visible_membership_ids())
      or (select private.is_admin())
    )
  );

create policy contact_candidates_insert on contact_candidates
  for insert to authenticated
  with check (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and created_by in (select private.visible_membership_ids())
  );

create policy contact_candidates_update on contact_candidates
  for update to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and (
      created_by in (select private.visible_membership_ids())
      or (select private.is_admin())
    )
  )
  with check (org_id = (select private.jwt_org_id()));

create policy contact_candidates_delete on contact_candidates
  for delete to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and created_by in (select private.visible_membership_ids())
  );

-- Email (D26–D38): reads follow mailbox-owner visibility; INSERTS/DELETES are
-- service-role-only (ingestion jobs bypass RLS). Clients may only update
-- linkage/status on visible threads and attachments (review flows, D31/D32).

alter table email_threads enable row level security;

create policy email_threads_select on email_threads
  for select to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and membership_id in (select private.visible_membership_ids())
  );

create policy email_threads_update on email_threads
  for update to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and membership_id in (select private.visible_membership_ids())
  )
  with check (org_id = (select private.jwt_org_id()));

alter table email_messages enable row level security;

create policy email_messages_select on email_messages
  for select to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.can_see_thread(thread_id))
  );

alter table email_attachments enable row level security;

create policy email_attachments_select on email_attachments
  for select to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and exists (
      select 1 from email_messages m
      where m.id = message_id
        and (select private.can_see_thread(m.thread_id))
    )
  );

create policy email_attachments_update on email_attachments
  for update to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and exists (
      select 1 from email_messages m
      where m.id = message_id
        and (select private.can_see_thread(m.thread_id))
    )
  )
  with check (org_id = (select private.jwt_org_id()));

alter table email_sync_state enable row level security;

create policy email_sync_state_select on email_sync_state
  for select to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and (
      membership_id in (select private.visible_membership_ids())
      or (select private.is_admin())
    )
  );

alter table org_email_exclusions enable row level security;

create policy org_email_exclusions_admin on org_email_exclusions
  for all to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_admin())
  )
  with check (
    org_id = (select private.jwt_org_id())
    and (select private.is_admin())
  );

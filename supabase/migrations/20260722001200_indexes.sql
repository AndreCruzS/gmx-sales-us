-- Phase 1 · migration 12: indexes — org-leading composites for RLS hot paths,
-- FK support, partial indexes for the agenda/exception queries, trgm for D40.

-- Identity / hierarchy
create index memberships_org_user_idx      on memberships (org_id, user_id);
create index memberships_manager_idx       on memberships (manager_id);
create index memberships_territory_idx     on memberships (territory_id);
create index user_hierarchy_ancestor_idx   on user_hierarchy (ancestor_id);
create index user_hierarchy_descendant_idx on user_hierarchy (descendant_id);
create index support_assignments_support_idx on support_assignments (support_membership_id);
create index support_assignments_rep_idx     on support_assignments (rep_membership_id);

-- Accounts
create index accounts_org_owner_idx     on accounts (org_id, owner_id);
create index accounts_org_territory_idx on accounts (org_id, territory_id);
create index accounts_parent_idx        on accounts (parent_account_id);
create index accounts_referring_idx     on accounts (referring_account_id);

-- Contacts (dedupe D40: normalized email exact-match, then name fuzzy)
create index contacts_org_account_idx on contacts (org_id, account_id);
create index contacts_org_email_idx   on contacts (org_id, lower(email));
create index contacts_name_trgm_idx   on contacts using gin (name extensions.gin_trgm_ops);

-- Relationships (network view fan-out both directions)
create index account_relationships_org_a_idx on account_relationships (org_id, account_a_id);
create index account_relationships_org_b_idx on account_relationships (org_id, account_b_id);

-- Projects
create index projects_org_idx              on projects (org_id);
create index project_stakeholders_proj_idx on project_stakeholders (project_id);
create index project_stakeholders_acct_idx on project_stakeholders (account_id);

-- Opportunities
create index opportunities_org_owner_idx   on opportunities (org_id, owner_id);
create index opportunities_org_stage_idx   on opportunities (org_id, stage);
create index opportunities_account_idx     on opportunities (primary_account_id);
create index opportunities_project_idx     on opportunities (project_id);
create index opportunities_distributor_idx on opportunities (distributor_id);
create index opportunities_dealer_idx      on opportunities (dealer_id);

-- Activities (account history timeline + owner feed)
create index activities_org_owner_occurred_idx
  on activities (org_id, owner_id, occurred_at desc);
create index activities_org_account_occurred_idx
  on activities (org_id, primary_account_id, occurred_at desc);
create index activities_opportunity_idx on activities (opportunity_id);
create index activities_planned_action_idx on activities (planned_action_id);
create index activity_accounts_activity_idx on activity_accounts (activity_id);
create index activity_accounts_account_idx  on activity_accounts (account_id);
create index activity_contacts_activity_idx on activity_contacts (activity_id);
create index activity_contacts_contact_idx  on activity_contacts (contact_id);

-- Next actions (agenda + stage-gate lookup + exception engine)
create index next_actions_org_owner_due_open_idx
  on next_actions (org_id, owner_id, due_date)
  where completed_at is null;
create index next_actions_opportunity_open_idx
  on next_actions (opportunity_id)
  where completed_at is null;
create index next_actions_account_idx  on next_actions (account_id);
create index next_actions_project_idx  on next_actions (project_id);
create index next_actions_activity_idx on next_actions (activity_id);

-- Capture pipelines
create index voice_captures_org_owner_idx    on voice_captures (org_id, owner_id);
create index voice_captures_status_idx       on voice_captures (org_id, status);
create index contact_candidates_org_creator_idx on contact_candidates (org_id, created_by);
create index contact_candidates_pending_idx  on contact_candidates (org_id, status)
  where status = 'PENDING';

-- Email
create index email_threads_org_membership_idx on email_threads (org_id, membership_id);
create index email_threads_account_idx        on email_threads (matched_account_id);
create index email_messages_thread_idx        on email_messages (thread_id);
create index email_attachments_message_idx    on email_attachments (message_id);
create index email_attachments_sha_idx        on email_attachments (org_id, sha256);

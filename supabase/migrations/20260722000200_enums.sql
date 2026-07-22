-- Phase 1 · migration 2: enum types + lead_source domain
-- Enums are Postgres enum types (build brief §4), EXCEPT lead_source: the
-- admin-promotion path (Q6, spec §2 anti-decay guards) means the list grows at
-- runtime governance speed, so it is a check-constrained text DOMAIN — promoting
-- an OTHER value is a two-line migration, and the D7/D8 logic stays beside it.

-- Tenancy / identity ---------------------------------------------------------

create type org_status as enum ('active', 'suspended');

create type membership_role as enum ('rep', 'manager', 'admin', 'support'); -- support: D53

create type membership_status as enum ('active', 'suspended');

create type integration_provider as enum ('anthropic', 'openai', 'google', 'workspace');

-- CRM (spec §2) ---------------------------------------------------------------

create type account_type as enum
  ('DISTRIBUTOR', 'DEALER', 'CONTRACTOR', 'ARCHITECT', 'BUILDER', 'OTHER');

create type activity_type as enum
  ('DEALER_VISIT', 'DISTRIBUTOR_VISIT', 'CONTRACTOR_MEETING', 'ARCHITECT_MEETING',
   'JOBSITE_VISIT', 'PK_TRAINING', 'PHONE_CALL', 'QUOTE_FOLLOWUP',
   'SAMPLE_FOLLOWUP', 'EMAIL', 'OTHER');

create type activity_outcome as enum
  ('RELATIONSHIP_DEVELOPMENT', 'OPPORTUNITY_IDENTIFIED', 'PROJECT_IDENTIFIED',
   'QUOTE_REQUESTED', 'SAMPLE_REQUESTED', 'TECHNICAL_SUPPORT_NEEDED',
   'TRAINING_NEEDED', 'NO_IMMEDIATE_OPPORTUNITY');

create type opportunity_stage as enum
  ('IDENTIFIED', 'QUALIFIED', 'DEVELOPMENT', 'QUOTE', 'DECISION',
   'WON', 'LOST', 'ON_HOLD');

create type relationship_type as enum
  ('SUPPLIES', 'PURCHASES_FROM', 'WORKS_WITH', 'REFERRED_BY', 'REFERRED_TO',
   'SPECIFIES_THROUGH', 'SUPPORTS', 'PREFERRED_PARTNER', 'INSTALLER_FOR',
   'ARCHITECT_FOR', 'DEVELOPER_FOR');

create type visit_objective as enum -- D48
  ('COLLECT_QUOTE', 'MEET_CONTRACTOR', 'CONVERT_STOCKING_DEALER',
   'FOLLOW_UP_LEAD', 'PK_DELIVERY', 'MERCHANDISING_CHECK',
   'RELATIONSHIP_MAINTENANCE', 'OTHER');

create type activity_account_role as enum ('PRIMARY', 'INVOLVED');

create type project_stakeholder_role as enum
  ('ARCHITECT', 'CONTRACTOR', 'BUILDER', 'DEVELOPER', 'DEALER', 'DISTRIBUTOR', 'OTHER');

-- Values below are proposed defaults — the spec names these fields without
-- enumerating values. Flagged for client review (see supabase/README.md).

create type strategic_importance as enum ('STRATEGIC', 'HIGH', 'MEDIUM', 'LOW');

create type relationship_status_value as enum
  ('PROSPECT', 'DEVELOPING', 'ESTABLISHED', 'AT_RISK', 'DORMANT');

create type influence_level as enum ('LOW', 'MEDIUM', 'HIGH', 'DECISION_MAKER');

create type relationship_strength as enum ('WEAK', 'MODERATE', 'STRONG');

create type relationship_state as enum ('ACTIVE', 'INACTIVE', 'UNCONFIRMED');

create type project_status as enum
  ('PLANNING', 'DESIGN', 'BIDDING', 'UNDER_CONSTRUCTION', 'COMPLETED',
   'ON_HOLD', 'CANCELLED');

-- Pipelines / intake ----------------------------------------------------------

create type voice_capture_status as enum
  ('PENDING', 'UPLOADED', 'TRANSCRIBED', 'DRAFTED', 'REVIEWED', 'SENT',
   'DISCARDED', 'FAILED');

create type candidate_source as enum -- D39
  ('MANUAL', 'VOICE', 'BUSINESS_CARD', 'EMAIL_METADATA');

create type candidate_status as enum
  ('PENDING', 'CONFIRMED', 'MERGED', 'DISCARDED');

create type email_direction as enum ('INBOUND', 'OUTBOUND');

create type attachment_classification as enum -- D31
  ('QUOTE', 'SPEC_SHEET', 'DRAWING', 'SUBMITTAL', 'PHOTO', 'INVOICE', 'OTHER');

-- lead_source (spec §2) -------------------------------------------------------

create domain lead_source_value as text
  check (value in (
    -- referral / network-driven (require referring_account_id, D7)
    'REFERRAL_DEALER', 'REFERRAL_DISTRIBUTOR', 'REFERRAL_CONTRACTOR',
    'REFERRAL_ARCHITECT', 'SPEC_DRIVEN', 'REFERRAL_OTHER',
    -- rep-generated / field
    'PK_CLASS', 'JOBSITE', 'COLD_OUTREACH', 'EXISTING_RELATIONSHIP', 'TRADE_SHOW',
    -- inbound / marketing
    'INBOUND_WEB', 'MARKETING_CAMPAIGN', 'MANUFACTURER_LEAD', 'SOCIAL',
    'OTHER' -- requires source_detail (D8)
  ));

-- Immutable so it is legal in check constraints (accounts, opportunities — D7).
create or replace function private.is_referral_lead_source(p_source text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_source in (
    'REFERRAL_DEALER', 'REFERRAL_DISTRIBUTOR', 'REFERRAL_CONTRACTOR',
    'REFERRAL_ARCHITECT', 'SPEC_DRIVEN', 'REFERRAL_OTHER'
  );
$$;

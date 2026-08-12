-- Service-role access to constraint-invoked private functions.
--
-- The D7 CHECK constraints on accounts and opportunities call
-- private.is_referral_lead_source() as the *writing* role. authenticated has
-- had usage+execute since Phase 1, but service_role never did — so any
-- service-role write to accounts (notably the HubSpot inbound sync's
-- applyCompanyPatch) fails on hosted Postgres with "permission denied for
-- function is_referral_lead_source". Local pgTAP never caught it because
-- suites run as postgres, which bypasses grants.
--
-- Deliberately minimal: only schema usage plus the one function CHECK
-- constraints invoke. service_role bypasses RLS, so the RLS helper functions
-- in private are not its business.

grant usage on schema private to service_role;
grant execute on function private.is_referral_lead_source(text) to service_role;

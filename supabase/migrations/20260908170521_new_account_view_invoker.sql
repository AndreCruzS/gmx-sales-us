-- THE OPTION THE REPLACE DROPPED (CI, 2026-09-08, minutes after the
-- dealers-only change): CREATE OR REPLACE VIEW does not carry reloptions
-- over, and exception_new_account_no_follow_up came back WITHOUT
-- security_invoker — running as its owner, past RLS, showing a rep the
-- peers' exceptions through the umbrella view. The leakage suite caught it
-- on the first push. Restored, and the lesson recorded: every replace of a
-- security_invoker view must restate the option.
alter view public.exception_new_account_no_follow_up
  set (security_invoker = true);

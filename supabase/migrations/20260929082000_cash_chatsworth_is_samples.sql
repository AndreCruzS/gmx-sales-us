-- "samples - account for in a different line" (Bianca, round-2 sheet, 2026-09-29).
--
-- The Chatsworth cabinet counter was filed as CASH with the other two cash
-- labels. She read it and said it is samples, which is a different line of the
-- same story: cash is somebody paying at the counter, samples are wood going
-- out to be shown. The volume does not move; the name over it does.
update distributor_house_accounts
set kind = 'SAMPLES',
    note = 'Hardwoods Chatsworth cabinet counter — Bianca, round-2 sheet 2026-09-29: "samples, account for in a different line"'
where dealer_label = 'CASH993 - CASH CHATSWORTH - CABINET';

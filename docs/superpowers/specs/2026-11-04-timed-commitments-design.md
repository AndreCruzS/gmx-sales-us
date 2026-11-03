# Timed commitments — design

Date: 2026-11-04 · Status: built on `feat/timed-commitments`, not published.
Asked by Andre on 2026-11-03: "conseguimos fazer com que o say crie um compromisso na agenda?", then "faça as duas":
1. a visit can carry a time of day;
2. a call or a meeting said with a time becomes an agenda commitment.

## Rule

- **Visit:** always on the agenda. The time is optional; without one it is all day, as before.
- **Call or meeting with a time:** on the agenda and on the calendars, as kind `CALL` or `MEETING`.
- **Call, meeting or to-do without a time:** a to-do on the routine list (kind `OTHER` and its relatives), as before.

## Data

On `next_actions`:
- `due_time` (`time`) and `time_zone` (IANA): the wall-clock start in the zone it was said in, which is the device's. Either both are set or neither is.
- `duration_minutes` (5–600): null means the default for the kind, which is visit 60, call 30, meeting 60.
- New values `CALL` and `MEETING` on the `next_action_kind` enum. A check refuses a call or a meeting without a time.

Routine excludes both kinds by construction: `routine_items` lists only the chore kinds. `item_type` becomes `FOLLOW_UP` through the dealer-items trigger.

## Where it shows

- **Agenda (`/visits`):** the time and a Call/Meeting tag on the row. A day reads timed rows first, by clock, then all-day ones. "Plan a visit" has an optional time.
- **Desk month (`agenda-calendar`):** the time in front of the cell label and the list row.
- **Offline cache:** carries `due_time`, so the offline agenda keeps the same rule.
- **Team calendar and each rep's "GMX · Agenda":** a timed event (`dateTime` + `timeZone`) instead of all day. The slot written is kept as the private property `slot`, so a moved clock is updated on the next pass and a replay changes nothing. Google-born events keep Google's own clock, as before.
- **Home:** unchanged. The day spine is the route of stops, so calls and meetings are not in it, and "Visits this week" still counts visits only.

## Say it

- The model returns `time` (HH:MM, 24-hour) and, for a follow-up, `follow_up_type`: CALL, MEETING or TASK.
- The card shows a time field for a visit, and for a follow-up a "Call · Meeting · To-do" select, plus the time when it is not a to-do.
- A call or a meeting with no time lands as a to-do and says "On your routine list".
- **Fixed alongside:** a rep's Say it team held only himself, because a rep reads no colleague's membership. The route now reads names through `pk_member_names`. A follow-up "with" the speaker, or one with no colleague and no account, takes the one colleague its action names.

## Checks

- **pgTAP 34:** kinds, the time/zone pair, a meeting with no time refused, a timed call off the routine list.
- **vitest:** the commitments helpers, the timed team-calendar events (default length, moved clock, idempotent replay) and the Say it time/type sanitising.
- **Browser, as TJ:** one sentence gave a visit at 10, a call at 2 and a meeting with Bianca at 9, all on the agenda in clock order.

## Not done

- Duration is not editable in the UI; the defaults apply.
- Moving a commitment's time after it is created has no screen yet.
- Say it still stops at 3 requests per sentence.

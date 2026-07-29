# Home widgets + Routine list — design

Date: 2026-07-29
Status: approved in brainstorming (Andre), pending spec review
Mockups: `.superpowers/brainstorm/465-1785334473/content/home-c-final.html`

## Why

The current Home opens on the day list. Andre (relaying the customer) wants a
launcher: glance at what matters, tap into the thing you need. The customer
also asked for a routine to-do list (samples, quotes, display walls — the
duties in spec §10) that goes along with the debrief flow.

## 1. Home screen (direction C — widget grid)

Top to bottom:

1. **Greeting + sync state** — "Good morning, {name}" and the honest sync line
   (reuses the existing offline status; no system jargon).
2. **Search bar** — the existing offline search over the cached working set,
   surfaced on Home instead of only in the top nav.
3. **Visits coming** — full-width tile: count, next visit (account + purpose +
   date). Opens the current day/week agenda screen, which moves one tap deep
   and keeps plan-a-visit. Old `/` behavior redirects cleanly.
4. **Four count tiles** (2×2):
   - **Routine** — the to-do list (section 2). Count + kind breakdown.
   - **Needs attention** — warnings only (danger-tier exceptions). Amber count.
   - **Waiting your OK** — Review queue size (drafts + new contacts + failed
     saves). Same number becomes a badge on the Review tab.
   - **Visits this week** — done/planned + new contacts met. Opens Insights.
5. **Action row** — four buttons: **Scan card** (Record camera), **Voice note**
   (Record mic), **Accounts** (list), **Add account** (new form, section 4).
6. **Debrief waiting** card — shown when a planned visit's date passed with no
   linked activity. "How did it go?" opens Record with the visit pre-linked so
   the note completes it (D46 link-and-complete).

Icons are Hue icons. No emojis anywhere, including future mockups.

Desktop: same content in the wider left-rail layout; tiles flow into the
existing content column grid.

## 2. Routine list

The customer's mental model: *samples to follow up, quotes to chase, display
walls to check*. Not a manual to-do app — items are born from data and cleared
by doing.

### Data

- **Substrate = `next_actions`.** Follow-up chores already exist as rows
  (debrief fan-out creates them today). New nullable column
  `kind`: `VISIT | SAMPLE_FOLLOW_UP | QUOTE_FOLLOW_UP | DISPLAY_CHECK | OTHER`,
  with a backfill migration inferring kind from linked context (opportunity
  stage, action text heuristics; unknown stays `OTHER`).
- **Display checks are derived**, not rows: an account enters Routine when
  `display_last_verified_at` is older than `display_routine_months` (new org
  setting, default 4) and `has_display_wall` is true. The existing exception
  fires at `display_verify_months` (default 6) — so the chore surfaces two
  months before it becomes a warning.
- **View**: one `security_invoker` view (`routine_items`) unioning open
  follow-up `next_actions` (grouped by kind) and due display checks. Same RLS
  posture as the exception views: rep sees own, manager sees chain.

### Lifecycle

- **Born**: from activity outcomes (`SAMPLE_REQUESTED`, `QUOTE_REQUESTED`, …),
  from debrief AI extraction (section 3), or from the rep planning follow-ups.
- **Cleared by doing**: recording the follow-up activity or verifying the
  display. No checkboxes — done is earned. Display verification writes
  `display_last_verified_at` through the outbox (LWW like any account edit).
- **Escalates**: past the existing exception threshold the item moves to
  Needs attention and **leaves Routine** (anti-duplication rule: one object,
  one home at a time). Routine shows the pre-threshold stage; exceptions show
  the broken-promise stage.

### UI

Tapping the Routine tile opens the grouped list: *Samples to follow up,
Quotes to chase, Display walls to check* (kinds with zero items are hidden).
Each row: account, context line (sent/quoted/last-verified date), and one
action — "Record call" (Record with account + item pre-linked) or "Plan visit"
(agenda plan form pre-filled with `MERCHANDISING_CHECK` objective).

## 3. Debrief integration (both directions)

When the rep records "How did it go?" (or any debrief against an account):

- **Context in**: the account's open routine items are passed to the AI
  extraction call.
- **Dispositions out**: the AI may propose clearing items ("display wall looks
  good" → display verified; "went over the quote" → quote follow-up done).
  Proposed dispositions must reference real open item IDs — anything else is
  dropped at parse (same hallucination posture as enum/date rejection today).
- **Commitments out**: the AI may propose new routine items ("they asked for
  two samples" → two `SAMPLE_FOLLOW_UP` rows with dates).
- **Review gate unchanged (D9)**: dispositions and new items appear in the
  draft review sheet; nothing writes until the rep OKs. Send fans out through
  the standard outbox (D10): completed `next_actions`, `display_last_verified_at`
  update, new `next_actions` rows — with the existing compensation behavior on
  partial failure (D62).

## 4. Add account (standalone form)

The card-flow's create form, promoted to a sheet reachable from Home:
name (brand + city convention, D51), type, lead source per D7/D8 — referral
sources prompt for the referring account and write the relationship row
(allowed here, unlike the card quick-create). Works offline through the
outbox like every create.

## 5. Review badge

The Review tab gets a count badge = pending drafts + pending contact
candidates + rejected saves. Computed client-side from the cached queues, so
it works offline. Same number the Home tile shows.

## 6. Offline behavior

- Routine items and the fortnight agenda join the D56 working-set cache.
- Tiles render from cache when offline with the existing honest copy ("what
  this device knows"); counts never show stale-as-fresh.
- All writes (visit done, disposition fan-out, display verified, account
  created) ride the existing outbox; no new sync machinery.

## 7. Testing

- **pgTAP**: `routine_items` view — grouping, RLS scoping (rep/manager/support
  matrix), escalation handoff (item leaves Routine when its exception fires),
  display-window math, `kind` backfill correctness.
- **vitest**: disposition parse (valid IDs pass, fake IDs dropped), commitment
  extraction to typed rows, badge count from cached queues, Home tile counts
  offline vs online.
- **Persona walk**: full day as the rep in the browser (production build,
  including airplane mode) before calling it done — plan → visit → How did it
  go → dispositions → Routine updated.

## Out of scope (v1)

- Manual free-form to-dos (routine is born from outcomes and debriefs).
- Checkbox ticking, snoozing, reordering.
- TJ home-screen mode (D54 — quote/email-driven Home variant) — separate spec,
  after Gmail goes live.
- PK as a first-class event object (attendee lists etc.) — revisit if the
  client asks; today PK visits are agenda items with a PK objective.

## Decisions folded in

D7/D8 (lead-source rules), D9/D10 (review gate + fan-out), D45 (near-zero
friction), D46–D48 (planned vs actual, objectives), D51 (naming), D52
(display verification), D56 (working set), D57–D62 (outbox/LWW/error tray).
New proposals raised by this spec: `next_actions.kind` column, routine window
R in org settings, Home IA change (day list one tap deep). None contradict
D1–D64; flag to the client alongside the supabase/README.md pending list.

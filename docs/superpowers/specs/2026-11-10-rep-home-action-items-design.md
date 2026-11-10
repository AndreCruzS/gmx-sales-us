# Rep Home: "Your action items" — design

Date: 2026-11-10 · Owner: Andre · Status: draft for approval
Mockup: `.superpowers/mockups/rep-home-action-items.html` (option B chosen)

## Why

On 2026-11-10 Bianca's agent gave Andre two follow-ups (Dykes Lumber Brooklyn,
Lezzer Lumber Butler). Nothing on his Home told him. A follow-up only shows up
in the day timeline on its due day, and nothing on the Home lists what is
still open. He also had two visits from October (Ganahl Anaheim, 10-22;
Ganahl Costa Mesa, 10-27) that were never closed. Nothing shows those either.

Andre wants the Home to show the open work in numbers that **grab attention**,
sorted by the Eisenhower matrix. A tap should open a page with the detail.

## Goals

- The rep's Home gets a "Your action items" block. It counts everything open
  that the rep owns, and the past-due count is red.
- When someone else gives the rep work, the rep sees it on the Home on the
  next visit.
- One tap on a number opens a page called **My work**, already filtered
  to that number.
- No item can hide. An item without a priority still gets counted, under
  "No priority".

## Non-goals

- The manager Home (`manager-home.tsx`) does not change. Leadership will see
  the rep version first and decide whether they want one (Andre, 11-10).
- No change to the Open action items board (`/visits/pk`), apart from what
  shipped today (a6900a1, the figures strip removed).
- No push notifications or e-mail. The banner on the Home is the only alert.

## Anti-goals

- A wall of numbers. Bianca had the figures strip removed from Open action
  items because it was noise (11-10). The Home block stays at **four boxes
  and, sometimes, one line**. Nothing more.
- Rebuilding the Agenda. The detail page is a list of what is open, sorted.
  It is not a calendar.

## Words (fixed)

- The labels stay **Do now · Plan · No priority · Scheduled**. Andre
  considered renaming "Do now" to "Urgent" and decided to keep "Do now"
  (11-10).
- The page title is **My work** (my call, 11-10). The PK board took the name "Action items" the same day, and two pages with one name would confuse. The Home block title is **Your action
  items**.
- All UI copy is in English.

## What counts (option B, chosen 11-10)

An item counts when all of these hold:

- it is a row in `next_actions`;
- `owner_id` is the signed-in rep's membership;
- `completed_at` is null;
- `priority` is not `ELIMINATE`.

The items split into four boxes:

| Box | Which items | Red sub-line | Calm sub-line |
|---|---|---|---|
| **Do now** | a kind that is not VISIT, CALL or MEETING, with priority `DO_NOW` | "N late" (deadline passed) | "N due ≤ 2d", else "next <date>" |
| **Plan** | the same kinds, with priority `PLAN` | "N late" | "next <date>" |
| **No priority** | the same kinds, with priority null | none | "classify them" |
| **Scheduled** | kind VISIT, CALL or MEETING, whatever the priority | "N overdue" (`due_date` < today) | "next <date>" |

Notes:

- An item whose kind is null counts as a task. The database trigger fills
  `kind` in, but the client should not depend on it.
- `DELEGATE` on a rep-owned item: see "Reps and the matrix" below.
- When a box has no items, it shows **0**, greyed out, and stays tappable.
  The block keeps its shape.
- When all four boxes are 0, the block shows the four zeros. It does not
  disappear.

## The banner: "<Name> gave you N items"

- The banner counts open items in the boxes that meet two conditions:
  - `entered_by` is not the rep;
  - `created_at` is later than the moment the rep last opened the My work
    items page.
- The "last opened" moment is stored per device in the offline meta store,
  under the key `action_items_seen_at`.
  - **Builder's call:** whether it is also synced across devices. It is
    per device unless that turns out to be cheap.
  - Before the first visit there is no stored moment. In that case, count
    the last 7 days.
- Wording when one person gave items: "**Bianca** gave you 2 items". When
  several people did: "**Bianca** and 1 other gave you 3 items".
- A tap on the banner opens My work with the filter **New**: just those
  items.
- Opening My work stores the moment, so the banner goes away.
- `entered_by` is set by the insert trigger to the signed-in member
  (`private.active_membership_id()`), and an agent acts as the person who
  connected it. So:
  - Bianca's Muse giving Andre an item sets `entered_by` = Bianca. That is
    the banner case.
  - Items the rep's own agent records have `entered_by` = the rep, so they
    are the rep's own. No banner.
  - Rows written by SQL imports, with no signed-in member, have
    `entered_by` null. Null never triggers the banner.

## Where the block sits

- It goes on the rep Home (`src/app/home/home-client.tsx`), directly under
  the day timeline (DaySpine) and above YourPksCard.
- Order of the boxes: Do now, Plan, No priority, Scheduled.
- Layout: four boxes in one row at phone width (390 px), as in the mockup.
- The numbers render in `--font-fig`. They never use the mono font (see the
  two-faces rule).
- Data comes from the offline cache, like the rest of the Home. This means
  the block works with no signal.

### Cache changes

The cache (`CachedAgendaItem` and the select in
`src/lib/offline/supabase-backend.ts`) adds three fields:

- `owner_id`. The cache holds the whole team for a manager, so the rep's own
  items must be filtered on the client. For a rep, RLS already returns only
  their own rows, but filter anyway.
- `priority`
- `entered_by`, plus the giver's display name for the banner.
  - **Builder's call:** how to get the name. Options are a join in the
    select or a small cached members map.

Other points:

- The cache currently caps the query at 200 rows ordered by due date. Keep
  the cap (my call). A rep's open work is far below 200. If a cap is ever
  hit, the oldest items are the ones that stay, so the red counts stay
  true.
- "Today" is the rep's local date, the same one the Home's day timeline
  uses. Not UTC.
- Account names come from the cached accounts, the way the Home already
  shows them.
- A planned visit closed through a debrief (`planned_action_id`, D46) gets
  `completed_at`, so it leaves Scheduled. An open visit in Scheduled really
  was never closed.
- The cache's 2-day window for closed items does not matter here, because
  only open items count.

## The My work page

- **Route:** **Builder's call.** Suggestion: `/my-work`. It is
  rep-facing and mobile-first.
- **Header:** the title "My work" and a back link to the Home.
- **Chips:** All · Do now · Plan · No priority · Scheduled. Each chip shows
  its count. The New chip appears only when the banner has items.
- **Filter from the Home:** the tap on a box sets the chip through the query
  string (`?f=do-now` and so on).
- **Groups:** inside the chosen filter, items are grouped by date:
  - **Late** for tasks, or **Overdue** for scheduled items;
  - **Today**;
  - **Next 2 business days**;
  - **Later**.
- **Order:** inside a group, by date, then by time.
- **One row** shows:
  - the action;
  - a tag with the box (Do now / Plan / No priority) or the kind (Visit /
    Call / Meeting);
  - the account name;
  - the date, plus the time when there is one;
  - for a scheduled item past its date, "never closed";
  - a source tag, read from `next_actions.activity_id` and the linked
    activity's `activity_type`. Add the type to the cache select as an
    embed; the cached activities cover only 30 days, so they are not
    enough. A PK activity shows "from a PK", any other activity shows
    "from a visit", and no activity shows nothing;
  - "from <Name>" when someone else gave it.
- **A tap on a row** opens the existing place where the item is edited:
  - a PK follow-up opens the PK item drawer;
  - a visit, call or meeting opens the same place the Agenda opens it;
  - any other follow-up opens what the Agenda uses.
  - **Builder's call:** reuse whatever the Agenda does today. Do not build a
    new editor.
- **Setting a priority:** each row needs a way to answer "important?" and
  to set the deadline, using the rules in the next section. "No priority"
  exists so the rep can classify items. If the control lives only inside the
  PK drawer today, move it into a shared component and use it here too.

## Deadlines and urgency (Andre, 11-10)

Andre: "we need deadlines, to have a metric for urgency and clarity on
what's pending". He also said: "the deadline also defines urgency, but if
something is marked urgent, assign 2 business days, unless the person gives
an even shorter deadline, then we override".

- **Every open item has a deadline.**
  - The deadline is `next_actions.due_date`, the column that today holds
    the alert date.
  - The PK alert rule (PK date + priority days) becomes the **default**
    deadline when nobody gives one.
- **Urgent is computed from the deadline. Nobody answers it.**
  - An item is urgent when its deadline is no more than **2 business days**
    away, or already passed.
  - Business days are Monday to Friday. Holidays are not counted (builder's
    call to add them later).
  - Urgency is worked out against today **every time the item is shown**.
    A Plan item whose deadline gets close moves into Do now by itself.
    That is the point of the deadline being the metric.
- **Marking something urgent sets the deadline.**
  - When the person, Say it or the agent says "urgent", the deadline
    becomes today + 2 business days.
  - If the person gives a shorter deadline, theirs wins.
  - So: deadline = the earlier of (the date they gave) and (today + 2
    business days).
- **Important is the only question left.** It is stored on the item.
  - **Builder's call:** a new boolean column `important`. Backfill from the
    current priority:
    - `DO_NOW` and `PLAN` → true;
    - `DELEGATE` → false;
    - `ELIMINATE` stays as it is (closed).
- **The priority is derived, not typed:**

  | | important | not important |
  |---|---|---|
  | urgent (deadline ≤ 2 business days) | **Do now** | **Plan** for a rep · **Delegate** for an admin or assistant |
  | not urgent | **Plan** | **Eliminate** (a suggestion; never saved without the person's yes) |

  - `important` is null → **No priority**.
  - The stored `priority` column stays, so the board, the export and the
    agent keep reading it.
  - Saving recomputes the stored `priority`. A nightly recompute (pg_cron,
    business-day aware) moves items that crossed into urgent.
  - **Builder's call:** whether to have the nightly job, or have every
    reader derive the priority with one shared function and keep the column
    only for sorting and export. Either way, one function in
    `src/lib/domain/` decides it, and the database mirrors that rule.
- **On screen** (the Home boxes, the page, the board's Alert column):
  - "due in 3d", "due today" or "**2d late**";
  - the red sub-lines become "**N late**";
  - the Home's Do now box also shows "N due ≤ 2d" when there are no late
    items.
  - The page's groups become **Late · Today · Next 2 business days · Later**.
- **The urgency metric:** "late" (deadline passed) and "due soon" (within 2
  business days) are the two numbers. They count per rep and stay
  comparable across reps for leadership later.
- **The agent:** `MATRIX_RULES` drops the URGENT question and asks only
  IMPORTANT. When the person names a date or says "urgent", the agent passes
  a deadline, using the rule above. Suggest priority on the board answers
  only "important".

## Reps and the matrix (no Delegate)

Andre (11-10): "a rep has no Delegate", and "urgent, not important" for a
rep **is Plan**.

- This applies everywhere a rep sets a priority: the new page, the PK
  drawer when a rep opens it, Say it, and the agent connector (through
  `givesWorkToOthers(role)`).
- The role that counts is the role of the item's **owner**: Delegate means
  "someone else can do it", and that only makes sense for an owner who can
  hand work over.
- Admins and assistants keep all four quadrants.
- A rep-owned item already stored as `DELEGATE` counts under **Plan** on
  the rep's Home and page.

## Done means

- A rep with the 11-10 data sees the following. Today is 11-10 for the
  Andre test case, and his own data will differ.
  - The Lezzer item (due 11-11, no priority) counts in **No priority**.
  - The Dykes item (due 11-13) also counts in **No priority**.
  - The two Ganahl visits count in **Scheduled**, with "2 overdue" in red.
  - The banner reads "**Bianca** gave you 2 items".
- A tap on each box opens the page on the matching chip.
- Opening the page clears the banner.
- With no signal, the block shows the cached numbers.
- Answering "important" on a No priority item moves it to Do now or Plan,
  depending on its deadline, both on the page and on the Home.
- Marking an item urgent sets its deadline to today + 2 business days,
  unless a shorter one was given.
- A Plan item whose deadline comes within 2 business days shows in Do now
  the next day, with no edit.
- A rep never sees Delegate as an outcome. An admin still does.
- Tests:
  - unit tests for the counting and grouping (pure functions in
    `src/lib/domain/`);
  - tests for the rep matrix mapping, the business-day math (a Friday + 2
    business days = Tuesday) and the urgent-sets-deadline rule;
  - the existing suites stay green.
- Check at 390 px with a real screenshot.
- Shipped to production on `main`.

# Offline & Mobile Architecture

> Companion to `01-TECHNICAL-SPEC.md` §5 and `00-PROJECT-CONTEXT.md` D3.
> Closes the gap flagged against D3: offline was specified only as a voice
> **outbox**. This makes offline a first-class, **two-sided** (read *and* write)
> layer, locks the client-platform posture, and names the iOS realities that
> otherwise surface three weeks into the build. New decisions **D55–D62**;
> **D3 is now Locked**.

---

## 0. Why this section exists

The reps are the whole reason the product is mobile-first (D2): trucks, jobsites,
dealer floors, dead-signal back rooms. Two things in the existing design make
offline *tractable*, and one thing makes it *dangerous* if left implicit.

- **Tractable:** "record once → update everything" makes writes **append-heavy**
  (a new Activity, a new Next Action, a voice blob). Appends are the easy case
  for an outbox — no true edit conflict. And D3 already rules that the sync layer
  talks to **Supabase directly, never through Vercel**, so RLS re-applies on
  replay and Vercel stays out of the offline hot path.
- **Dangerous if implicit:** the spec only ever described the *write* outbox. But
  D48 (every visit intentional, with an objective), D50 (champion), D52 (display
  wall) and D54 (agenda-driven home screens) all assume the rep can **see**
  account context — and a rep in a no-signal store who can't pull up the account
  in front of them has lost exactly the intentionality the model is built on.
  Read-side offline is therefore in scope, not optional.

---

## 1. Platform posture — D55

**PWA now, Capacitor-ready.** Ship as the Next.js PWA (D2). But isolate the
offline layer behind three narrow interfaces so a later move to a Capacitor /
native shell touches *none* of the feature code:

| Interface | PWA implementation today | Native swap later |
|---|---|---|
| `LocalStore` | IndexedDB (via Dexie) | SQLite |
| `SyncEngine` | foreground + connectivity-driven drain | + OS background sync |
| `BlobStore` | IndexedDB blobs | filesystem + Keychain/Keystore |
| `PushChannel` | Web Push (installed PWA, iOS 16.4+) | native push |

Feature code calls `LocalStore.upsert(...)` / `SyncEngine.enqueue(...)` and never
knows which backend is live. **Rule: no component imports IndexedDB/Dexie
directly.** That single discipline is what keeps the native exit cheap.

**Why not commit to native now:** the CRM logic, RLS and derived-views work is
the bulk of the build and is platform-agnostic. Prove the loop as a PWA; escalate
to Capacitor only if iOS reliability (see §6) proves insufficient in the field —
and by then the escalation is a shell swap, not a rewrite.

---

## 2. Offline scope — the working set — D56

Offline is **two-sided**: a **read cache** (what the rep can see) and a **write
outbox** (what the rep can capture). The read cache holds a bounded, per-rep
**"visit-ready working set,"** refreshed whenever the app is foregrounded online:

- **Agenda:** all `next_actions` / agenda items for **today + tomorrow**, with
  `objective` (D48) and planned/actual linkage (D46).
- **Accounts on that agenda**, each with the full context a rep needs at the
  door: contacts (incl. `is_champion`, D50), recent activities, open
  opportunities, first-class relationships (D4), `has_display_wall` /
  `display_last_verified_at` (D52), `parent_account_id` banner (D49).
- **The rep's own recent activities** (last ~30 days) so history reads locally.
- **Reference enums / picklists** (activity types, objectives, lead sources) so
  capture forms render with no network.

Explicitly **not** cached offline: manager/org-wide aggregates, dashboards,
other reps' data, full email bodies, and attachments (see §5 security). The
working set is *the rep's own scoped rows only* — which RLS already narrowed
server-side at fetch time.

---

## 3. Local store & outbox shape — D57

`LocalStore` = IndexedDB via **Dexie**. Object stores:

- **Cached read models** — `accounts`, `contacts`, `agenda`, `activities`,
  `opportunities`, `relationships`, one `meta` store for sync cursors
  (`last_pulled_at`, per-entity `history` markers).
- **`outbox`** — the durable write queue.
- **`blobs`** — raw audio / card images awaiting upload.

**Outbox record:**

```
{
  client_id,        // UUID minted on device — stable id, idempotency key
  entity_type,      // activity | next_action | contact_candidate | voice_capture | …
  op,               // create | update
  payload,          // the record fields (jsonb)
  base_version,     // server updated_at the client last read (LWW guard; null for creates)
  blob_ref,         // → blobs store, nullable
  status,           // pending | syncing | synced | rejected
  attempts,
  last_error,
  created_at        // device clock
}
```

**Client-generated UUIDs everywhere.** A record captured offline has a stable id
immediately; on replay the server **upserts on `client_id`** (or the D40 dedupe
key for contacts), so a double-fired sync is idempotent, never a duplicate.

---

## 4. Sync engine — D58

`SyncEngine` runs **pull** (refresh working set) and **push** (drain outbox).

**Triggers** — deliberately *not* the Background Sync API (unreliable/absent on
iOS, §6):

- app **foreground** / regained visibility,
- browser **`online`** event,
- **pull-to-refresh** (manual),
- a light **interval timer while foregrounded** (e.g. 60s).

**Push (drain):** FIFO over `outbox` where `status = pending`. Each op → Supabase
**directly** (D3). Server re-applies RLS + constraints. On `200` → `synced`. On
network/5xx → retry with backoff. On RLS/constraint **rejection** → `rejected`,
surfaced in an **error tray** for the rep (never silently dropped, §7).

**Pull:** refresh the §2 working set; reconcile into the cached read models by
`client_id`/server id. Keep it bounded — pull the working set, not the territory.

**Always-visible sync state.** Because iOS can't guarantee background sync, the
UI must show **"N items waiting to sync"** at all times, so a rep is never
misled into thinking a captured visit is safely uploaded when it is still on the
device.

---

## 5. Blobs, signed URLs & local security — D59 / D60

### Signed-URL timing — D59
Audio and business-card uploads go direct to Storage via signed URL (D14). Signed
URLs **expire** — so the outbox stores the **raw blob locally** and the signed URL
is minted at **sync time, never capture time**. Drain flow for a blob op:

1. request a signed upload URL from Supabase,
2. `PUT` the blob to Storage (`{org_id}/…` prefix per D21),
3. on `200`, enqueue the metadata op referencing the storage path,
4. purge the blob from IndexedDB once upload is confirmed.

A capture that sat offline for hours therefore uploads against a *fresh* URL, not
a dead one.

### Local data security — D60
Cached data is a **lost-device leak vector that lives outside RLS**. Rules:

- Cache **only the rep's own working set** (already RLS-scoped at fetch). Never
  manager/org-wide data on device.
- Request **persistent storage** (`navigator.storage.persist()`) to resist
  eviction.
- **Wipe the entire local DB on logout and on org switch.** D23 re-issues the JWT
  for a new active `org_id`; the previous tenant's cache must not linger on the
  device — this is a cross-tenant boundary (D16, D24) that would otherwise leak
  through the cache.
- PWA IndexedDB is **not encrypted at rest**, so on the PWA path cache commercial
  metadata only — **no full email bodies, no attachments offline**. The native
  path moves the DB key + blobs into Keychain/Keystore and can relax this.

---

## 6. iOS PWA realities — the platform footguns

The single biggest risk, and unmentioned in the original spec. Field reps skew
iPhone; iOS Safari PWAs are where naive offline plans break:

- **Background Sync unsupported** → sync only when foregrounded (§4). Design for
  it; don't assume the OS flushes the queue while the app is closed.
- **IndexedDB eviction under storage pressure** → request persistent storage,
  keep the working set small (§2), upload blobs promptly rather than hoarding
  audio on the device.
- **Web Push only on iOS 16.4+ and only when installed to the Home Screen** →
  exception alerts (§8 of the spec) **cannot rely on push** to reach a rep. Keep
  Workspace **mail** (D25 `gmail.send`) as the guaranteed alert channel; treat
  push as an enhancement, not the delivery guarantee.
- **Audio-capture MIME quirks** in iOS Safari → record to a Safari-supported
  format and validate at **capture** time, not upload time, so a rep never
  discovers in sync that the debrief was unplayable.

If field testing shows these erode the "capture cannot fail" guarantee (D3),
escalate to the Capacitor shell (D55) — a shell swap, because the offline layer
was built behind interfaces.

---

## 7. Conflict & RLS reconciliation — D61 / D62

### Conflict policy — D61
- **Appends never conflict** — new Activity, new Next Action, new
  contact/voice/card candidate all carry a client UUID and are inserts. This is
  the overwhelming majority of field writes.
- **Scalar edits** (mark a `next_action` done, reschedule it, advance an
  opportunity stage) use **last-write-wins keyed on server `updated_at`**. The
  client sends `base_version`; the server **rejects a stale write** rather than
  clobbering. Concretely: a manager reschedules a visit while the rep, offline,
  marks it done — on replay the stale field is rejected and the rep's change
  lands in the **error tray** to re-apply against fresh data, instead of silently
  stomping the manager's reschedule.

No CRDTs — the append-heavy model doesn't warrant them.

### RLS reconciliation — D62
The outbox replays **through Supabase, not Vercel** (D3), so every queued write
re-checks RLS and constraints server-side at replay. A write valid at capture but
invalid on replay — territory reassigned, membership suspended (D24), account
moved out of the rep's scope — lands in the **error tray**, surfaced to the rep,
**never silently dropped**. The error tray is a first-class surface, not a
console log.

---

## 8. Decisions added to the log

| # | Decision | Status |
|---|---|---|
| D3 | Offline-capable activity capture | **✅ Locked** (was: needs sign-off) |
| D55 | PWA now, **Capacitor-ready**: offline behind `LocalStore` / `SyncEngine` / `BlobStore` / `PushChannel` interfaces; no feature code imports IndexedDB directly | ✅ Locked |
| D56 | Offline is **two-sided** — read cache + write outbox. Read cache = bounded per-rep **visit-ready working set** (today+tomorrow agenda + full context for its accounts + rep's recent activity + enums) | ✅ Locked |
| D57 | `LocalStore` = IndexedDB/Dexie; durable `outbox` with **client-generated UUIDs**; server upserts on `client_id` (or D40 dedupe key) → idempotent replay | ✅ Locked |
| D58 | `SyncEngine` pull+push, triggered on foreground / `online` / pull-to-refresh / foreground interval — **not** Background Sync; **always-visible "N unsynced" state** | ✅ Locked |
| D59 | Signed upload URLs minted at **sync time, not capture time**; outbox holds the raw blob, purged after confirmed upload | ✅ Locked |
| D60 | Local cache security: rep's own working set only; `persist()`; **wipe DB on logout and org switch**; PWA caches **no email bodies/attachments** offline (unencrypted at rest) | ✅ Locked |
| D61 | Conflict policy: appends never conflict; scalar edits = **LWW on server `updated_at`**, stale writes rejected to the error tray, not clobbered | ✅ Locked |
| D62 | Outbox replays **through Supabase** (D3) so RLS re-checks on replay; writes invalid at replay land in the **error tray**, never silently dropped | ✅ Locked |

---

## 9. Build impact

- Adds an **error tray** surface to the app (D58/D61/D62) — small, but it must
  exist before offline writes ship, or rejected writes vanish.
- Adds the `LocalStore`/`SyncEngine`/`BlobStore`/`PushChannel` interfaces to the
  build-sequencing (context §6). They belong **with step 2 (Activity capture)**,
  since capture is the flow that must survive offline — not deferred to the voice
  step.
- Reconfirms mail (D25) as the guaranteed alert channel; push is enhancement.

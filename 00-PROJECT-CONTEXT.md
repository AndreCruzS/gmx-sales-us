# Commercial Operating System — Project Context

> **Purpose of this file:** single source of truth for the project. Attach to the
> Claude Project so any new conversation starts fully loaded. Update the
> Decisions Log as things change — never delete entries, supersede them.

---

## 1. What we are building

A purpose-built commercial operating system (CRM) for **building materials,
two-step distribution**:

`Manufacturer → Distributor → Dealer → Contractor / A&D`

It is **not** a generic CRM. It encodes one enforced operating loop:

```
Territory planning → Commercial activity (recorded once)
  → Project? / Opportunity? → Next action + date
  → Agenda → Management dashboard → priorities back to planning
```

### Core principle
**Record once → update everything.** The rep enters an activity one time; the
account history, agenda, opportunity timeline, and dashboards are *derived
views* over that single record. The rep should never think about "which module
do I update."

### The three operating rules (from source PDF)
1. Not every activity creates an opportunity — but **every activity is
   recorded** and builds account history.
2. One opportunity generates **many linked activities**, all tied back to the
   same opportunity.
3. Every important activity or opportunity must end with a **next action and a
   next-action date**.

### What makes this not off-the-shelf
- **Account relationships are a first-class many-to-many object.** A contractor
  buys from several dealers; an architect specs across distributors. Generic
  CRMs force a contractor to belong to one dealer — that breaks the model.
- **Project ≠ Opportunity.** A project can exist before any deal. One project
  may carry several opportunities (e.g. Thermo-Ayous cladding + Thermo-Ash
  decking).
- **Activity ≠ pipeline stage.** Samples, trainings, jobsite visits *advance* a
  stage; they are never stages themselves.
  - Pipeline stage answers: *where is this commercially?*
  - Activity answers: *what are we doing to move it?*

---

## 2. Source documents

| Document | Contents |
|---|---|
| `Commercial_Operating_System___Two-Step_Distribution.pdf` | The 4-section workflow: Territory Planning, Activity Workflow, Opportunity Workflow, Management & Reporting. Plus the 3 operating rules. |
| `Commercial_Operating_System_Architecture_UX.docx` | 19-section functional spec: core objects, relationship model, home screen UX, all flows, pipeline, exceptions, dashboard, navigation. |
| `02-OFFLINE-MOBILE-ARCHITECTURE.md` | The offline & mobile layer: platform posture, working set, outbox, sync engine, iOS realities, conflict & RLS reconciliation. Home of D55–D62. |

**Known gap:** neither source document describes the reps' actual **daily
routine**. → RESOLVED via Brazilian leadership audio (see §10 of the spec, D45–D54).

---

## 3. Stack (decided)

| Layer | Choice | Notes |
|---|---|---|
| Frontend | **Next.js** | PWA, mobile-first — reps are "on the road" |
| Hosting | **Vercel** | Colocate region with Supabase |
| Database | **Supabase Postgres** | RLS enforces rep vs. manager visibility at the DB |
| Auth | **Supabase Auth + Google** | Workspace org |
| Mail + Calendar | **Google Workspace API** | Service account + domain-wide delegation |
| AI | **Provider-agnostic via Vercel AI SDK** | Client owns Anthropic, OpenAI and Google console accounts |
| Transcription | **OpenAI Whisper / gpt-4o-transcribe or Google STT** | Anthropic cannot transcribe audio |
| Scheduling | **Vercel Cron triggers → pg_cron + SQL views** | Derivation logic lives next to the data |
| Offline | **PWA (Capacitor-ready) + IndexedDB outbox & read cache, syncing direct to Supabase** | See `02-OFFLINE-MOBILE-ARCHITECTURE.md` |

### Infra footguns already identified
- Use Supabase's **connection pooler (Supavisor, transaction mode)** from Vercel
  functions, or Postgres connections exhaust under concurrency.
- **Colocate regions** — Vercel functions and Supabase project in the same
  region (west US; accounts appear SoCal).
- Supabase Google sign-in gives *authentication* only. Sending Gmail and
  writing Calendar needs `gmail.send` / `calendar.events` scopes — either
  capture and refresh the provider token yourself, or use the service account
  with domain-wide delegation. **Delegation is the recommended path** for a
  Workspace-only org: it decouples "log in" from "act as."
- The offline sync layer talks to **Supabase directly**, not through Vercel.
  Vercel must stay out of the offline hot path. (Now fully specified — D55–D62.)

---

## 4. Decisions log

| # | Decision | Rationale | Status |
|---|---|---|---|
| D1 | Next.js + Supabase + Vercel + Google Workspace | Client's existing plan; well-matched to derived-views architecture | ✅ Locked |
| D2 | Mobile-first PWA | All users are field reps | ✅ Locked |
| D3 | Offline-capable activity capture | The one flow that cannot fail; voice debriefs often happen with no signal | ✅ **Locked** — fully specified in `02-OFFLINE-MOBILE-ARCHITECTURE.md` (D55–D62) |
| D4 | Account relationships as their own many-to-many table | Contractor↔multiple dealers; enables the commercial network view | ✅ Locked |
| D5 | Project and Opportunity are separate objects with separate decision gates | Project may precede any deal | ✅ Locked |
| D6 | Lead source on **both** Account and Opportunity | Different questions: how we met the company vs. what generated this deal | ✅ Locked |
| D7 | Referral-type lead sources point at a **referring Account FK**, and write an AccountRelationship | Makes referral chains queryable — which dealers feed us contractors, which architects drive spec | ✅ Locked |
| D8 | `OTHER` lead source requires `source_detail` via DB check constraint | Not client-side only | ✅ Locked |
| D9 | Voice debrief requires **human review before send** | An unreviewed AI summary reaching management destroys trust in the tool | ✅ Locked |
| D10 | Voice pipeline rejoins the **same** activity capture flow | A debrief produces a real Activity, not a parallel artifact | ✅ Locked |
| D11 | Calendar: **dedicated secondary calendar per rep**, owned by the service account | ACL per calendar gives manager-down visibility with no peer-to-peer leakage; survives rep offboarding | ✅ Locked |
| D12 | Postgres is source of truth; Calendar is a **projection** of NextAction | Same RLS hierarchy drives both, so permissions can't drift | ✅ Locked |
| D13 | Derivation logic in Postgres (SQL/materialized views, triggers, pg_cron); Vercel Cron only triggers | Not bound by Vercel cron quotas; makes record-once literal | ✅ Locked |
| D14 | Audio uploads go **direct to Supabase Storage via signed URL** | Too big/slow for the Vercel request path | ✅ Locked |
| D15 | Store `next_action_id` in Calendar event `extendedProperties` | Idempotent sync without a fragile ID map | ✅ Locked |
| D16 | **Multi-tenant** — `org_id` on every table, reusable across client companies | Decided before DDL; retrofitting later would be a rewrite | ✅ Locked |
| D17 | `org_id` denormalized onto join tables too | Lets RLS filter without joins on hot paths | ✅ Locked |
| D18 | Tenant identity via custom JWT claim read with `auth.jwt()` | Set at login, cannot be spoofed client-side | ✅ Locked |
| D19 | Keep Google domain-wide delegation; treat per-tenant admin authorization as a documented onboarding step | Tenants are few and high-touch; avoids managing per-user refresh tokens | ✅ Locked (revisit if self-serve is ever needed) |
| D20 | Per-org AI/integration credentials in `org_integrations`, encrypted via Supabase Vault | Each client owns their own Anthropic/OpenAI/Google console accounts | ✅ Locked |
| D21 | Storage paths prefixed by org, with matching Storage RLS policies | Leak vector lives outside the database | ✅ Locked |
| D22 | **Users can belong to many orgs.** `users` = identity only; `memberships` carries org-scoped role, territory, manager | A person may be rep in one org, admin in another | ✅ Locked |
| D23 | JWT carries an **active** `org_id`; UI has an org switcher that re-issues the claim | Supersedes the simpler D18 single-org claim | ✅ Locked |
| D24 | RLS verifies an **active membership exists** for the claimed org, not just the claim itself | A stale or tampered claim must not reach across tenants | ✅ Locked |
| D25 | One Google OAuth client (consent screen = **External**) for sign-in across all tenants; one service account authorized separately by each tenant's Workspace admin | Supabase allows one OAuth provider config — sufficient. Delegation also avoids Google's sensitive/restricted-scope verification review | ✅ Locked |
| D26 | **Gmail ingestion at Tier 2** — threads + attachments, `gmail.readonly` via delegation | Reps use a dedicated company-domain mailbox for this purpose. Makes the exception engine truthful instead of dependent on manual logging | ✅ Locked |
| D27 | ~~Per-org sender/domain exclusion list as a required guardrail~~ **SUPERSEDED by D35.** Retained only as an optional per-org safety net | The contact-match filter already excludes HR/payroll/benefits — they are never CRM contacts. The exclusion list solved a problem the design solves | ⚠️ Downgraded to optional |
| D35 | **Contact matching IS the privacy boundary.** A thread with no participant matching a Contact in that org is never fetched or parsed | Simpler and stronger than a blocklist: noise is excluded by construction, not by enumeration | ✅ Locked |
| D36 | Unknown-sender lead detection is **metadata only** — sender, domain, timestamp, subject. No body parsing | Original proposal operated on exactly the non-matching mail D35 excludes; this closed the back door | ✅ Locked |
| D37 | **Retroactive backfill**: creating a Contact or Account syncs their prior threads | Contact-gating otherwise makes new prospects invisible until added; backfill means adding the contact is the switch | ✅ Locked |
| D45 | **Capture default = one note + follow-up flag.** Full structured form optional, enriched later by AI or at desk | Direct from leadership: "não acho que ele vai preencher um formulário inteiro de lead". >15s in a truck = won't happen | ✅ Locked — supersedes the multi-step capture flow in diagram 1 |
| D46 | **Planned vs actual is first-class.** Agenda items are advance commitments; activities link back as planned-done / planned-not-done / unplanned | Manager's real question is "ele falou que ia visitar tal coisa, como é que foi?". Mileage is reimbursed, so this is cost control | ✅ Locked |
| D47 | Next week's agenda due **by Friday**; "next week not planned" becomes an exception | "até sexta-feira, eles deveriam ter uma agenda pronta para a semana subsequente" | ✅ Locked |
| D48 | **Visit objective required at scheduling**, from a picklist + free text (collect quote · meet contractor · convert to stocking dealer · follow up lead · PK delivery · merchandising check · relationship maintenance) | "cada visita deveria ser intencional". Enables objective-vs-outcome coaching reports | ✅ Locked |
| D49 | **Accounts are branch-level** with `parent_account_id` for the banner/chain (Ganahl Anaheim ≠ Ganahl Orange) | Different manager, different stocking decisions. Activities/relationships attach to branch; reporting rolls up | ✅ Locked — schema correction |
| D50 | **`is_champion`** ("capitão") on contacts, one per account | An elected internal champion, not a job title. Enables "strategic account without champion" exception | ✅ Locked |
| D51 | Business card account naming = **brand + city** | Matches how they already name stores | ✅ Locked |
| D52 | **Merchandising/display wall** as account attribute + "display not verified in N months" exception | Deon actively checks display walls on store visits | ✅ Locked |
| D53 | **Assistant/support membership role** (e.g. Eric supporting TJ) — can act on a rep's behalf | Affects RLS: support sees and writes for assigned reps | ✅ Locked |
| D54 | Two rep archetypes share one data model but get **different home screen modes**: travel/PK+desk (TJ) vs daily-visit (Deon/Alejandro/Jason) | Their days have genuinely different shapes | ✅ Locked |
| D39 | **Unified contact intake**: manual, voice, business card, email metadata all converge on `contact_candidates` + one review queue | Four parallel paths would create the same person three times | ✅ Locked |
| D40 | Dedupe order: normalized email (auto-merge) → E.164 phone → name+account fuzzy via `pg_trgm` (propose only, never auto-merge) | Cards and email metadata collide constantly | ✅ Locked |
| D41 | **Business card reader**: photo → vision model, per-field confidence scores, low-confidence fields flagged for review | Card layouts vary wildly and reps scribble on them. Vision works across all three providers, unlike transcription | ✅ Locked |
| D42 | Card images to Storage `{org_id}/cards/`, kept on TTL after extraction | Useful for correcting a bad parse | ✅ Locked |
| D43 | Card company → match Account; if none, prompt to create, forcing lead-source attribution at first contact | Ties card capture to D6/D8 | ✅ Locked |
| D44 | **Infer lead source from context**: recent `PK_TRAINING` activity → default `PK_CLASS`; trade show context → `TRADE_SHOW`. Rep can override | Keeps attribution honest instead of everyone tapping `OTHER` | ✅ Locked |
| D38 | Supabase Storage for bodies and attachments: `{org_id}/email/{sha256}` for attachments, `{org_id}/email/bodies/{message_id}` (TTL-purged); Storage RLS enforces the org prefix; signed URLs only | Confirmed | ✅ Locked |
| D28 | **Thread is the unit of extraction**, not message | A commitment spans multiple messages; message-level extraction double-counts or misses | ✅ Locked |
| D29 | Retention: derived data forever · raw bodies on TTL (default 90d, per-org configurable) · attachments kept only if linked to a record | Permanent commercial record without indefinite custody of full correspondence; caps Storage cost | ✅ Locked |
| D30 | Attachments: filter inline/`cid:` and <20KB · dedupe by SHA-256 · download eagerly to Storage · signed URLs only · never render inline | Gmail attachment IDs aren't durable; signature logos otherwise flood storage; external files are untrusted | ✅ Locked |
| D31 | Auto-link classified attachments: quotes → Opportunity, specs/submittals → Project, photos → Project timeline | Feeds "quotes outstanding" and "quote without follow-up" without manual entry | ✅ Locked |
| D32 | Email-derived output enters the **same review queue as voice** | One mental model: the system drafts, the human commits. Nothing silently creates records | ✅ Locked |
| D33 | Sync via `historyId` polling on Vercel Cron (not `users.watch`/Pub-Sub initially) | Watch subscriptions expire weekly and add a renewal failure mode not needed on day one | ✅ Locked |
| D34 | Match participants to contacts **before** any AI call; re-extract only on thread change | Token spend scales with commercial activity, not mailbox size | ✅ Locked |
| D55 | **PWA now, Capacitor-ready.** Offline behind `LocalStore` / `SyncEngine` / `BlobStore` / `PushChannel` interfaces; no feature code imports IndexedDB directly, so a native-shell escalation is a swap not a rewrite | The CRM/RLS bulk is platform-agnostic; prove the loop as a PWA, escalate only if iOS reliability demands it | ✅ Locked |
| D56 | **Offline is two-sided** — read cache + write outbox. Read cache = bounded per-rep **visit-ready working set**: today+tomorrow agenda, full context for its accounts (champion, display wall, relationships, history), rep's recent activity, enums | Original spec only had the write outbox; D48/D50/D52/D54 all assume the rep can *see* account context at a no-signal store | ✅ Locked |
| D57 | `LocalStore` = IndexedDB/Dexie; durable `outbox` with **client-generated UUIDs**; server **upserts on `client_id`** (or D40 dedupe key) → idempotent replay | Stable ids offline; a double-fired sync is idempotent, never a duplicate | ✅ Locked |
| D58 | `SyncEngine` pull+push triggered on foreground / `online` / pull-to-refresh / foreground interval — **not** Background Sync; **always-visible "N unsynced" state**; rejected writes → error tray | iOS can't guarantee background sync; the rep must never think a captured visit uploaded when it didn't | ✅ Locked |
| D59 | Signed upload URLs minted at **sync time, not capture time**; outbox holds the raw blob, purged after confirmed upload | Signed URLs expire; a capture offline for hours must upload against a fresh URL | ✅ Locked |
| D60 | Local cache security: rep's own working set only; `navigator.storage.persist()`; **wipe DB on logout and org switch** (D23/D24 boundary); PWA caches **no email bodies/attachments** offline (unencrypted at rest) | Cached data is a lost-device leak vector living outside RLS; the cache must not become a cross-tenant back door | ✅ Locked |
| D61 | Conflict policy: appends never conflict; scalar edits = **LWW on server `updated_at`**, stale writes **rejected to the error tray**, not clobbered | Append-heavy model doesn't warrant CRDTs; a manager reschedule must not be silently stomped by an offline rep edit | ✅ Locked |
| D62 | Outbox replays **through Supabase** (D3), so RLS + constraints re-check on replay; writes invalid at replay (reassigned territory, suspended membership) land in the **error tray**, never silently dropped | Keeps Vercel out of the offline hot path and the tenant/hierarchy boundary authoritative at replay | ✅ Locked |

---

## 5. Open questions — **answer these before writing DDL**

| # | Question | Why it matters |
|---|---|---|
| Q1 | ~~Multi-tenant or bespoke?~~ **RESOLVED → multi-tenant.** See D16–D21. | — |
| Q9 | ~~Can one person belong to more than one org?~~ **RESOLVED → yes.** See D22–D24. | — |
| Q2 | **Who is "the admin"** receiving voice debrief summaries — the rep's own manager, or a central ops person? | Decides notification routing and Calendar ACL topology (blanket reader rule vs. ACLs derived from `manager_id`) |
| Q3 | **AI extraction depth:** full extraction into Activity + NextAction records, or summary-only? | Recommended: full extraction — that's what feeds the loop. More prompt work up front, but it's where the payoff is. |
| Q4 | ~~What is the reps' actual daily routine?~~ **RESOLVED** via Brazilian leadership audio, 2026-07-18. See D45–D54 and §10. | — |
| Q5 | **Two-way Calendar sync**, or one-way write? | One-way is far simpler. Two-way needs push notification channels + reconciliation. |
| Q6 | **Validate the lead-source enum** against their real last ~50 leads | Confirms nothing is dead weight and catches a common source we didn't think of |
| Q7 | Do reps ever debrief in **Spanish**? | Transcription language config |
| Q8 | Does `MANUFACTURER_LEAD` apply to this client? | Common in two-step, but confirm |
| Q10 | Has the client put email processing **in writing** in rep onboarding? | Employee email monitoring requires notice in several jurisdictions; involve their HR, not just IT |
| Q12 | Confirm `gmail.readonly` under domain-wide delegation still avoids Google's third-party security assessment | Restricted-scope policy changes periodically — verify before committing |
| Q13 | **iOS PWA field reliability** — does best-effort foreground sync hold up in real truck/store use, or do we need the Capacitor shell (D55)? | Decides whether the native escalation is day-one or later; test before committing the shell |

---

## 6. Build sequencing (recommended)

1. **Schema + RLS** — the foundation everything derives from
2. **Activity capture** — the one flow that must be flawless. **Build the offline
   `LocalStore` / `SyncEngine` / `BlobStore` interfaces + error tray here** (D55–D62),
   not deferred to the voice step
3. **Agenda + exception engine** — where the loop closes
4. **Voice debrief** — deliberately *after* the loop works; it's an input into
   the model, so the model must be right first
5. **Dashboards + weekly review** — pure derivation, comes cheap once 1–4 exist
6. **Calendar + mail integration** — can run parallel to 4–5

---

## 7. How to resume this project

Open a new chat in the Claude Project and say:

> Read `00-PROJECT-CONTEXT.md`. We're continuing the Commercial Operating
> System build. Last thing we did was **[X]**. Next I want to **[Y]**.

Then update this file at the end of each working session:
- add new rows to the **Decisions Log** (supersede, never delete)
- move answered items out of **Open Questions** into the log
- note where you stopped in the section below

### Session state
- **Last updated:** 2026-07-22 (**Phase 1 complete: schema + RLS**)
- **Completed:** everything previously listed, plus **Phase 1 Postgres DDL** —
  13 migrations under `supabase/migrations/` (enums + `lead_source` domain, all
  tables incl. email/candidate tables, D7/D8/D50 constraints, opportunity stage
  gate trigger, `user_hierarchy` closure table, default-deny RLS with
  manager-down/support visibility, storage buckets + policies, indexes,
  grants); seed with two orgs; **51 pgTAP tests green** (leakage suite,
  visibility matrix, constraints, stage gate) run by `supabase test db`; CI
  workflow `.github/workflows/db-tests.yml`. Implementation decisions (1–9,
  incl. membership-scoped ownership, closure-table hierarchy, WON/LOST stage
  exemption, Rule 3 as app guard, proposed enum values) documented in
  `supabase/README.md` — pending review, none contradicts D1–D62.
- **Next up:** **Phase 2 — Activity capture + offline layer** (capture UI with
  D45 one-note default, `LocalStore`/`SyncEngine`/`BlobStore`/`PushChannel`
  interfaces, outbox, error tray). Live project recreated 2026-07-22 in
  **us-west-1** (`eliaqtsxlunbnrcjdcef`) per the colocation decision; all 13
  migrations applied and in sync. Before Phase 2: confirm the proposed enum
  values (supabase/README.md §9). Q2/Q3 still open, still non-blocking.

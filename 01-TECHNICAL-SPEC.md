# Commercial Operating System — Technical Specification

> Companion to `00-PROJECT-CONTEXT.md`. This is the *what to build*; the context
> file is the *why and what's decided*.

---

## 1. Entity model

> **Multi-tenant.** Every table below carries `org_id` (FK → `organizations`),
> including join tables. See §4a for the tenancy model.

### Tenancy

**`organizations`**
- `id`, `name`, `slug`, `workspace_domain`, `status`, `created_at`
- `workspace_domain` — the tenant's Google Workspace domain, used for
  delegation and to validate sign-ins

**`org_integrations`** — per-tenant credentials
- `org_id`, `provider` (anthropic | openai | google | workspace)
- `credential_ref` → **Supabase Vault secret, never a plain column**
- `config` (jsonb), `status`, `last_verified_at`

### Core spine

**`users`** — identity only, **not org-scoped**
- `id`, `email`, `full_name`, `avatar_url`, `last_active_org_id`

**`memberships`** — org-scoped attributes (a person may belong to many orgs)
- `user_id`, `org_id`, `role` (rep | manager | admin)
- `territory_id`, `manager_id` → FK to another membership, drives the hierarchy
- `status` (active | suspended), `joined_at`

**`territories`**
- `id`, `name`, `region`
- Scoping dimension for RLS and reporting

**`accounts`**
- `id`, `name`, `account_type`, `website`, `address`, `city`, `state`
- `territory_id`, `owner_id`
- `strategic_importance`, `relationship_status`
- `lead_source`, `source_detail`, `referring_account_id` → self-FK

**`contacts`**
- `id`, `account_id`, `name`, `job_title`, `email`, `phone`
- `influence_level`, `relationship_status`

**`account_relationships`** — the many-to-many network
- `id`, `account_a_id`, `relationship_type`, `account_b_id`
- `strength`, `status`, `notes`, `created_by`, `last_confirmed_at`

### The loop

**`activities`**
- `id`, `activity_type`, `primary_account_id`, `owner_id`
- `occurred_at`, `location`, `purpose`, `was_planned`, `objective`
- `what_happened`, `key_information`, `commercial_potential`
- `outcomes` (jsonb array of outcome flags)
- `opportunity_id` (nullable — links supporting activities back, Rule 2)

**`activity_accounts`** — join: one activity can involve several accounts
- `activity_id`, `account_id`, `role`

**`activity_contacts`** — join
- `activity_id`, `contact_id`

**`projects`**
- `id`, `name`, `location`, `project_type`
- `estimated_construction_date`, `estimated_completion_date`
- `status`, `estimated_size`, `notes`

**`project_stakeholders`** — join: where the ecosystem converges
- `project_id`, `account_id`, `stakeholder_role`

**`opportunities`**
- `id`, `name`, `project_id` (nullable), `primary_account_id`
- `territory_id`, `owner_id`
- `product`, `application`, `estimated_quantity`, `estimated_revenue`
- `probability`, `expected_close_date`
- `distributor_id`, `dealer_id` — channel
- `architect_id`, `contractor_id`, `builder_id`, `developer_id` — influencers
- `competitor`, `alternative_product`, `risk`
- `stage`, `current_status`, `current_blocker`
- `lead_source`, `source_detail`, `referring_account_id`

**`next_actions`** — the agenda *and* half the exception engine
- `id`, `action`, `owner_id`, `due_date`, `completed_at`
- `account_id`, `project_id`, `opportunity_id` (all nullable)
- `calendar_event_id` — for the Google Calendar projection

**`voice_captures`**
- `id`, `owner_id`, `audio_path`, `duration_seconds`
- `transcript`, `ai_draft` (jsonb), `status`
- `activity_id` (nullable until sent), `reviewed_at`, `sent_at`

### Derived — **not stored**

SQL / materialized views over the above:
- Rep agenda (today, this week, requires attention)
- Account history timeline
- Opportunity timeline (built from linked activities)
- Commercial network view (distributor/dealer downstream demand)
- Management dashboard aggregates
- Weekly commercial review inputs

---

## 2. Enums

### `account_type`
`DISTRIBUTOR` · `DEALER` · `CONTRACTOR` · `ARCHITECT` · `BUILDER` · `OTHER`

### `activity_type`
`DEALER_VISIT` · `DISTRIBUTOR_VISIT` · `CONTRACTOR_MEETING` ·
`ARCHITECT_MEETING` · `JOBSITE_VISIT` · `PK_TRAINING` · `PHONE_CALL` ·
`QUOTE_FOLLOWUP` · `SAMPLE_FOLLOWUP` · `EMAIL` · `OTHER`

### `activity_outcome`
`RELATIONSHIP_DEVELOPMENT` · `OPPORTUNITY_IDENTIFIED` · `PROJECT_IDENTIFIED` ·
`QUOTE_REQUESTED` · `SAMPLE_REQUESTED` · `TECHNICAL_SUPPORT_NEEDED` ·
`TRAINING_NEEDED` · `NO_IMMEDIATE_OPPORTUNITY`

### `opportunity_stage`
`IDENTIFIED` → `QUALIFIED` → `DEVELOPMENT` → `QUOTE` → `DECISION` →
`WON` | `LOST` | `ON_HOLD`

### `relationship_type`
`SUPPLIES` · `PURCHASES_FROM` · `WORKS_WITH` · `REFERRED_BY` · `REFERRED_TO` ·
`SPECIFIES_THROUGH` · `SUPPORTS` · `PREFERRED_PARTNER` · `INSTALLER_FOR` ·
`ARCHITECT_FOR` · `DEVELOPER_FOR`

### `lead_source`

**Referral / network-driven** — these prompt for a referring Account and write
an `account_relationships` row:
- `REFERRAL_DEALER` — Dealer referral
- `REFERRAL_DISTRIBUTOR` — Distributor referral
- `REFERRAL_CONTRACTOR` — Contractor referral
- `REFERRAL_ARCHITECT` — Architect / designer referral
- `SPEC_DRIVEN` — Architect specified the product
- `REFERRAL_OTHER` — Other referral, still points at an account

**Rep-generated / field**
- `PK_CLASS` — PK class attendee
- `JOBSITE` — Jobsite visit / walk-up
- `COLD_OUTREACH` — Cold call or prospecting
- `EXISTING_RELATIONSHIP` — Already known account
- `TRADE_SHOW` — Trade show or industry event

**Inbound / marketing**
- `INBOUND_WEB` — Website or web form
- `MARKETING_CAMPAIGN` — Campaign or email blast
- `MANUFACTURER_LEAD` — Passed down from the manufacturer
- `SOCIAL` — Social or online community
- `OTHER` — **requires** `source_detail`

**Mobile sheet:** surface `REFERRAL_DEALER`, `PK_CLASS`, `JOBSITE`,
`EXISTING_RELATIONSHIP`, `INBOUND_WEB` first; rest behind "more."

**Anti-decay guards for `OTHER`:**
1. Validate the enum against the client's real last ~50 leads before freezing
2. Admin review that promotes recurring `OTHER` values into first-class options

**Required at creation** — attribution entered a week later is fiction.

### `voice_capture_status`
`PENDING` → `UPLOADED` → `TRANSCRIBED` → `DRAFTED` → `REVIEWED` → `SENT` |
`DISCARDED` | `FAILED`

---

## 3. Constraints worth enforcing in the DB

- `lead_source = 'OTHER'` ⟹ `source_detail IS NOT NULL` (check constraint)
- Referral-type `lead_source` ⟹ `referring_account_id IS NOT NULL`
- `account_relationships`: no self-reference (`account_a_id <> account_b_id`);
  unique on (a, type, b)
- Opportunity stage transitions: every stage requires `current_status`,
  `next action` and `next-action date` — enforce via trigger, per source PDF
- Rule 3: activities flagged as important cannot close without a linked
  `next_action` — enforce via trigger or app-level guard

---

## 4a. Tenancy model

- `org_id` on **every** table, including join tables (`activity_accounts`,
  `activity_contacts`, `project_stakeholders`, `account_relationships`).
  Denormalized deliberately — RLS filters without joins on hot paths.
- **All unique constraints scoped by org.** Account names, territory names etc.
  are unique per tenant, not globally.
- Tenant identity travels in a **custom JWT claim** carrying the *active*
  `org_id`, read via `auth.jwt() ->> 'org_id'`. A UI org-switcher re-issues it.
- Policies must **verify an active membership exists** for the claimed org —
  never trust the claim alone.
- **Storage:** voice audio paths prefixed `{org_id}/{user_id}/{capture_id}`,
  with Storage RLS policies enforcing the prefix. This is a leak vector that
  lives *outside* the database — do not skip it.
- Users may belong to **multiple orgs** (D22): `users` is identity, `memberships`
  is org-scoped role/territory/manager.

### Google Workspace under multi-tenancy

**Two separate credentials — do not conflate them:**

| | Purpose | Count | Where configured |
|---|---|---|---|
| **OAuth client** | Sign-in (Supabase Auth) | **One, for all tenants** | Your Google Cloud project. Consent screen user type must be **External** — Internal restricts sign-in to your own domain |
| **Service account** | Acting as users: `gmail.send`, calendar writes | **One**, authorized N times | Your Google Cloud project; each tenant's admin authorizes its client ID in their own console |

Supabase allowing only one Google provider config is not a constraint here —
one External OAuth client serves every tenant.

The service account mints a token impersonating a user (`sub` = their email)
and calls the API as them. It only works for domains that have authorized it.

**Why this split matters:** `gmail.send` and calendar scopes are
sensitive/restricted. Requesting them via per-user OAuth would trigger Google's
verification review, including a third-party security assessment for restricted
scopes. Delegation avoids that entirely, and the Supabase sign-in client only
ever requests basic profile scopes.

Domain-wide delegation is authorized by **each tenant's own Workspace admin**,
in their admin console (Security → Access and data control → API controls →
Domain-wide delegation), against your service account's client ID and an
explicit scope list. It does not propagate automatically across tenants.

**Per-tenant onboarding checklist:** send the Workspace admin your service
account client ID + required scopes → they authorize → verify with a test
impersonation call → mark `org_integrations.status = verified`.

→ **Decision D19:** keep delegation, treat authorization as a documented
per-tenant onboarding step. Revisit only if self-serve signup becomes a
requirement, in which case switch to per-user OAuth with stored refresh tokens.

Validate at sign-in that the user's email domain matches the org's
`workspace_domain`.

---

## 4. Row Level Security

Visibility is a **fan-out from manager down, never sideways between peers.**

- **Rep** — sees rows where `owner_id = auth.uid()`, plus accounts in their
  territory
- **Manager** — sees rows owned by any user whose `manager_id` chain resolves to
  them (recursive CTE in the policy, or a materialized `user_hierarchy` table
  for performance)
- **Admin** — org-wide read

Every policy carries an additional `org_id = (auth.jwt() ->> 'org_id')::uuid`
clause. The tenant boundary is the outer gate; the rep/manager hierarchy nests
inside it.

The same hierarchy drives Google Calendar ACLs, so app permissions and calendar
permissions cannot drift apart.

> **Testing note:** write a cross-tenant leakage test suite before building
> features on top of RLS. Seed two orgs, authenticate as a user in each, and
> assert every table returns zero foreign rows. Run it in CI — a policy added
> later without the `org_id` clause is silent until it isn't.

---

## 5. Voice debrief pipeline

Typical trigger: a rep finishing a **PK (Product Knowledge) class** and
recording feedback, next steps and follow-ups from the truck.

1. **Capture** — record on phone. Often no signal → must survive offline.
2. **Queue** — write locally (IndexedDB outbox) if offline; sync when back.
3. **Upload** — direct to Supabase Storage via signed URL. Upload completion
   fires the job.
4. **Transcribe** — async background job → OpenAI or Google STT. Single-speaker
   monologue, no diarization needed. Confirm language (see Q7).
5. **Structure** — AI extracts **both** the prose summary *and* the structured
   Activity fields (what happened, key information learned, commercial
   potential, follow-up required) plus concrete Next Actions with dates.
6. **Review** — rep sees transcript + summary + extracted next actions and
   edits. **Nothing sends without this gate.**
7. **Fan-out on send** — Activity written · Next Actions created and pushed to
   the agenda · account history updated · admin notified via Workspace mail +
   in-app.

The pipeline **rejoins the standard activity capture flow** at the outcome step.
It is not a parallel path.

---

## 5a. Gmail ingestion (Tier 2)

Reps use a **dedicated company-domain mailbox** for commercial work. Scope:
`gmail.readonly`, granted per tenant via domain-wide delegation.

### Why it matters
The exception engine is otherwise blind to email and therefore *wrong*:
"strategic account without recent activity" fires on accounts emailed three
times last week; "quote without follow-up" flags quotes chased by email.
Email visibility makes existing metrics true. And Rule 3 is really about
promises — which are made in email far more than in CRM forms.

### The privacy boundary is contact matching (D35)
A thread is fetched and parsed **only if at least one participant matches a
Contact in that org**. HR, payroll, benefits vendors and recruiters are never
CRM contacts, so they are excluded *by construction* — no blocklist needed.

- Optional per-org exclusion list remains available as a safety net for the rare
  case where a sensitive counterparty is also a legitimate contact (D27,
  downgraded — not required)
- Unknown senders: **metadata only** (sender, domain, timestamp, subject) to
  offer "add as new lead." No body is fetched (D36)
- **Retroactive backfill** (D37): creating a Contact or Account triggers a sync
  of their prior threads, so contact-gating loses nothing historically

### Guardrails
- Email processing must be **documented in rep onboarding** by the client
  (see Q10) — involve their HR, not only IT
- Retention (D29): derived forever · raw bodies TTL default 90d, per-org
  configurable · unlinked attachments purged on the same TTL

### Tables

**`email_threads`** — the unit of extraction (D28)
- `id`, `org_id`, `membership_id`, `gmail_thread_id`
- `subject`, `participants` (jsonb), `matched_account_id`, `matched_contact_id`
- `first_message_at`, `last_message_at`, `last_direction`
- `open_commitments` (jsonb), `status`
- `linked_opportunity_id`, `linked_project_id`, `last_extracted_at`

**`email_messages`**
- `id`, `org_id`, `thread_id`, `gmail_message_id`
- `from_addr`, `to_addrs`, `cc_addrs`, `sent_at`, `direction`
- `snippet`, `body_ref` (Storage path, purged on TTL), `has_attachments`

**`email_attachments`**
- `id`, `org_id`, `message_id`, `filename`, `mime_type`, `size_bytes`
- `sha256` (dedupe key), `storage_path`
- `classification` (quote | spec_sheet | drawing | submittal | photo | invoice | other)
- `linked_opportunity_id`, `linked_project_id`

**`email_sync_state`**
- `membership_id`, `org_id`, `history_id`, `last_synced_at`, `status`

**`org_email_exclusions`**
- `org_id`, `pattern` (domain or address), `reason`

### Attachment handling (D30)
1. Skip `Content-Disposition: inline`, `cid:` references, and files <20KB —
   otherwise every signature logo is stored thousands of times
2. Dedupe by **SHA-256**; store once, reference many
3. **Download eagerly** at sync time — Gmail attachment IDs are tied to the
   message and are not durable handles
4. **Supabase Storage** (D38): attachments at `{org_id}/email/{sha256}`, bodies
   at `{org_id}/email/bodies/{message_id}` (TTL-purged). Storage RLS enforces
   the org prefix. Serve **only via signed URLs**
5. Treat as hostile: no inline rendering, no auto-execution, consider scanning

### Auto-linking (D31)
- Quote PDFs → Opportunity — feeds *quotes outstanding* / *quote without
  follow-up* on the dashboard
- Spec sheets & submittals → Project — makes architect spec activity visible
- Jobsite photos → Project timeline

### Extraction
Per thread, AI proposes: activity summary · commitments with dates and owner ·
meeting/visit bookings · contact enrichment from signatures · relationship
signals · attachment classification.

All output lands in the **same review queue as voice** (D32). Nothing becomes an
Activity or Next Action without rep confirmation.

Efficiency (D34): match participants against `contacts` *before* any AI call;
re-extract only when the thread changes.

### Sync (D33)
`historyId` polling on Vercel Cron. Background jobs only, never the request
path. Store `history_id` per membership; on a "history too old" error, fall back
to a bounded full resync. `users.watch` + Pub/Sub can come later.

### Related model changes
- Add `EMAIL` to `activity_type`
- Inbound from an unknown domain → **new lead candidate** from metadata only
  (D36), forcing lead-source attribution at first contact rather than from memory
- Email graph may **propose** account relationships (a dealer CC'ing a
  contractor) — propose only, never assert; inferred relationships are often wrong

---

## 5b. Unified contact intake

All contact creation paths converge on **one** candidate queue (D39) —
never four parallel flows, or the same person is created three times.

**`contact_candidates`**
- `id`, `org_id`, `created_by` (membership)
- `source` — `MANUAL` | `VOICE` | `BUSINESS_CARD` | `EMAIL_METADATA`
- `raw_ref` — Storage path (card image / audio), nullable
- `extracted` (jsonb, **per-field confidence scores**)
- `matched_contact_id`, `matched_account_id`, `status`, `resolved_at`

### Dedupe order (D40)
1. **Normalized email** (lowercase, trimmed) — exact match ⇒ same person,
   auto-merge
2. **Phone normalized to E.164** — strong signal
3. **Name + account fuzzy** via `pg_trgm` — *propose* merge, never auto-merge

Cards and email metadata collide constantly: a card scanned Tuesday, an email
Thursday. This ordering resolves it without duplicates.

### Business card reader (D41–D43)
- Photo → **vision model**. Unlike transcription, this works across Anthropic,
  OpenAI and Google — so it stays provider-agnostic
- Extract: name · title · company · email · phone · address, each with a
  confidence score. Low-confidence fields are flagged, never silently accepted
- Queue offline like audio; upload direct to Storage `{org_id}/cards/`, image
  kept on TTL for parse correction
- **Company matching:** card company → existing Account? Attach. No match →
  prompt to create, which forces lead-source attribution at first contact

### Contextual lead-source inference (D44)
- Recent `PK_TRAINING` activity → default new cards to `PK_CLASS`
- Trade show context → `TRADE_SHOW`
- Rep can always override

The default will usually be right, which is what stops everyone defaulting to
`OTHER`.

Email-metadata candidates cannot infer a source — the rep picks, at the moment
the contact has just reached out.

---

## 6. Google Workspace integration

### Auth
Service account with **domain-wide delegation**, acting on behalf of users.
Decouples "log in" from "act as," and survives rep offboarding.

### Calendar — visibility model
- One **secondary calendar per rep**, owned by the service account
  (e.g. "Commercial OS — J. Silva")
- ACLs: rep = `writer` (or `reader` if the app is sole author); manager =
  `reader`; admin = `reader` on all
- **No `default` rule, no domain-wide rule** — this is what prevents reps from
  seeing each other
- Managers subscribe to their team's calendars and overlay them; each rep sees
  only their own

**Verify with the Workspace admin:** the domain-level calendar sharing default
can expose free-busy or full details org-wide. It applies to *primary*
calendars, so this design sidesteps it — but confirm rather than assume.

### Calendar — sync mechanics
- Calendar is a **projection** of `next_actions`, never the source of truth
- On next-action create/update → upsert Calendar event
- Store `next_action_id` in the event's private `extendedProperties` →
  idempotent, no fragile ID map
- Two-way sync (rep edits date in Google → flows back) needs push notification
  channels + reconciliation. **Open — see Q5.** One-way write is far simpler.

### Mail
`gmail.send` via the same delegation. Used for voice debrief summaries,
exception alerts, weekly review delivery.

---

## 7. Scheduled work

| Job | Trigger | Runs where |
|---|---|---|
| Exception scan (overdue follow-ups, opportunities with no next action, stale opportunities, quiet strategic accounts, quotes without follow-up) | Vercel Cron | Postgres — SQL/materialized views |
| Weekly commercial review generation | Vercel Cron | Postgres for the data, Vercel function for the AI narrative |
| Dashboard aggregate refresh | pg_cron | Postgres |
| Calendar reconciliation | Vercel Cron | Vercel function → Google API |

Vercel **calls**; Postgres **does**. Keeps derivation next to the data and
outside Vercel's cron quotas.

---

## 8. Management by exception

Surfaced automatically, never manually searched for:
- Opportunity without next action
- Overdue follow-up
- Quote without follow-up
- Strategic account without recent activity
- Opportunity inactive beyond a defined period
- Project without assigned dealer
- Contractor relationship not updated
- New account with no follow-up

---

## 10. Rep routine — research findings

Source: Brazilian project leadership, audio discussion 2026-07-18. Resolves Q4.

### Two archetypes

| | **TJ (Buffalo)** | **Deon / Alejandro / Jason (California)** |
|---|---|---|
| Base | Home-based | Field, daily stops |
| Rhythm | Travel bursts for PKs → desk work | Store visits all day |
| Market | Developing | Developed — display walls already installed |
| Main work | Inbound quote emails after PKs; assisted by Eric | Demand generation at dealers for distributors |
| Home screen mode | Quote/email-driven | Agenda/visit-driven |

Same data model, **different home screen modes** (D54).

### Capture must be near-zero friction (D45)
> "Não acho que ele vai preencher um formulário inteiro de lead, mas ele
> conseguiria colocar um… tipo um reminder ali."

**Default path = one note + follow-up flag.** Structured fields are enriched
later — by AI extraction or by the rep at their desk. The full form exists but
is never mandatory. If capture takes >15 seconds in a truck, it does not happen.

> "Entrar no carro e escrever ali exatamente tudo o que aconteceu no PK."

Confirms the voice debrief and its timing: immediately after, in the vehicle.

### Planned vs actual (D46–D47)
The agenda is **an advance commitment measured against reality**, not a to-do list.

- Agenda items created before the week, each with a planned date and objective
- Activities link back to the plan: `planned_done` | `planned_not_done` | `unplanned`
- Planned-vs-actual view in the weekly review — the manager's actual question:
  *"ele falou que ia visitar tal coisa, como é que foi?"*
- **Next week's agenda due Friday**; "next week not planned" is an exception
- Mileage is reimbursed → this is cost control, not just discipline

### Intentionality (D48)
> "Cada visita deveria ser intencional… com o objetivo de pegar a cotação,
> encontrar um contractor, convencer eles a ser stocking dealer, fazer
> follow-up de uma lead."

`objective` becomes **required at scheduling**, from a picklist plus free text:

`COLLECT_QUOTE` · `MEET_CONTRACTOR` · `CONVERT_STOCKING_DEALER` ·
`FOLLOW_UP_LEAD` · `PK_DELIVERY` · `MERCHANDISING_CHECK` ·
`RELATIONSHIP_MAINTENANCE` · `OTHER`

Routine visits still exist — but must carry a purpose. Objective-vs-outcome is
the coaching signal management wants.

### Schema corrections from this research
- **`accounts.parent_account_id`** (D49) — accounts are **branch-level**.
  "Ganahl Anaheim" ≠ "Ganahl Orange": different manager, different stocking
  decisions. Activities and relationships attach to the branch; reporting rolls
  up to the banner.
- **`contacts.is_champion`** (D50) — the "capitão": an elected internal champion
  at that location, chosen by the rep, one per account. Enables a *strategic
  account without champion* exception.
- **`accounts.has_display_wall`, `display_last_verified_at`** (D52) — plus a
  *display not verified in N months* exception.
- **Account naming from business cards = brand + city** (D51).
- **Support/assistant membership role** (D53) — Eric acts on TJ's behalf. RLS:
  support can read and write for assigned reps.

### Confirmed
They run the full sale and hand it to a dealer
("a gente faz toda a venda e passa a venda para um dealer") — validating the
channel fields (`distributor_id`, `dealer_id`) on opportunities.

---

## 9. Navigation

`Home · Activities · Accounts · Projects · Opportunities · Agenda · Territory ·
Reporting`

Reps live in **Home, Activities, Agenda**. Management lives in
**Opportunities, Territory, Reporting**.

Home is **operational, not a table dump**: Today · Quick Actions · My Week ·
Requires Attention. Primary quick actions: Register Commercial Activity and
Create New Account (most prominent), then Create Project, Create Opportunity.

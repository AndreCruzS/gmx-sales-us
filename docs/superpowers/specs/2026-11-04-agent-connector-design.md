# Agent connector — GMX Sales for Claude and Meta Muse

2026-11-04 · test user: Bianca (bianca@gmxgroup.us, admin)

## Intent

GMX's people already work through their own AI agents (Claude and Meta Muse).
Instead of opening the app and filling screens, Bianca should start a natural
conversation with her agent — "just left a PK at Big Creek, six people, I
promised the Ipe catalog" — and the agent records everything on the platform.

The connector makes this possible: a remote MCP server on sales.gmxgroup.com.
After she authenticates once with her own GMX Sales account, the agent can do
**everything she can do in the app, read and write, as her**. The connector
also tells the agent what exists and what each record needs, so the **agent
leads the conversation** (asks for the dealer, the date, who attended) until
the record is complete.

Nothing in the app changes. The connector is a second door onto the same rules.

## Goals

- One MCP server, Streamable HTTP, at `https://sales.gmxgroup.com/api/mcp`,
  usable from claude.ai (web, desktop, mobile), Claude Code, and Meta Muse.
- The agent acts with the user's own credential: Supabase RLS applies exactly
  as in the app. No service-role access on the user's behalf.
- Parity with the app, delivered in two phases (below).
- The agent can discover the platform: what can be recorded, which fields,
  which values are allowed, what rules apply (Eisenhower matrix, PK alert
  days, kinds, timed commitments).
- Trust the agent: writes happen directly, then the agent tells the person what
  it did, with links, so they confirm or ask to correct.
- Sensitive actions require an explicit confirmation that the **server**
  enforces (not the prompt).
- Everything an agent writes is marked with its origin and visible in the app.

## Non-goals

- No change to existing app behaviour, screens, or rules.
- No new permissions model: an agent can never do more than its user can.
- No product catalogue table (catalogue stays external; reuse
  `src/lib/catalog/search.ts`).
- No listing in Anthropic's or Meta's public connector directories now.
- No voice recording through the connector — the conversation replaces Say it.

## Anti-goals (failure even if it technically works)

- The agent writes something the user could not have written in the app.
- A sensitive action (delete, sell-through load, someone else's agenda) runs
  without the person having said yes to a preview.
- Records arrive without a visible trace that an agent made them.
- The connector has its own business rules that drift from the app's (a
  different priority, a different alert date than the same input in the app).
- The agent is drowned in 40 tiny tools and fumbles; or it cannot tell what is
  possible and stops asking.

## Authentication

### Claude (decided)
- Supabase Auth's **OAuth 2.1 server** (public beta) is the authorization
  server. It is currently disabled on both projects; enable it on the live
  project (`eliaqtsxlunbnrcjdcef`) and locally, with asymmetric JWT signing
  keys and **dynamic client registration on**.
- We build one consent page, `/oauth/consent` (English, mobile-first, the
  app's look): if not signed in → login (email/password or Google) → back to
  consent; shows the client ("Claude", "Muse"), "Allow <client> to act as you
  on GMX Sales", Allow / Deny. Uses `supabase.auth.oauth.getAuthorizationDetails`
  / `approveAuthorization` / `denyAuthorization`.
- The MCP route answers unauthenticated calls with `401` +
  `WWW-Authenticate: Bearer resource_metadata=…`; serves protected resource
  metadata at `/.well-known/oauth-protected-resource` whose `resource` equals
  the MCP URL exactly and whose first `authorization_servers` entry is
  `https://eliaqtsxlunbnrcjdcef.supabase.co/auth/v1`.
- Allowed redirect URIs include `https://claude.ai/api/mcp/auth_callback`,
  `https://claude.com/api/mcp/auth_callback`, and Claude Code's loopback
  (`http://localhost:<port>/callback`, `http://127.0.0.1:<port>/callback`).
- `src/middleware.ts` must skip `/api/mcp` and `/.well-known/*` (today it
  exchanges codes on the root and redirects signed-out users, which would
  swallow the 401).
- GMX is on **Claude Enterprise**: an admin creates the connector once in the
  org's connector settings. Its sign-in must be set to **per-user
  (personal)**, never a shared org-wide login — a shared login would make
  every agent act as one account, breaking RLS scoping and attribution.

### Meta Muse (decided: try OAuth first)
- Meta publishes no developer docs. Third-party guides (checked 2026-09/10)
  say Muse adds a custom connector by URL (Settings → Connectors, or by
  asking in chat), connects **from Meta's cloud**, and signs in with OAuth
  + PKCE; known callbacks are `https://agent.meta.ai/api/hatch/oauth/callback` (seen in prod 2026-11-05), `https://muse.ai/api/hatch/oauth/callback` and
  `https://platform.muse.ai/oauth/credential-test/callback`.
- Supabase's server has no CIMD, so pre-register a static public client
  "Muse" in Supabase with those callbacks (DCR also on, if Muse uses it).
- **Plan B, only if Bianca's Muse cannot complete OAuth:** a personal access
  token. "Connect an agent" in Settings: named token, shown once, stored
  hashed, last-used time, revoke, 90-day expiry; the server exchanges it for a
  short-lived Supabase session for that user so RLS still applies. Not built
  unless the Muse test fails.

### Per request
`verifyToken` validates the bearer JWT against the project JWKS
(`supabase.auth.getClaims`), then every tool uses a supabase-js client created
with `Authorization: Bearer <token>` — the same RLS and the same
`custom_access_token_hook` claims (`org_id`) as the app. The JWT's
`client_id` identifies the agent.

## Tools

Grouped by area, not one per table — few tools, each with a clear verb and a
rich description the agent reads. Every tool's schema reuses the app's zod
schemas (`src/lib/domain/schemas.ts`, `outboxPayloadSchemas`) and writes
through the same contract the outbox uses (idempotent create by client UUID,
`updated_at`-guarded update, RPC where the app uses one). The browser outbox
itself (Dexie) is not reused.

### Discovery
- `about_me` — who am I (name, role, org, territory, today's date in my zone).
- `platform_guide` — what can be recorded, required fields, allowed values,
  and GMX's rules in plain words (the Eisenhower questions from
  `MATRIX_RULES`, PK alert days, kinds and timed commitments, what needs
  confirmation). The MCP server instructions tell the agent to read it first
  and to ask the person for anything missing rather than guess.
- `find` — search dealers/accounts, contacts, people on the team, by name
  (handles "Big Creek" → the right account; the app's naming rule
  "<Company> <City>").

### Phase 1 — Bianca's day
- **Agenda & visits:** read agenda/day; plan a visit or follow-up (time,
  kind, duration); reschedule, complete; log a visit (debrief) with outcomes,
  contacts met, next actions.
- **PK board:** read the board / an item; create a PK and its follow-ups —
  priority from the matrix (agent answers urgent/important + reason, the
  code turns it into the quadrant via `src/lib/domain/eisenhower.ts`; an
  Eliminate is returned as a suggestion, not saved, as in Say it); update
  priority/progress/status; notes; checklist (subtasks); mark read.
- **Accounts & contacts:** read an account (with its open items, notes,
  emails); create/edit account; add contact; add account note.
- **Read-only views:** dealers page data, sales/YTD figures, routine list —
  what she sees on Sales, Dealers and Reps.

### Phase 2 — the rest (its own design later)
This document's plan covers Discovery and Phase 1 only (our call). Phase 2
needs its own input design (spreadsheets, card images, the open Quotes
module) and gets a separate design after Bianca has used Phase 1. Listed so
nothing in Phase 1 blocks it:
Quotes and deals (create with items, change stage), sell-through and YTD
loads and deletes, territory targets, dealer aliases, Reps rollout grid,
business-card reading, Google Calendar "sync now", settings.

### AI the app already has
Reuse the logic, not the routes: the routes only accept the cookie session.
Either refactor them to also accept a bearer token, or call the shared lib
functions (`src/lib/voice/*`, `src/lib/catalog/search.ts`, the suggest-
priority prompt) from the tools. Builder's call.

## Writing: direct, then a receipt

- Writes run immediately. Each returns a short receipt the agent can read
  aloud: what was created/changed, the key values, the record id, and a link
  into the app (e.g. `/visits/pk?item=<id>`).
- The server instructions tell the agent to end each exchange with a list of
  what it recorded and ask "anything to correct?".
- Corrections are ordinary update tools on the ids in the receipt.
- `undo` reverses what **this agent did in this session** — session = the
  token's `session_id` claim, within 24 hours (our call; mcp-handler is
  stateless). It only uses reversals the user could already do, with no new
  schema (our call):
  - a created follow-up/PK item/visit plan → deleted where RLS lets the
    user (admins), otherwise closed (`completed_at`) — `next_actions` has no
    cancelled state;
  - an edit → the prior values, kept in an agent action log;
  - a created subtask → deleted (the app already lets anyone who sees the
    item delete one); a note → deleted only where RLS lets its author;
  - anything else (accounts, contacts, logged visits, relationships) has no
    undo: the agent says so and offers a correction instead.

## Confirmation the server enforces

For these, the first call writes nothing and returns a plain preview
("This deletes Boise's September upload: 1,240 rows") and a confirmation
code valid for a few minutes, bound to that user, tool, and exact arguments.
Only a second call carrying the code executes.

1. Any delete (uploads, branches, contacts, accounts, relationships).
2. Sell-through and YTD loads.
3. Anything in someone else's name: reassigning, creating a visit or
   follow-up owned by another rep, touching another person's agenda.
4. Bulk changes (5 or more records in one call).
5. Admin settings: territory targets, dealer aliases, closing a deal
   (won/lost).

Everything else is direct.

## Origin marking

"via Claude" means **created by** the agent (our call). Edits an agent makes
to app-created rows are not badged; they are recorded in the agent action
log (the same one undo uses), which is enough to answer "what did the agent
change?".

Every row an agent creates carries its origin (which client — Claude, Muse —
from the JWT's `client_id`). The app shows a small "via Claude" / "via Muse"
on items, notes and visits. How it is stored (a column, the existing
`entered_by`/source fields, or a DB default reading `auth.jwt()`) is the
builder's call; it must not change existing rows or app writes.

## Constraints

- Next.js 16 App Router on Vercel (Fluid compute, `iad1`); `mcp-handler` v2
  (stateless Streamable HTTP, `withMcpAuth`, `protectedResourceHandler`).
  4.5 MB response cap; keep list tools paged (PostgREST caps at 1,000 rows —
  use `fetchAllPages` where a full set is needed).
- Prod migrations only via `npx supabase db query --linked -f` + `migration
  repair`; never `db push`. Ask before push/merge/prod migration.
- Calendar and HubSpot are pull-based crons: writes made with the user's JWT
  reach Google Calendar and HubSpot with no extra work.
- Every UI string and tool description in English.
- Test locally in the `.superpowers/wt-reps` worktree (port 3012, local DB)
  with the MCP Inspector before any prod test; preview URLs are blocked by
  deployment protection, so the real-agent test is on production.

## Who can connect at launch (decided)

Only **Andre, Bianca and João**. The consent page refuses anyone else
("Agent access isn't open for your account yet"), and `verifyToken` rejects
tokens of anyone off the list — an explicit allow-list (config, not code),
since DCR lets any signed-in user attempt to connect. Reps are added later,
after Bianca validates, with Phase 1 tested under rep RLS first.

## Rollout

1. Local: Inspector against the local stack with a seeded rep and admin.
2. Production, Claude: Andre adds the connector, then Bianca (her account).
3. Production, Muse: Bianca adds it in her Muse; if OAuth fails → Plan B.
4. Bianca's first real use: one PK told to her agent end to end, checked on
   the board.

## Left to the builder

Tool names and exact grouping; storage of confirmation codes and undo
history; how origin is stored; whether AI routes are refactored or their libs
called; paging defaults; the consent page layout within the app's style.

## Open

- Who at GMX is the Claude Enterprise admin who creates the connector.
- Whether Meta Muse completes OAuth against Supabase with a pre-registered
  client (only Bianca's real test answers this).

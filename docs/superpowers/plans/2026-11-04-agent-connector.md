# Agent Connector (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A remote MCP server at `https://sales.gmxgroup.com/api/mcp` through which Andre's, Bianca's and João's own Claude (Enterprise, per-user sign-in) and Meta Muse agents read and record their day on GMX Sales as themselves.

**Architecture:** Supabase Auth's OAuth 2.1 server issues the user's own JWT; `mcp-handler` v2 serves stateless Streamable HTTP in a Next.js route; every tool runs a supabase-js client built with that bearer token, so RLS and the `custom_access_token_hook` claims apply exactly as in the app. Tools reuse the app's zod schemas and domain functions; writes are direct and return receipts; a stateless HMAC code gates sensitive calls; an `agent_actions` log backs undo; `created_via` marks agent-made rows.

**Tech Stack:** Next.js 16 App Router, `mcp-handler` ^2.3 (+ `@modelcontextprotocol/server` ^2), zod 4, supabase-js 2.110, Supabase OAuth server (beta), vitest 4, pgTAP.

**Spec:** `docs/superpowers/specs/2026-11-04-agent-connector-design.md`

## Global Constraints

- Every tool description, receipt, consent-page string and app badge is in English.
- Nothing in existing app behaviour changes: app writes leave `created_via` null; no existing policy is widened.
- An agent can never do more than its user: tools use only the user's bearer JWT; the service-role key is never used in `src/lib/mcp/**`.
- Launch allow-list: `MCP_ALLOWED_EMAILS=andre.cruz@gmxgroup.com,bianca@gmxgroup.us,joao@gmxgroup.us` (env, comma-separated, case-insensitive). Note andre.cruz is a **rep** in prod, the other two **admin** — Phase 1 is exercised under both scopes.
- Agent sources are exactly `"claude" | "muse"`; `MCP_MUSE_CLIENT_ID` (env) identifies Muse's pre-registered client, every other client id is `"claude"`.
- Confirmation codes live 5 minutes; secret `MCP_CONFIRM_SECRET` (env, ≥32 bytes).
- Bulk threshold: 5 or more records in one call needs confirmation.
- Undo window: same `session_id` claim, within 24 hours.
- Public origin for links: `MCP_PUBLIC_ORIGIN=https://sales.gmxgroup.com`.
- Prod migrations only via `npx supabase db query --linked -f <file>` then `npx supabase migration repair --linked --status applied <version>`; never `db push`. Ask Andre before any push to main, merge, or prod migration/config change.
- Work in the `.superpowers/wt-reps` worktree (port 3012, local DB). The :3107 dev server points at live data — never write through it.
- PostgREST caps at 1,000 rows: list tools page (default 50, max 200).
- Python edit scripts go in the session scratchpad, not inline heredocs.

## Review Focus

1. **A name that matches several dealers** ("Big Creek" → six branches): `find` returns all candidates with city, and write tools take ids only — the agent must ask, never pick. Test in Task 6 (`find returns every branch of a banner`).
2. **A token whose user has no active membership / no `org_id` claim:** every tool answers "Your GMX Sales account has no active organisation" instead of a 500 or an empty list. Test in Task 4 (`loadMe rejects a token without org_id`).
3. **A PK follow-up said with no date:** due = PK date + DEFAULT_DAYS of its quadrant, identical to Say it; Eliminate is returned as a suggestion and not written. Test in Task 8 (`create_pk without due dates uses the matrix days`, `eliminate is not saved`).
4. **A confirmation code replayed with different arguments or by another user:** rejected. Test in Task 3 (`checkConfirmation rejects changed args / other user / expired`).
5. **A stale edit** (item changed in the app since the agent read it): update tools use the `updated_at` guard and answer "This changed since you read it — read it again" instead of overwriting. Test in Task 7 (`update_follow_up with stale updated_at is refused`).

---

## File Structure

```
src/lib/mcp/
  context.ts        AgentContext, Me, loadMe()
  auth.ts           agentSourceOf(), isAllowedEmail(), verifyAgentToken()
  confirm.ts        issueConfirmation(), checkConfirmation(), confirmationReason()
  receipt.ts        receipt(), linkTo()
  actions-log.ts    logAction(), undoableActions()
  guide.ts          SERVER_INSTRUCTIONS, PLATFORM_GUIDE
  result.ts         ok(), fail(), needsConfirmation()   (MCP CallToolResult helpers)
  tools/discovery.ts  about_me, platform_guide, find
  tools/agenda.ts     list_agenda, plan_follow_up, update_follow_up, log_visit
  tools/pk.ts         pk_board, pk_item, create_pk, update_pk_item, add_pk_note, add_subtask, set_subtask_done, mark_pk_read
  tools/accounts.ts   get_account, create_account, update_account, add_contact, update_contact, add_account_note
  tools/views.ts      dealers_overview, sales_summary, routine_list
  tools/undo.ts       undo_last
  server.ts         buildMcpServer(getCtx) — registers all tools
  __tests__/        unit tests; *.it.test.ts = integration (run only when MCP_IT=1)
src/app/api/mcp/route.ts
src/app/.well-known/oauth-protected-resource/route.ts
src/app/.well-known/oauth-protected-resource/api/mcp/route.ts
src/app/oauth/consent/page.tsx (+ consent-client.tsx)
supabase/migrations/20261105120000_agent_connector.sql
supabase/tests/agent_connector.test.sql
```

Modified: `src/middleware.ts` (matcher), `src/lib/supabase/gate.ts` + `src/app/login/page.tsx` (return to consent), `supabase/config.toml` (OAuth server), one badge component used by the PK drawer, agenda item and activity list.

---

### Task 1: OAuth server on locally, and proof the token carries our claims

This is a gate: if an OAuth-issued token lacks `org_id`, RLS (`private.jwt_org_id()`) fails for every tool and the design must be revisited with Andre before Task 2.

**Files:**
- Modify: `supabase/config.toml`
- Create: `scripts/oauth-smoke.mjs` (throwaway, not committed)

- [ ] **Step 1:** In `supabase/config.toml` enable the OAuth 2.1 server with authorization path `/oauth/consent`, dynamic registration on, and asymmetric signing keys. Take the exact keys from `npx supabase --version` docs / `supabase/config.toml` reference for the installed CLI (`[auth.oauth_server]`: `enabled`, `authorization_url_path`, `allow_dynamic_registration`). Restart: `npx supabase stop && npx supabase start` in the worktree.
- [ ] **Step 2:** `curl http://127.0.0.1:<auth-port>/auth/v1/.well-known/oauth-authorization-server` → JSON with `registration_endpoint`, `code_challenge_methods_supported` containing `S256`.
- [ ] **Step 3:** In the smoke script: DCR-register a client with redirect `http://localhost:9999/cb`; run an authorization-code + PKCE flow for seeded `tj@gmxgroup.com` (approve via `supabase.auth.oauth.approveAuthorization` from a signed-in client); exchange the code; decode the access token.
  Expected: payload has `sub`, `role: "authenticated"`, `client_id`, `session_id`, **and `org_id`**. If `org_id` is missing → STOP, report to Andre.
- [ ] **Step 4:** With that token, `select id from next_actions limit 1` via a supabase-js client with `Authorization: Bearer` → rows returned (RLS passes).
- [ ] **Step 5: Commit** `supabase/config.toml` — `chore(auth): enable the OAuth 2.1 server locally for agent connectors`.

### Task 2: Schema — origin marking and the agent action log

**Files:**
- Create: `supabase/migrations/20261105120000_agent_connector.sql`, `supabase/tests/agent_connector.test.sql`
- Modify: `src/lib/database.types.ts` (regenerate with `npm run db:types`)

**Interfaces — Produces:**
- Column `created_via text null check (created_via in ('claude','muse'))` on `next_actions`, `activities`, `next_action_notes`, `next_action_subtasks`, `accounts`, `contacts`, `account_notes`. No default; app inserts leave it null.
- Table `agent_actions(id uuid pk default gen_random_uuid(), org_id uuid not null default private.jwt_org_id(), user_id uuid not null default auth.uid(), session_id text not null, via text not null check (via in ('claude','muse')), tool text not null, entity text not null, entity_id uuid not null, op text not null check (op in ('create','update')), before jsonb, undone_at timestamptz, created_at timestamptz not null default now())`. RLS: insert/select/update only where `user_id = auth.uid()`; no delete.

- [ ] **Step 1: Write the failing pgTAP test** `agent_connector.test.sql`: `has_column('next_actions','created_via')` (and the other six tables); an insert into `next_actions` with `created_via='robot'` throws `23514`; as user A, insert an `agent_actions` row then, as user B, `select count(*)` = 0; as user A `delete` affects 0 rows.
- [ ] **Step 2:** `npx supabase test db` → FAIL (column missing).
- [ ] **Step 3:** Write the migration. Do not touch existing triggers or policies. **Check every `CREATE OR REPLACE VIEW` you touch keeps `WITH (security_invoker = true)`** (none should be needed).
- [ ] **Step 4:** `npx supabase db reset && npx supabase test db` → all pass; `npm run db:types`.
- [ ] **Step 5: Commit** — `feat(db): created_via on agent-made rows and an agent action log`.

### Task 3: Pure core — auth helpers, confirmation, receipts

**Files:**
- Create: `src/lib/mcp/auth.ts`, `confirm.ts`, `receipt.ts`, `result.ts`
- Test: `src/lib/mcp/__tests__/core.test.ts`

**Interfaces — Produces:**
```ts
export type AgentSource = "claude" | "muse";
export function agentSourceOf(clientId: string | undefined, museClientId = process.env.MCP_MUSE_CLIENT_ID): AgentSource;
export function isAllowedEmail(email: string | undefined, list = process.env.MCP_ALLOWED_EMAILS): boolean;

export interface ConfirmSubject { userId: string; tool: string; args: unknown }
export function issueConfirmation(s: ConfirmSubject, now: Date, secret?: string): { code: string; expiresAt: string };
export function checkConfirmation(code: string, s: ConfirmSubject, now: Date, secret?: string): boolean;
/** Why this call needs a yes, or null. Rules = spec §Confirmation. */
export function confirmationReason(tool: string, args: Record<string, unknown>, me: { membershipId: string }): string | null;

export function linkTo(path: string): string;            // MCP_PUBLIC_ORIGIN + path
export function receipt(lines: string[], refs: { id: string; path: string }[]): string;
// result.ts — MCP CallToolResult helpers
export function ok(text: string, data?: unknown): CallToolResult;
export function fail(text: string): CallToolResult;        // isError: true
export function needsConfirmation(preview: string, code: string, expiresAt: string): CallToolResult;
```
`issueConfirmation`: code = base64url(`expUnix`) + "." + HMAC-SHA256(secret, `userId|tool|stableStringify(args minus "confirmation")|expUnix`); TTL 5 min. `checkConfirmation` recomputes with `timingSafeEqual`.
`confirmationReason` returns non-null when: tool name starts with `delete_`; `owner_id` present and ≠ `me.membershipId`; any array arg has length ≥ 5; tool in `["set_territory_target","save_dealer_alias","close_deal"]` (Phase 2 names, reserved).

- [ ] **Step 1: Write failing tests:**
  - `agentSourceOf("muse-id","muse-id") === "muse"`, `agentSourceOf("x","muse-id") === "claude"`, `agentSourceOf(undefined) === "claude"`.
  - `isAllowedEmail("Bianca@GMXgroup.us", "andre.cruz@gmxgroup.com,bianca@gmxgroup.us")` true; `"tj@gmxgroup.com"` false; `undefined` false; empty list → false for everyone.
  - `checkConfirmation` true for the issued code at +4 min; false at +6 min; false with `args` changed; false with another `userId`; false with another `tool`; true when args differ only by the `confirmation` key.
  - `confirmationReason("plan_follow_up", {owner_id: "B"}, {membershipId: "A"})` non-null; same with `owner_id: "A"` null; `{items: [1,2,3,4,5]}` non-null; 4 items null.
  - `linkTo("/visits/pk?item=1")` with origin env = `https://sales.gmxgroup.com/visits/pk?item=1`.
- [ ] **Step 2:** `npx vitest run src/lib/mcp/__tests__/core.test.ts` → FAIL (modules missing).
- [ ] **Step 3:** Implement. Node `crypto` only; no new dependency.
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5: Commit** — `feat(mcp): confirmation codes, receipts and agent-source helpers`.

### Task 4: Agent context and token verification

**Files:**
- Create: `src/lib/mcp/context.ts`; extend `src/lib/mcp/auth.ts`
- Test: `src/lib/mcp/__tests__/context.test.ts`, `src/lib/mcp/__tests__/context.it.test.ts`

**Interfaces:**
- Consumes: `agentSourceOf`, `isAllowedEmail` (Task 3); `orgIdFromJwt` (`src/lib/supabase/jwt.ts`).
- Produces:
```ts
export interface Me { userId: string; email: string; name: string; membershipId: string; orgId: string; role: "rep"|"manager"|"admin"|"support"; timeZone: string }
export interface AgentContext { db: SupabaseClient<Database>; me: Me; via: AgentSource; sessionId: string }
export function dbForToken(token: string): SupabaseClient<Database>;   // anon key + global Authorization header, no session persistence
export async function loadMe(db: SupabaseClient<Database>, claims: Record<string, unknown>): Promise<Me>; // throws AgentAuthError with the user-facing message
export async function verifyAgentToken(req: Request, bearer?: string): Promise<AuthInfo | undefined>;
// AuthInfo.extra = { claims } ; undefined when invalid OR email not allowed
export async function contextFrom(authInfo: AuthInfo): Promise<AgentContext>;
```
`verifyAgentToken` validates with `createClient(...).auth.getClaims(bearer)` (JWKS), then `isAllowedEmail(claims.email)`. `loadMe` reads `memberships` (by `user_id = sub`, `org_id = claims.org_id`, status active) and `users` (name, time zone; default `America/Los_Angeles` when unset).

- [ ] **Step 1: Failing unit tests (`context.test.ts`)** with a stub db: `loadMe rejects a token without org_id` → throws message `"Your GMX Sales account has no active organisation."`; returns `Me` with membership role.
- [ ] **Step 2: Integration test (`context.it.test.ts`, `describe.skipIf(!process.env.MCP_IT)`)**: password-sign-in seeded `tj@gmxgroup.com` / password123 on the local stack, `verifyAgentToken` with an allow-list containing tj → AuthInfo; without tj → undefined; garbage token → undefined.
- [ ] **Step 3:** `npx vitest run src/lib/mcp` → unit FAIL; then implement; then `MCP_IT=1 npx vitest run src/lib/mcp` → PASS.
- [ ] **Step 4: Commit** — `feat(mcp): verify an agent's token and load who it acts for`.

### Task 5: Consent page and the way back from login

**Files:**
- Modify: `src/lib/supabase/gate.ts`, `src/lib/supabase/__tests__/gate.test.ts`, `src/middleware.ts`, `src/app/login/page.tsx`
- Create: `src/app/oauth/consent/page.tsx`, `src/app/oauth/consent/consent-client.tsx`

**Interfaces:** `gate()` gains `search: string` input and its redirect gains optional `next`. Only a pathname starting with `/oauth/` is carried as `next`; login honours `next` only if it starts with `/oauth/consent` (open-redirect guard), for both password sign-in (router push) and Google (`redirectTo: origin + next`).

- [ ] **Step 1: Failing tests in `gate.test.ts`:** signed-out `/oauth/consent?authorization_id=abc` → `{kind:"redirect", pathname:"/login", next:"/oauth/consent?authorization_id=abc"}`; signed-out `/visits` → redirect with no `next` (unchanged); signed-in `/login?next=/oauth/consent?authorization_id=abc` → redirect to that `next`; `next=https://evil.com` → `/`.
- [ ] **Step 2:** `npx vitest run src/lib/supabase` → FAIL. Implement; → PASS.
- [ ] **Step 3: Consent page** (server component reads session; client component calls `supabase.auth.oauth.getAuthorizationDetails(authorization_id)`):
  - not on allow-list → copy: **"Agent access isn't open for your account yet."** and a Deny that calls `denyAuthorization`.
  - else: title **"Allow {client name} to act as you on GMX Sales?"**, body **"It will see and record what you can see and record in the app, as you. You can disconnect it any time from {client name}."**, buttons **Allow** / **Deny** → `approveAuthorization` / `denyAuthorization`, then follow the returned redirect.
  - Mobile-first, the app's `card card-pad` styles; text face only (no `--font-mono`).
- [ ] **Step 4:** Manual check on :3012 at 390×844: signed-out → login → back on consent → Allow lands on the client's redirect.
- [ ] **Step 5: Commit** — `feat(auth): consent page for agent connectors, login returns to it`.

### Task 6: MCP route, discovery tools, server instructions

**Files:**
- Create: `src/lib/mcp/guide.ts`, `src/lib/mcp/server.ts`, `src/lib/mcp/tools/discovery.ts`, `src/app/api/mcp/route.ts`, both `.well-known/oauth-protected-resource` routes
- Modify: `src/middleware.ts` matcher — add `api/mcp` and `\.well-known` to the negative lookahead
- Test: `src/lib/mcp/__tests__/guide.test.ts`, `src/lib/mcp/__tests__/discovery.it.test.ts`
- `npm i mcp-handler@^2.3 @modelcontextprotocol/server@^2` — read `node_modules/mcp-handler/README.md` for the exact v2 API before writing the route.

**Interfaces:**
- Consumes: `verifyAgentToken`, `contextFrom` (Task 4); `ok`/`fail` (Task 3); `MATRIX_RULES` (`src/lib/domain/eisenhower.ts`); `DEFAULT_DAYS`, `PRIORITY_LABEL` (`src/lib/domain/pk-follow-up.ts`).
- Produces: `buildMcpServer(server, getCtx: (extra) => Promise<AgentContext>)` that later tasks extend by adding `registerXTools(server, getCtx)` calls. Tool handler convention: `(args, extra) => { const ctx = await getCtx(extra); … return ok(...) }`, every handler wrapped so a thrown `AgentAuthError` becomes `fail(message)`.
- Tools: `about_me()` → name, role, org, territory, today in `me.timeZone`. `platform_guide()` → `PLATFORM_GUIDE`. `find({query, kind?: "account"|"contact"|"person", limit?})` → candidates `{id, kind, name, city, state, account_type}`; accounts searched with `ilike` on name and every row matching returned (up to limit, default 20).

`SERVER_INSTRUCTIONS` must say, in English: read `platform_guide` before the first write; never guess an id — use `find` and ask the person when more than one matches; write directly, then end with a list of what you recorded (receipts) and ask "Anything to correct?"; when a tool answers "needs confirmation", show the preview and only call again with the code after the person says yes.
`PLATFORM_GUIDE` covers: what can be recorded (visits/debriefs, follow-ups, calls/meetings with time, PKs and their follow-ups, notes, checklist, accounts, contacts, account notes); required fields per record; `MATRIX_RULES` verbatim; the PK alert rule (alert = PK date + days; default days Do now 1, Plan 7, Delegate 2; Eliminate is not saved unless the person keeps it); a CALL/MEETING needs time, zone and duration; what needs confirmation (spec list); that Phase 2 things (quotes, sell-through, targets, aliases, cards) are "not available through the agent yet — use the app".

- [ ] **Step 1: Failing `guide.test.ts`:** `PLATFORM_GUIDE` contains `MATRIX_RULES`; contains "Do now 1", "Plan 7", "Delegate 2"; `SERVER_INSTRUCTIONS` contains "platform_guide" and "Anything to correct?".
- [ ] **Step 2:** FAIL → implement → PASS.
- [ ] **Step 3: Integration (`discovery.it.test.ts`, MCP_IT):** call handlers directly with a context for `tj@gmxgroup.com`: `about_me` names tj's role; `find returns every branch of a banner` — seed has ≥2 accounts sharing a banner word; all are returned with their city.
- [ ] **Step 4: Route check:** `curl -i -X POST http://localhost:3012/api/mcp` → `401` with `WWW-Authenticate: Bearer resource_metadata="http://localhost:3012/.well-known/oauth-protected-resource/api/mcp"`; that URL returns `resource: "http://localhost:3012/api/mcp"` and `authorization_servers[0]` = the local auth issuer. Then MCP Inspector (`npx @modelcontextprotocol/inspector`) → connect to `http://localhost:3012/api/mcp`, complete OAuth as tj, list tools, call `about_me`.
- [ ] **Step 5:** `npm run lint && npx vitest run` → green. **Commit** — `feat(mcp): the connector route, its sign-in metadata and discovery tools`.

### Task 7: Agenda and visits

**Files:** Create `src/lib/mcp/tools/agenda.ts`, `src/lib/mcp/actions-log.ts`; Test `src/lib/mcp/__tests__/agenda.it.test.ts`

**Interfaces:**
- Consumes: `nextActionCreateSchema`, `nextActionUpdateSchema`, `activityCreateSchema` (`src/lib/domain/schemas.ts`); `confirmationReason`, `issueConfirmation`, `checkConfirmation`, `receipt`, `linkTo`.
- Produces (`actions-log.ts`):
```ts
export async function logAction(ctx: AgentContext, a: { tool: string; entity: "next_actions"|"activities"|"next_action_notes"|"next_action_subtasks"|"accounts"|"contacts"|"account_notes"; entityId: string; op: "create"|"update"; before?: Record<string, unknown> }): Promise<void>;
```
- Shared write rule for every write tool in Tasks 7–9: build the row with the app's schema (`.parse`), set `org_id = me.orgId`, `created_via = ctx.via` on creates, insert with `upsert(row, {onConflict:"id", ignoreDuplicates:true})` (client-made `crypto.randomUUID()`), update with `.eq("id").eq("updated_at", base)`; 0 rows on update → `fail("This changed since you read it — read it again.")`; then `logAction` (updates store the prior values of the changed fields in `before`).
- Tools:
  - `list_agenda({from, to, owner_id?})` → open + recently closed `next_actions` in range, ordered by `due_date, due_time`; each with `updated_at` (agents need it to edit).
  - `plan_follow_up({action, due_date, account_id?, kind?, due_time?, time_zone?, duration_minutes?, owner_id?, objective?, confirmation?})` — `owner_id` defaults to me; another owner → confirmation.
  - `update_follow_up({id, updated_at, due_date?, due_time?, action?, owner_id?, done?: boolean, confirmation?})` — `done: true` → `completed_at = now`.
  - `log_visit({account_id, activity_type, occurred_at, what_happened, outcomes?, objective?, planned_action_id?, follow_ups?: [{action, due_date, kind?, due_time?, time_zone?, duration_minutes?}]})` — activity + its follow-ups linked by `activity_id`; completes `planned_action_id` when given (needs its `updated_at`: read it first). Not for PKs: `activity_type: "PK_TRAINING"` → `fail("Use create_pk for a PK.")`.
  - Receipts link: follow-up → `/visits?item=<id>`, visit → `/accounts/<account_id>`.

- [ ] **Step 1: Failing integration tests** (MCP_IT, as tj): `plan_follow_up` creates a row with `created_via='claude'`, `entered_by` = tj's membership, and the receipt contains the link; a `CALL` without `due_time` fails with the DB check message turned into "A call needs a time, zone and duration."; `plan_follow_up` with another rep's `owner_id` and no code → needs-confirmation result and **no row written**; with the issued code → row written; `update_follow_up with stale updated_at is refused`; `log_visit` creates the activity and two follow-ups linked to it; one `agent_actions` row per write.
- [ ] **Step 2:** `MCP_IT=1 npx vitest run src/lib/mcp/__tests__/agenda.it.test.ts` → FAIL → implement → PASS.
- [ ] **Step 3: Commit** — `feat(mcp): agenda, follow-ups and visit logging for agents`.

### Task 8: PK board

**Files:** Create `src/lib/mcp/tools/pk.ts`, `src/lib/mcp/pk-rows.ts`; Test `src/lib/mcp/__tests__/pk-rows.test.ts`, `src/lib/mcp/__tests__/pk.it.test.ts`

**Interfaces:**
- Consumes: `draftedQuadrant` (`eisenhower.ts`); `alertDate`, `DEFAULT_DAYS`, `pkDateOf`, `priorityPatch` (`pk-follow-up.ts`); RPCs `pk_board_items`, `pk_board_visits`; tables `next_action_notes`, `next_action_subtasks`, `next_action_reads`.
- Produces (`pk-rows.ts`, pure):
```ts
export interface PkFollowUpInput { action: string; urgent: boolean; important: boolean; reason: string; asked_by_dealer: boolean; due_date?: string; progress?: Progress; owner_id?: string; subtasks?: string[]; note?: string }
export type PkRowPlan =
  | { save: true; priority: Exclude<Priority,"ELIMINATE">; priority_days: number; due_date: string; reason: string }
  | { save: false; reason: string };   // Eliminate — suggested, not saved
export function planPkFollowUp(pkDate: string, f: PkFollowUpInput): PkRowPlan;
```
Rule (must equal `debrief-sheet.tsx` lines ~380–390): quadrant = `draftedQuadrant(urgent, important, asked_by_dealer)`; Eliminate → `save:false`; a said `due_date` → `days = max(0, daysFrom(pkDate, due_date))`; none → `days = DEFAULT_DAYS[quadrant]`; `due_date = alertDate(pkDate, days)`.
- Tools:
  - `pk_board({mine_only?, dealer_account_id?, open_only?})` → bands from `pk_board_visits` + `pk_board_items` (dealer, PK date, items with priority label, progress, alert date, unread flag).
  - `pk_item({id})` → item + notes (oldest first) + subtasks + `updated_at`.
  - `create_pk({dealer_account_id, occurred_at, what_happened, attendees?, follow_ups: PkFollowUpInput[], keep_eliminated?: number[]})` → activity `PK_TRAINING` + each saved follow-up (`source: "VISIT_CAPTURE"`, `activity_id`, `account_id = dealer`, priority fields from `planPkFollowUp`) + its subtasks + first note; follow-ups whose plan is `save:false` are **listed in the receipt as "Suggested to drop (neither urgent nor important): …"** and saved only if their index is in `keep_eliminated` (then with `priority: null`, `priority_days: null`, due = the said date or PK date + 7 — as Say it's "Keep it"). Another owner on any follow-up, or ≥5 follow-ups → confirmation.
  - `update_pk_item({id, updated_at, priority?, progress?, done?, due_date?, action?})` — priority goes through `priorityPatch(pkDate, priority)`.
  - `add_pk_note({next_action_id, body})`, `add_subtask({next_action_id, title})`, `set_subtask_done({id, done})`, `mark_pk_read({next_action_id})`.
  - Receipt link: `/visits/pk?item=<id>`.

- [ ] **Step 1: Failing unit tests (`pk-rows.test.ts`):** for pkDate `2026-11-03`: urgent+important, no date → `DO_NOW`, days 1, due `alertDate("2026-11-03",1)`; important only → `PLAN`, 7; urgent only → `DELEGATE`, 2; neither → `save:false`; neither but `asked_by_dealer` → `DELEGATE` (the guard); said due `2026-11-10` with PLAN → days 7; said due before the PK → days 0.
- [ ] **Step 2: Failing integration tests (`pk.it.test.ts`, MCP_IT, as the seeded admin):** `create_pk without due dates uses the matrix days` (rows' `priority_days` and `due_date`); `eliminate is not saved` (no row; receipt lists it); with `keep_eliminated:[i]` it is saved; the created PK appears in `pk_board` for its owner; a rep (tj) cannot `update_pk_item` an item outside their scope → `fail("You can't change this item.")` (0 rows, RLS).
- [ ] **Step 3:** FAIL → implement → `npx vitest run src/lib/mcp` and `MCP_IT=1 …` → PASS.
- [ ] **Step 4: Commit** — `feat(mcp): the PK board for agents, priority from the matrix`.

### Task 9: Accounts, contacts, read-only views

**Files:** Create `src/lib/mcp/tools/accounts.ts`, `src/lib/mcp/tools/views.ts`; Test `src/lib/mcp/__tests__/accounts.it.test.ts`

**Interfaces:**
- Consumes: `accountCreateSchema`, `accountUpdateSchema`, `contactCreateSchema`, `contactUpdateSchema`, `accountNoteCreateSchema`; `fetchAllPages` where a full set is needed; the same views the app pages read (`app/dealers/page.tsx`, `components/team-sales.tsx`, `routine_items`) — query those, do not re-derive figures.
- Tools: `get_account({id})` (account + open items + recent notes + last 5 email thread subjects), `create_account`, `update_account`, `add_contact`, `update_contact`, `add_account_note`; `dealers_overview({territory?, limit?, offset?})`, `sales_summary({period?: "month"|"ytd", distributor_id?})`, `routine_list()`.
- New account names follow the app's rule "<Company> <City>"; the tool description says so.

- [ ] **Step 1: Failing integration tests (MCP_IT):** `create_account` as tj writes `created_via` and returns `/accounts/<id>`; `add_contact` on an account outside tj's scope → fail; `sales_summary` for the admin returns the same LF total as the view the Sales page reads for the same period (compare to a direct query).
- [ ] **Step 2:** FAIL → implement → PASS.
- [ ] **Step 3: Commit** — `feat(mcp): accounts, contacts and the read-only views for agents`.

### Task 10: Undo

**Files:** Create `src/lib/mcp/tools/undo.ts`; extend `actions-log.ts`; Test `src/lib/mcp/__tests__/undo.it.test.ts`

**Interfaces:**
- Produces: `undoableActions(ctx, limit=10)` → this user's `agent_actions` with `session_id = ctx.sessionId`, `created_at > now() - 24h`, `undone_at is null`, newest first. Tool `undo_last({action_id?})` — default the newest. Reversal by entity/op:
  - `next_actions` create → `delete` (admins may; RLS `next_actions_delete`); if 0 rows deleted → `update completed_at = now()` and say "Closed it (you can't delete items)".
  - any update → write `before` back with the `updated_at` guard.
  - `next_action_subtasks` create → delete.
  - everything else → `fail("That can't be undone from here — tell me what to change instead.")`.
  - Mark `undone_at`.
- [ ] **Step 1: Failing integration tests (MCP_IT):** undo of a created follow-up as admin → row gone; as rep tj → row closed (`completed_at` set); undo of a priority update restores the prior priority and `priority_days`; undo of a created contact → the can't-undo message; an action from another `session_id` is not offered.
- [ ] **Step 2:** FAIL → implement → PASS.
- [ ] **Step 3: Commit** — `feat(mcp): undo what the agent just did`.

### Task 11: "via Claude / via Muse" in the app

**Files:** Create `src/components/via-agent.tsx`; Modify the PK drawer header (`src/components/pk-item-drawer.tsx`), agenda item row (`src/components/agenda-calendar.tsx`), PK note rows (`src/components/pk-notes-log.tsx`); add `created_via` to their selects / the `pk_board_items` RPC output (new migration `20261105130000_pk_board_created_via.sql` that `create or replace`s the RPC adding one column — copy its current body verbatim from the latest migration defining it) and `CachedAgendaItem` (`src/lib/offline/types.ts`, `supabase-backend.ts` select).
- `ViaAgent({via}: {via: "claude"|"muse"|null})` → renders nothing for null; else a small `t-hint` "via Claude" / "via Muse".
- [ ] **Step 1: Failing test** `src/components/__tests__/via-agent.test.ts` if the repo tests components; otherwise a pure `viaLabel(via)` in `src/lib/domain/via.ts` with test: `null → null`, `"claude" → "via Claude"`, `"muse" → "via Muse"`.
- [ ] **Step 2:** FAIL → implement → PASS; `npx supabase db reset && npx supabase test db` green.
- [ ] **Step 3:** Visual check on :3012 (desktop for the PK board, 390px for agenda): an agent-created item shows "via Claude"; app-created items show nothing.
- [ ] **Step 4: Commit** — `feat(ui): agent-made items say which agent made them`.

### Task 12: Production rollout (each step asks Andre first)

- [ ] **Step 1:** Whole-branch review; `npm run lint && npx vitest run && MCP_IT=1 npx vitest run src/lib/mcp && npx supabase test db` green.
- [ ] **Step 2 (ask):** Prod migrations `20261105120000`, `20261105130000` via `db query --linked -f` + `migration repair`.
- [ ] **Step 3 (ask):** In the Supabase dashboard for `eliaqtsxlunbnrcjdcef`: enable OAuth Server (authorization path `/oauth/consent`, DCR on), asymmetric signing keys; allow the redirect URLs `https://claude.ai/api/mcp/auth_callback`, `https://claude.com/api/mcp/auth_callback`, `http://localhost:*/callback`, `http://127.0.0.1:*/callback`; register a public client "Muse" with redirects `https://muse.ai/api/hatch/oauth/callback`, `https://platform.muse.ai/oauth/credential-test/callback`; Vercel env: `MCP_ALLOWED_EMAILS`, `MCP_CONFIRM_SECRET`, `MCP_MUSE_CLIENT_ID`, `MCP_PUBLIC_ORIGIN`. Verify `https://eliaqtsxlunbnrcjdcef.supabase.co/.well-known/oauth-authorization-server/auth/v1` no longer says `feature_disabled`.
- [ ] **Step 4 (ask):** Merge and push to main (Vercel prod deploy). Check `curl -i -X POST https://sales.gmxgroup.com/api/mcp` → 401 with `resource_metadata`.
- [ ] **Step 5:** GMX's Claude Enterprise admin creates the connector (URL `https://sales.gmxgroup.com/api/mcp`, **per-user sign-in**). Andre connects first (rep scope): `about_me`, `pk_board`, one `plan_follow_up` on himself, `undo_last`.
- [ ] **Step 6:** Bianca connects in Claude, then in her Muse (Settings → Connectors → Add custom connector, OAuth). If Muse cannot finish OAuth → report to Andre; Plan B (personal token) becomes its own design.
- [ ] **Step 7:** Bianca tells her agent one real PK end to end; check it on `/visits/pk` with "via Claude"/"via Muse".
- [ ] **Step 8:** Update memory (`one-mic.md` or a new `agent-connector.md`) with what is live and the commit hashes.

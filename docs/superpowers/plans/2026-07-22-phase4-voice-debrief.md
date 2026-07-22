# Phase 4 — Voice Debrief Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record → outbox → signed-URL upload → transcribe → extract Activity + Next Actions → review gate → fan-out (D9/D10), with offline capture surviving end-to-end.

**Architecture:** Client records via MediaRecorder (format validated at capture — offline doc §6); the blob rides the existing D59 outbox path (`voice::{org}/{user}/{id}.{ext}` blobRef, signed URL at sync time, purge after upload) and the `voice_captures` row lands with status `UPLOADED`. A Next.js route (`/api/voice/process`) — authenticated by the rep's session, using the service role scoped to that rep's captures — transcribes via AI Gateway (`openai/gpt-4o-mini-transcribe`; Gemini audio-input fallback) and extracts a structured draft via `generateObject` (`anthropic/claude-sonnet-4.6`), setting status `DRAFTED`. The review screen is the gate (D9): "Send" fan-outs through the SAME outbox as manual capture (activity + next actions + capture update `SENT`), so the pipeline rejoins the standard flow (D10). A **typed-debrief path** (transcript present, no audio) skips transcription — it is D45's "enriched later by AI" and makes the loop E2E-verifiable without a microphone.

**Tech Stack:** AI SDK v7 via AI Gateway (D63, OIDC), existing offline layer, Next.js route handler.

## Global Constraints
- **Nothing AI-drafted becomes a record without human review** (D9) — the ONLY code path that creates activities/next_actions from a draft is the review screen's Send.
- Voice pipeline rejoins the standard capture flow (D10) — fan-out uses the same outbox entities; no parallel write path.
- Statuses: PENDING → UPLOADED → DRAFTED → REVIEWED/SENT | DISCARDED | FAILED (spec §2; TRANSCRIBED folded into DRAFTED — one server pass does both).
- Audio format validated at CAPTURE time (iOS reality, offline doc §6): prefer audio/mp4, fall back webm/opus; unsupported → typed path offered.
- Server route never trusts the client for scoping: caller's user id + org claim resolve the membership; service role queries filter on it (D62 spirit).
- Language: transcription hint from `memberships.debrief_language` (Q7).

## Tasks
1. **Domain**: `voiceCaptureCreateSchema`/`voiceCaptureUpdateSchema` + `ENTITY_TABLES.voice_capture`; extraction draft zod schema (`src/lib/voice/draft.ts`): summary, what_happened, key_information, commercial_potential, outcomes[], follow_up_required, suggested activity_type, next_actions[{action, due_date, objective?}].
2. **Process route** (`src/app/api/voice/process/route.ts`): auth → org claim → membership; fetch caller's `UPLOADED` captures (+ typed: `PENDING` with transcript); audio → storage download (service role) → gateway transcribe (fallback Gemini audio) → extraction `generateObject` → update transcript/ai_draft/status `DRAFTED`; failures → `FAILED` with error detail. Env: service key in `.env.development.local` (local) / `.env.local` (live).
3. **Debriefs UI** (`src/app/debriefs/page.tsx` + Home quick action): record button (MediaRecorder), typed debrief input, capture list with status chips, "Process" trigger, review sheet for DRAFTED (all fields editable, next actions add/remove) → Send = outbox fan-out + capture update; Discard = status DISCARDED.
4. **Tests**: vitest — draft schema validation; voice outbox path (blob + row exactly-once, status UPLOADED); review-gate invariant exercised in browser E2E (typed debrief: draft exists + NO activity → send → activity + NAs exist, capture SENT).
5. **Verification**: browser E2E on local stack (typed path); audio path smoke = manual field test (Q13 territory — needs a real mic).
6. CI push, session state, live parity (no new migrations expected).

// Business card processing (D41–D44): image → vision model → per-field
// confidence, company match against existing accounts (D43), and contextual
// lead-source inference (D44). Produces candidate data only — the rep's
// confirmation in Review is the sole path to a contact record (D39).
//
// Auth model mirrors /api/voice/process: the caller's session identifies the
// rep; the service role touches only that rep's own candidates and images.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { generateObject } from "ai";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  cardExtractionSchema,
  cardPrompt,
  type ExtractedCard,
} from "@/lib/cards/draft";

export const maxDuration = 120;

// Vision, unlike transcription, works across all three providers (D41) — the
// gateway string stays swappable per-tenant later.
const CARD_MODEL = process.env.CARD_VISION_MODEL ?? "anthropic/claude-sonnet-4.6";

const BATCH_LIMIT = 10;
const PK_SOURCE_WINDOW_HOURS = 48;

function mimeFromPath(path: string): string {
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".heic")) return "image/heic";
  return "image/jpeg";
}

function orgIdFromJwt(token: string): string | null {
  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString("utf8"),
    );
    return payload.org_id ?? null;
  } catch {
    return null;
  }
}

export async function POST() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const orgId = orgIdFromJwt(session.access_token);
  if (!orgId) {
    return NextResponse.json({ error: "no active org" }, { status: 403 });
  }

  const service = createClient(
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const { data: membership } = await service
    .from("memberships")
    .select("id")
    .eq("user_id", session.user.id)
    .eq("org_id", orgId)
    .eq("status", "active")
    .single();
  if (!membership) {
    return NextResponse.json({ error: "no membership" }, { status: 403 });
  }

  // Only the caller's own card candidates, only unread ones.
  const { data: candidates, error } = await service
    .from("contact_candidates")
    .select("id, raw_ref, extracted, created_at")
    .eq("org_id", orgId)
    .eq("created_by", membership.id)
    .eq("source", "BUSINESS_CARD")
    .eq("status", "PENDING")
    .order("created_at")
    .limit(BATCH_LIMIT);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const unread = (candidates ?? []).filter((c) => {
    const ex = (c.extracted ?? {}) as ExtractedCard;
    return !ex.fields && !ex.error;
  });

  // D44: a PK training in the recent past makes PK_CLASS the right default for
  // every card in this batch — that is exactly when reps collect cards.
  const since = new Date(
    Date.now() - PK_SOURCE_WINDOW_HOURS * 3_600_000,
  ).toISOString();
  const { count: recentPk } = await service
    .from("activities")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("owner_id", membership.id)
    .eq("activity_type", "PK_TRAINING")
    .gte("occurred_at", since);
  const suggestedSource = (recentPk ?? 0) > 0 ? "PK_CLASS" : null;

  let processed = 0;
  let failed = 0;

  for (const candidate of unread) {
    try {
      if (!candidate.raw_ref) throw new Error("no card image on this candidate");
      const { data: blob, error: dlError } = await service.storage
        .from("cards")
        .download(candidate.raw_ref);
      if (dlError || !blob) {
        throw new Error(`card download failed: ${dlError?.message}`);
      }

      const { object: fields } = await generateObject({
        model: CARD_MODEL,
        schema: cardExtractionSchema,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                image: new Uint8Array(await blob.arrayBuffer()),
                mediaType: mimeFromPath(candidate.raw_ref),
              },
              { type: "text", text: cardPrompt() },
            ],
          },
        ],
        providerOptions: {
          gateway: {
            user: membership.id, // per-rep attribution (D63)
            tags: ["feature:card-reader"],
          },
        },
      });

      // D43 company matching: card company → existing account. The service
      // role reads org-wide here on purpose — the account may belong to a
      // peer's territory, and attaching beats duplicating.
      let companyMatch: ExtractedCard["company_match"] = null;
      const company = fields.company.value?.trim();
      if (company && fields.company.confidence >= 0.5) {
        const { data: match } = await service
          .from("accounts")
          .select("id, name")
          .eq("org_id", orgId)
          .ilike("name", `%${company}%`)
          .limit(1)
          .maybeSingle();
        if (match) companyMatch = match;
      }

      // D40 rung 1: exact normalized email ⇒ same person.
      let contactMatch: ExtractedCard["contact_match"] = null;
      const email = fields.email.value?.trim().toLowerCase();
      if (email && fields.email.confidence >= 0.5) {
        const { data: cm } = await service
          .from("contacts")
          .select("id, name, account_id")
          .eq("org_id", orgId)
          .ilike("email", email)
          .limit(1)
          .maybeSingle();
        if (cm) contactMatch = cm;
      }

      const extracted: ExtractedCard = {
        fields,
        suggested_source: suggestedSource,
        company_match: companyMatch,
        contact_match: contactMatch,
      };
      await service
        .from("contact_candidates")
        .update({
          extracted,
          matched_account_id: companyMatch?.id ?? null,
          matched_contact_id: contactMatch?.id ?? null,
        })
        .eq("id", candidate.id);
      processed += 1;
    } catch (err) {
      await service
        .from("contact_candidates")
        .update({
          extracted: {
            error: err instanceof Error ? err.message : "card reading failed",
          } satisfies ExtractedCard,
        })
        .eq("id", candidate.id);
      failed += 1;
    }
  }

  return NextResponse.json({ processed, failed });
}

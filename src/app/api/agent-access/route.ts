import { NextResponse } from "next/server";
import { hasActiveMembership } from "@/lib/mcp/access";
import { getSupabaseServerClient } from "@/lib/supabase/server";

// Whether the signed-in person may connect an AI agent: any active member.
// The client gets one boolean.
export async function GET() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { allowed: false },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  return NextResponse.json(
    { allowed: await hasActiveMembership(supabase, user.id) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

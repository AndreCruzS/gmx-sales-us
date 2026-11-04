import { NextResponse } from "next/server";
import { isAllowedEmail } from "@/lib/mcp/auth";
import { getSupabaseServerClient } from "@/lib/supabase/server";

// Whether the signed-in person may connect an AI agent. The allow-list is a
// server env and never leaves it: the client gets one boolean.
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
    { allowed: isAllowedEmail(user.email) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

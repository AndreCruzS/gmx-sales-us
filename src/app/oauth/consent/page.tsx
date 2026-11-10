import { getSupabaseServerClient } from "@/lib/supabase/server";
import { hasActiveMembership } from "@/lib/mcp/access";
import { ConsentClient } from "./consent-client";

// Where Supabase's OAuth server sends a person to approve an agent (Claude,
// Meta Muse...) acting as them. Any active member may; it is decided here
// and passed down as a plain boolean.
export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ authorization_id?: string }>;
}) {
  const { authorization_id } = await searchParams;
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return (
    <ConsentClient
      authorizationId={authorization_id ?? null}
      allowed={await hasActiveMembership(supabase, user?.id)}
    />
  );
}

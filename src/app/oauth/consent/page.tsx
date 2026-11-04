import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isAllowedEmail } from "@/lib/mcp/auth";
import { ConsentClient } from "./consent-client";

// Where Supabase's OAuth server sends a person to approve an agent (Claude,
// Meta Muse...) acting as them. The allow-list is a server env, so it is
// decided here and passed down as a plain boolean.
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
      allowed={isAllowedEmail(user?.email)}
    />
  );
}

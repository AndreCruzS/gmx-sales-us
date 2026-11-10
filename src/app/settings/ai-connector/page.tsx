import { headers } from "next/headers";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { hasActiveMembership } from "@/lib/mcp/access";
import { configuredOrigin } from "@/lib/mcp/metadata";
import { connectorAddress, originFromHeaders } from "@/lib/mcp/connector-guide";
import { ConnectorGuide } from "./connector-guide";

// How a person connects their own AI agent (Meta Muse, Claude). Any active
// member may; it is decided here and the client only gets the address to paste.
export default async function AiConnectorPage() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!(await hasActiveMembership(supabase, user?.id))) {
    return (
      <div className="card card-pad aic-refuse">
        <p>Agent access isn&apos;t open for your account yet.</p>
      </div>
    );
  }

  const h = await headers();
  const address = connectorAddress(configuredOrigin(), originFromHeaders((n) => h.get(n)));
  return <ConnectorGuide address={address} />;
}

import { headers } from "next/headers";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isAllowedEmail } from "@/lib/mcp/auth";
import { configuredOrigin } from "@/lib/mcp/metadata";
import { connectorAddress, originFromHeaders } from "@/lib/mcp/connector-guide";
import { ConnectorGuide } from "./connector-guide";

// How a person connects their own AI agent (Meta Muse, Claude). The allow-list
// is a server env, so it is decided here; the client only gets the verdict
// and the address to paste.
export default async function AiConnectorPage() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!isAllowedEmail(user?.email)) {
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

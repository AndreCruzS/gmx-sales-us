"use client";

// Home nudge for someone who may connect an AI agent but has not yet. Renders
// nothing until BOTH checks resolve, so it never flashes in and out.

import Link from "next/link";
import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { DISMISS_KEY, shouldShowConnectorCard } from "@/lib/mcp/connector-guide";
import { useAgentAccess } from "@/lib/mcp/use-agent-access";
import { useOffline } from "./offline-provider";

export function ConnectorCard() {
  const { profile } = useOffline();
  const allowed = useAgentAccess(profile?.email);
  // null = not checked yet; the dismissed flag and the agent_actions probe
  // are read together so the card appears once, already decided.
  const [local, setLocal] = useState<{ hasAgentActions: boolean; dismissed: boolean } | null>(null);

  useEffect(() => {
    if (!allowed) return;
    let live = true;
    void (async () => {
      let dismissed = false;
      try {
        dismissed = localStorage.getItem(DISMISS_KEY) === "1";
      } catch {
        // storage blocked — treat as not dismissed
      }
      let hasAgentActions = false;
      if (!dismissed) {
        try {
          const { data, error } = await getSupabaseBrowserClient()
            .from("agent_actions")
            .select("id")
            .limit(1);
          // an error (offline, no table access) stays quiet rather than nags
          hasAgentActions = !!error || (data?.length ?? 0) > 0;
        } catch {
          // offline — stay quiet rather than nag
          hasAgentActions = true;
        }
      }
      if (live) setLocal({ hasAgentActions, dismissed });
    })();
    return () => {
      live = false;
    };
  }, [allowed]);

  if (!allowed || !local || !shouldShowConnectorCard({ allowed, ...local })) return null;

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // still hide it for this visit
    }
    setLocal((l) => (l ? { ...l, dismissed: true } : l));
  }

  return (
    <section className="card card-pad aic-home" aria-label="AI connector">
      <h2 className="aic-home-title">✦ Use GMX Sales from your AI agent</h2>
      <p className="aic-text">
        Connect Muse or Claude once. Then tell it about your day — &quot;left a PK at Big Creek,
        six people&quot; — and it records it here, as you.
      </p>
      <div className="aic-home-actions">
        <Link href="/settings/ai-connector" className="btn-primary">
          Set it up
        </Link>
        <button type="button" className="btn-quiet" onClick={dismiss}>
          Not now
        </button>
      </div>
    </section>
  );
}

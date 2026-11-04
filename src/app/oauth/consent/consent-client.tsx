"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type Phase =
  | { kind: "loading" }
  | { kind: "ready"; clientName: string }
  | { kind: "error"; message: string };

export function ConsentClient({
  authorizationId,
  allowed,
}: {
  authorizationId: string | null;
  allowed: boolean;
}) {
  const [phase, setPhase] = useState<Phase>(
    authorizationId
      ? { kind: "loading" }
      : { kind: "error", message: "This link is missing its request. Start the connection again from your agent." },
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!authorizationId) return;
    let live = true;
    (async () => {
      const { data, error } = await getSupabaseBrowserClient().auth.oauth.getAuthorizationDetails(authorizationId);
      if (!live) return;
      if (error || !data) {
        setPhase({ kind: "error", message: "We couldn't load this request. It may have expired. Start again from your agent." });
      } else if (!("authorization_id" in data)) {
        // Already approved earlier: send the person straight back.
        window.location.assign(data.redirect_url);
      } else {
        setPhase({ kind: "ready", clientName: data.client?.name || "This agent" });
      }
    })();
    return () => {
      live = false;
    };
  }, [authorizationId]);

  async function decide(approve: boolean) {
    if (!authorizationId) return;
    setBusy(true);
    const oauth = getSupabaseBrowserClient().auth.oauth;
    const { data, error } = approve
      ? await oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
      : await oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true });
    if (error || !data) {
      setBusy(false);
      setPhase({ kind: "error", message: "That didn't go through. Start again from your agent." });
      return;
    }
    window.location.assign(data.redirect_url);
  }

  const name = phase.kind === "ready" ? phase.clientName : "";

  return (
    <div className="fixed inset-0 flex overflow-y-auto px-4">
      <div className="m-auto flex w-full max-w-sm flex-col gap-4 py-8">
        <div className="card card-pad flex flex-col gap-4">
          {phase.kind === "loading" && <p className="t-hint">Loading…</p>}

          {phase.kind === "error" && <p className="text-sm text-red-600">{phase.message}</p>}

          {phase.kind === "ready" && !allowed && (
            <>
              <h1 className="t-title text-xl">Agent access isn&apos;t open for your account yet.</h1>
              <button onClick={() => decide(false)} disabled={busy} className="btn-secondary w-full">
                Deny
              </button>
            </>
          )}

          {phase.kind === "ready" && allowed && (
            <>
              <h1 className="t-title text-xl">Allow {name} to act as you on GMX Sales?</h1>
              <p className="t-hint">
                It will see and record what you can see and record in the app, as you. You can
                disconnect it any time from {name}.
              </p>
              <div className="flex flex-col gap-2">
                <button onClick={() => decide(true)} disabled={busy} className="btn-primary w-full">
                  Allow
                </button>
                <button onClick={() => decide(false)} disabled={busy} className="btn-secondary w-full">
                  Deny
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

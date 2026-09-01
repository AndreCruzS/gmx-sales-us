"use client";

// EMAIL & CALENDAR — the rep's second handshake.
//
// The Google login only proved identity. This page asks Google for the two
// working permissions — send mail as the rep (gmail.send) and write their
// calendar (calendar.events) — through the SAME Google account they signed
// in with. The OAuth round-trip comes back here carrying a provider refresh
// token; that token is the durable key the server will use to send quotes
// from the rep's own address and land visits on their own calendar, and it
// is saved against their membership the moment the redirect lands.
//
// prompt=consent + access_type=offline are not decoration: without them
// Google returns no refresh token and the connection would die within the
// hour. With them, one handshake lasts until the rep revokes it.

import { useEffect, useState } from "react";
import { useOffline } from "@/components/offline-provider";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar.events",
];

interface Connection {
  google_email: string | null;
  scopes: string[];
  connected_at: string;
}

const DAY = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export default function GoogleSetupPage() {
  const { profile } = useOffline();
  const [conn, setConn] = useState<Connection | null>(null);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // One effect owns the whole story: capture a fresh handshake if the OAuth
  // redirect just landed, then read whatever connection now stands.
  useEffect(() => {
    if (!profile) return;
    let stale = false;
    const timer = setTimeout(() => {
      void (async () => {
        const supabase = getSupabaseBrowserClient();
        try {
          const {
            data: { session },
          } = await supabase.auth.getSession();
          // The refresh token only rides the session right after the OAuth
          // redirect — catch it now or lose it until the next consent.
          const refresh = (
            session as unknown as { provider_refresh_token?: string | null }
          )?.provider_refresh_token;
          if (refresh) {
            await supabase.from("google_connections").upsert({
              membership_id: profile.membershipId,
              org_id: profile.orgId,
              google_email: session?.user.email ?? null,
              scopes: GOOGLE_SCOPES,
              refresh_token: refresh,
              updated_at: new Date().toISOString(),
            });
          }
          const { data } = await supabase
            .from("google_connections")
            .select("google_email, scopes, connected_at")
            .eq("membership_id", profile.membershipId)
            .maybeSingle();
          if (!stale) setConn((data as Connection | null) ?? null);
        } catch {
          if (!stale)
            setError("Couldn't reach the server — try again with signal.");
        } finally {
          if (!stale) setChecked(true);
        }
      })();
    }, 0);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [profile]);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const { error: oauthErr } =
        await getSupabaseBrowserClient().auth.signInWithOAuth({
          provider: "google",
          options: {
            redirectTo: `${location.origin}/settings/google`,
            scopes: GOOGLE_SCOPES.join(" "),
            queryParams: {
              access_type: "offline",
              prompt: "consent",
            },
          },
        });
      if (oauthErr) throw oauthErr;
      // the browser is leaving for Google — nothing more to do here
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="stack pt-2">
      <section className="flex flex-col gap-3">
        <h1 className="t-section">Email &amp; Calendar</h1>
        <p className="t-sub">
          Your login proved who you are. This connects what the app can do{" "}
          <em>as</em> you: send quotes from your own Gmail — your address, your
          sent folder, replies to your inbox — and put visits on your own
          calendar.
        </p>

        {conn ? (
          <div className="card card-pad flex flex-col gap-2">
            <p className="t-title">Connected</p>
            <p className="t-sub">
              {conn.google_email ?? "Your Google account"} · since{" "}
              {DAY.format(new Date(conn.connected_at))}
            </p>
            <p className="t-hint">
              Quotes can travel as you, and visits can land on your calendar.
              Reconnect if you ever revoke access in your Google account.
            </p>
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={() => void connect()}
            >
              Reconnect
            </button>
          </div>
        ) : checked ? (
          <div className="card card-pad flex flex-col gap-3">
            <p className="t-title">Two permissions, one tap</p>
            <ul className="t-sub flex flex-col gap-1">
              <li>· Send email as you — your quotes, from your address</li>
              <li>· Add events to your calendar — your visits, on your days</li>
            </ul>
            <button
              type="button"
              className="btn-primary"
              disabled={busy}
              onClick={() => void connect()}
            >
              {busy ? "Opening Google…" : "Connect Gmail & Calendar"}
            </button>
            <p className="t-hint">
              You&rsquo;ll sign in with the same Google account you use for the
              app. You can revoke this any time from your Google account.
            </p>
          </div>
        ) : (
          <div className="card card-pad" aria-busy="true">
            <p className="t-hint">Checking your connection…</p>
          </div>
        )}

        {error && (
          <p className="t-sub" style={{ color: "var(--danger)" }}>
            {error}
          </p>
        )}
      </section>
    </div>
  );
}

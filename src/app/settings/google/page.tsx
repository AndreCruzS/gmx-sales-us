"use client";

// EMAIL & CALENDAR — the rep's second handshake.
//
// The Google login only proved identity. This page asks Google for the two
// working permissions — send mail as the rep (gmail.send), write their
// calendar (an admin: calendar; a rep: calendar.app.created, a "GMX · Agenda"
// of its own in their account, 2026-10-20) and, for a rep, read the mail they trade with
// CRM contacts (gmail.readonly, 2026-10-20) — through the SAME account they signed
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
import { CALENDAR_APP_CREATED, GMAIL_READ, missingScopes, scopesFor } from "@/lib/google/scopes";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

// What each role asks for lives in lib/google/scopes, where the banner reads it too.

interface TeamCalendar {
  /** null once an owner is registered but before the first pass made the calendar. */
  google_calendar_id: string | null;
  owner_membership_id: string;
  summary: string;
  last_synced_at: string | null;
  last_error: string | null;
}

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
  const [team, setTeam] = useState<TeamCalendar | null>(null);
  const [teamNote, setTeamNote] = useState<string | null>(null);
  const [ownerName, setOwnerName] = useState<string | null>(null);

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
              scopes: [...scopesFor(profile.role)],
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
          // THE DESK'S NEXT STEP: with a fresh admin grant, run the sync now
          // so the page can say "GMX Sales Team · owned by …" — or the error
          // in words — before the admin leaves.
          if (profile.role === "admin") {
            if (refresh) {
              const res = await fetch("/api/calendar/team/sync", { method: "POST" });
              const body = (await res.json().catch(() => ({}))) as { error?: string };
              if (!stale) setTeamNote(res.ok ? null : (body.error ?? `sync failed (${res.status})`));
            }
            const { data: tc } = await supabase
              .from("team_calendars")
              .select("google_calendar_id, owner_membership_id, summary, last_synced_at, last_error")
              .eq("org_id", profile.orgId)
              .maybeSingle();
            if (!stale) setTeam((tc as TeamCalendar | null) ?? null);
            if (tc?.owner_membership_id) {
              const { data: who } = await supabase
                .from("memberships")
                .select("users(full_name)")
                .eq("id", tc.owner_membership_id)
                .maybeSingle();
              if (!stale)
                setOwnerName(
                  (who as unknown as { users: { full_name: string | null } | null } | null)
                    ?.users?.full_name ?? null,
                );
            }
          }
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
            scopes: scopesFor(profile?.role).join(" "),
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

  const missing = conn ? missingScopes(profile?.role, conn.scopes) : [];

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
        {/* THE DESK'S REASON (Andre, 2026-10-12): the team calendar belongs
            to a desk account. Whoever holds it connects here once, and the
            Reps board reads the team's week through that grant. */}
        {profile && profile.role !== "rep" && (
          <p className="t-hint">
            If your Google account owns the team calendar, this is the one
            connection that lets the Reps board read the team&rsquo;s week and
            put visits on it.
          </p>
        )}

        {conn && missing.length > 0 ? (
          // CONNECTED BEFORE THE ASK GREW (2026-10-20): the grant is whole for
          // what it was, and short of what the role now asks — one tap mends it.
          <div className="card card-pad flex flex-col gap-3">
            <p className="t-title">
              {missing.length > 1 ? "Two more permissions" : "One more permission"}
            </p>
            <ul className="t-sub flex flex-col gap-1">
              {missing.includes(GMAIL_READ) && (
                <li>
                  · Read your email with the clients on your accounts — so a
                  conversation, a promise or a quote lands on the client&rsquo;s
                  record by itself
                </li>
              )}
              {missing.includes(CALENDAR_APP_CREATED) && (
                <li>
                  · A GMX Agenda calendar in your Google account — your visits
                  apart from your own events, which the app no longer touches
                </li>
              )}
            </ul>
            <p className="t-hint">
              Only email exchanged with contacts in the app is kept. Everything
              else in your inbox is never stored.
            </p>
            <button
              type="button"
              className="btn-primary"
              disabled={busy}
              onClick={() => void connect()}
            >
              {busy ? "Opening Google…" : "Update the connection"}
            </button>
          </div>
        ) : conn ? (
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
            <p className="t-title">
              {profile?.role === "admin" ? "Two permissions, one tap" : "Three permissions, one tap"}
            </p>
            <ul className="t-sub flex flex-col gap-1">
              <li>· Send email as you — your quotes, from your address</li>
              <li>
                {profile?.role === "admin"
                  ? "· Add events to your calendar — your visits, on your days"
                  : "· A GMX Agenda calendar in your Google account — your visits, on your days"}
              </li>
              {profile?.role !== "admin" && (
                <li>
                  · Read your email with the clients on your accounts — only
                  email with contacts in the app is kept
                </li>
              )}
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

        {/* THE TEAM CALENDAR, AS IT STANDS (spec 2026-10-12): whose it is,
            when it last agreed with the app, and the last thing that went
            wrong, in words. Admins only — a rep never sees it in Google. */}
        {profile?.role === "admin" && (
          <div className="card card-pad flex flex-col gap-1">
            <p className="t-meta uppercase tracking-wide">Team calendar</p>
            {team ? (
              <>
                <p className="t-title">
                  {team.google_calendar_id ? team.summary : "Not created yet"}
                </p>
                <p className="t-sub">
                  {team.google_calendar_id ? "Owned by " : "Registered to "}
                  {ownerName ?? "an admin"}
                  {team.last_synced_at
                    ? ` · last synced ${DAY.format(new Date(team.last_synced_at))}`
                    : ""}
                </p>
                {team.last_error && (
                  <p className="t-sub" style={{ color: "var(--danger)" }}>
                    {team.last_error}
                  </p>
                )}
              </>
            ) : (
              <p className="t-sub">
                Not created yet. The admin whose Google account will own it
                taps Connect above; the calendar is created and shared with
                every admin on the spot.
              </p>
            )}
            {teamNote && (
              <p className="t-sub" style={{ color: "var(--danger)" }}>
                {teamNote}
              </p>
            )}
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

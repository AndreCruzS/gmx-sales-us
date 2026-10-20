"use client";

// FINISH YOUR SETUP — the second handshake (Andre, 2026-09-01).
//
// Logging in proves who you are; the Google connection proves the app may
// act AS you: send a quote from your own Gmail, write a visit to your own
// calendar. The ask does not go away — no dismiss, by design: an
// unconnected person sees it on every screen until the handshake is done.
//
// ADMINS ARE ASKED TOO (Andre, 2026-10-12). The agenda is becoming ONE team
// Google Calendar, read into the Reps board and written from it, and the
// account that owns that calendar is a desk account, not a rep's. Nobody at
// the desk had ever seen this banner — it was written for reps only — which
// is why, a month on, not one connection existed. Same page, same two
// permissions; only the reason on the banner changes with the role.
//
// The banner only speaks when it KNOWS: profile says rep or admin, and the
// connections table answered "no row". Offline, or still loading, it stays
// silent rather than nagging on a guess.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useOffline } from "@/components/offline-provider";
import { manages } from "@/lib/domain/roles";
import { missingScopes } from "@/lib/google/scopes";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export function SetupBanner() {
  const { profile } = useOffline();
  const pathname = usePathname();
  const [connected, setConnected] = useState<boolean | null>(null);
  // THE OWNER'S GRANT DIED (spec 2026-10-12): Google answered invalid_grant
  // on the team calendar's refresh token. Only the owner can mend it, so
  // only the owner is told — the words come from team_calendars.last_error.
  const [reconnect, setReconnect] = useState(false);

  const asked = profile ? profile.role === "rep" || manages(profile.role) : false;

  useEffect(() => {
    if (!profile || !asked) return;
    let stale = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const { data, error } = await getSupabaseBrowserClient()
            .from("google_connections")
            .select("scopes")
            .eq("membership_id", profile.membershipId)
            .maybeSingle();
          // A grant short of what the role now asks counts as unfinished
          // (2026-10-20: reps were asked to let the app read their mail).
          if (!stale && !error) {
            setConnected(
              Boolean(data) &&
                missingScopes(profile.role, (data as { scopes: string[] | null }).scopes).length === 0,
            );
          }
          if (manages(profile.role)) {
            const { data: tc } = await getSupabaseBrowserClient()
              .from("team_calendars")
              .select("owner_membership_id, last_error")
              .eq("org_id", profile.orgId)
              .maybeSingle();
            if (
              !stale &&
              tc?.owner_membership_id === profile.membershipId &&
              typeof tc.last_error === "string" &&
              /reconnect/i.test(tc.last_error)
            )
              setReconnect(true);
          }
        } catch {
          // offline — no nagging on a guess
        }
      })();
    }, 0);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [profile, asked]);

  if (
    !profile ||
    !asked ||
    (connected !== false && !reconnect) ||
    pathname === "/login" ||
    pathname.startsWith("/settings/google")
  ) {
    return null;
  }

  return (
    <Link href="/settings/google" className="setup-banner">
      <span className="setup-banner-mark" aria-hidden="true">
        !
      </span>
      <span>
        <strong>Finish your setup</strong>
        {reconnect
          ? " — Google dropped the team calendar connection; reconnect to keep the agenda in sync"
          : profile.role === "rep"
            ? " — connect your Gmail & Calendar so quotes, visits and client email travel with you"
            : " — connect Google Calendar so the team's agenda can show here"}
      </span>
      <span aria-hidden="true">›</span>
    </Link>
  );
}

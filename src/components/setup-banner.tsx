"use client";

// FINISH YOUR SETUP — the rep's second handshake (Andre, 2026-09-01).
//
// Logging in proves who you are; the Google connection proves the app may
// act AS you: send a quote from your own Gmail, write a visit to your own
// calendar. Admins run the desk and are never asked. Every rep is, and the
// ask does not go away — no dismiss, by design: an unconnected rep sees it
// on every screen until the handshake is done.
//
// The banner only speaks when it KNOWS: profile says rep, and the
// connections table answered "no row". Offline, or still loading, it stays
// silent rather than nagging on a guess.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useOffline } from "@/components/offline-provider";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export function SetupBanner() {
  const { profile } = useOffline();
  const pathname = usePathname();
  const [connected, setConnected] = useState<boolean | null>(null);

  useEffect(() => {
    if (!profile || profile.role !== "rep") return;
    let stale = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const { data, error } = await getSupabaseBrowserClient()
            .from("google_connections")
            .select("membership_id")
            .eq("membership_id", profile.membershipId)
            .maybeSingle();
          if (!stale && !error) setConnected(Boolean(data));
        } catch {
          // offline — no nagging on a guess
        }
      })();
    }, 0);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [profile]);

  if (
    !profile ||
    profile.role !== "rep" ||
    connected !== false ||
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
        <strong>Finish your setup</strong> — connect your Gmail &amp; Calendar
        so quotes and visits can travel as you
      </span>
      <span aria-hidden="true">›</span>
    </Link>
  );
}

"use client";

// Top nav bar (kit: Nav Bar, 56px). The screen's own name lives here — the app
// name told a rep nothing they didn't already know, and this is the most
// valuable strip on a phone.
//
// Root tabs get search; everything else gets a back affordance, because a form
// or a report with no exit but the tab bar is a dead end.

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { ChevronRightIcon, SearchIcon } from "./icons";
import { useOffline } from "./offline-provider";
import { SyncBadge } from "./sync-badge";

const TITLES: Record<string, string> = {
  "/": "Home",
  "/visits": "Visits",
  "/routine": "Routine",
  "/accounts": "Accounts",
  "/accounts/new": "New account",
  "/quotes": "Quotes",
  "/quotes/new": "New quote",
  "/record": "Record",
  "/review": "Review",
  "/dashboard": "Insights",
  "/weekly": "Weekly review",
};

// The tab-bar destinations — these are roots, so they carry no back button.
const ROOTS = new Set(["/", "/accounts", "/record", "/review", "/dashboard"]);

/** "deon@gmxgroup.com" → "Deon". The cache never holds a display name. */
function nameFromEmail(email: string): string {
  const local = email.split("@")[0]?.split(/[._-]/)[0] ?? "";
  return local ? local.charAt(0).toUpperCase() + local.slice(1) : "";
}

export function NavBar() {
  const pathname = usePathname();
  const router = useRouter();
  const { profile } = useOffline();
  const [territory, setTerritory] = useState<string | null>(null);

  // The patch name is the rep's own address in the business, so it is worth
  // one small query. It is not on the cached profile (only its id is).
  useEffect(() => {
    const id = profile?.territoryId;
    if (!id) return;
    let stale = false;
    void (async () => {
      try {
        const { data } = await getSupabaseBrowserClient()
          .from("territories")
          .select("name")
          .eq("id", id)
          .maybeSingle();
        if (!stale && data?.name) setTerritory(data.name);
      } catch {
        // offline — the identity block falls back to the screen name
      }
    })();
    return () => {
      stale = true;
    };
  }, [profile?.territoryId]);

  if (pathname === "/login") return null;

  const title =
    TITLES[pathname] ??
    (pathname.startsWith("/accounts/") ? "Account" : "Commercial OS");
  const isRoot = ROOTS.has(pathname);

  // On a root screen the demo puts the person there, not the page name: a rep
  // knows which screen they opened, and "whose numbers are these" is the
  // question a shared device actually raises.
  const person = profile ? nameFromEmail(profile.email) : "";
  const showIdentity = isRoot && !!person;

  return (
    // the bar spans full width so content scrolls under a continuous blur;
    // the inner column matches the content box so the title and the sync chip
    // line up with what's below them
    <header className="navbar">
      <div className="navbar-inner">
        {!isRoot && (
          <button
            onClick={() => router.back()}
            className="navbar-back"
            aria-label="Go back"
          >
            {/* the Hue library ships one chevron; left is its mirror */}
            <ChevronRightIcon size={20} style={{ transform: "scaleX(-1)" }} />
          </button>
        )}

        {showIdentity ? (
          <div className="navbar-identity">
            <span className="navbar-avatar" aria-hidden="true">
              {person.slice(0, 2).toUpperCase()}
            </span>
            <span className="min-w-0">
              <h1 className="navbar-title truncate">{person}</h1>
              <span className="navbar-patch truncate">{territory ?? title}</span>
            </span>
          </div>
        ) : (
          <h1 className="navbar-title">{title}</h1>
        )}

        <div className="navbar-actions">
          {/* search lives on the Accounts tab now — the icon is a shortcut */}
          {!pathname.startsWith("/accounts") && (
            <Link href="/accounts" className="navbar-icon" aria-label="Find an account">
              <SearchIcon size={19} />
            </Link>
          )}
          <SyncBadge />
        </div>
      </div>
    </header>
  );
}

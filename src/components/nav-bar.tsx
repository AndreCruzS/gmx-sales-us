"use client";

// Top nav bar (kit: Nav Bar, 56px). The screen's own name lives here — the app
// name told a rep nothing they didn't already know, and this is the most
// valuable strip on a phone.
//
// Root tabs get search; everything else gets a back affordance, because a form
// or a report with no exit but the tab bar is a dead end.

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { avatarLetter } from "@/lib/format";
import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { CheckIcon, ChevronRightIcon, SearchIcon } from "./icons";
import { useOffline } from "./offline-provider";
import { SyncBadge } from "./sync-badge";
import { useReviewCount } from "@/lib/review/count";

const TITLES: Record<string, string> = {
  "/": "Home",
  "/visits": "Agenda",
  "/routine": "Routine",
  "/accounts": "Accounts",
  "/accounts/new": "New account",
  "/quotes": "Quotes",
  "/quotes/new": "New quote",
  "/record": "Record",
  "/review": "Review",
  "/dashboard": "Insights",
  "/dashboard/rep": "Rep",
  "/weekly": "Weekly review",
};

// The tab-bar destinations — these are roots, so they carry no back button.
// Kept in step with TABS in tab-bar.tsx: /record, /review and /dashboard are
// reached from somewhere now rather than tapped into, so they need the way
// back that a root does not.
const ROOTS = new Set(["/", "/visits", "/accounts", "/quotes"]);

/** "deon@gmxgroup.com" → "Deon". The cache never holds a display name. */
function nameFromEmail(email: string): string {
  const local = email.split("@")[0]?.split(/[._-]/)[0] ?? "";
  return local ? local.charAt(0).toUpperCase() + local.slice(1) : "";
}

export function NavBar() {
  const pathname = usePathname();
  const reviewCount = useReviewCount();
  const router = useRouter();
  const { profile } = useOffline();
  // Stored WITH the id it belongs to. Keeping just the name let one session's
  // patch survive into the next: Bianca is an admin with no territory at all,
  // and the effect's early return left Deon's "SOCAL" sitting under her name.
  // Comparing the id is also why this needs no reset — a name that does not
  // match the current profile is simply not shown.
  const [territory, setTerritory] = useState<{ id: string; name: string } | null>(
    null,
  );

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
        if (!stale && data?.name) setTerritory({ id, name: data.name });
      } catch {
        // offline — the identity block falls back to the screen name
      }
    })();
    return () => {
      stale = true;
    };
  }, [profile?.territoryId]);

  const patch =
    territory && territory.id === profile?.territoryId ? territory.name : null;

  if (pathname === "/login") return null;

  const title =
    TITLES[pathname] ??
    (pathname.startsWith("/accounts/")
      ? "Account"
      : pathname.startsWith("/dashboard/rep/")
        ? "Rep"
        : "Commercial OS");
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
    <header className="navbar" data-root={isRoot || undefined}>
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
              {avatarLetter(person)}
            </span>
            <span className="min-w-0">
              <h1 className="navbar-title truncate">{person}</h1>
              <span className="navbar-patch truncate">{patch ?? title}</span>
            </span>
          </div>
        ) : (
          <h1 className="navbar-title">{title}</h1>
        )}

        <div className="navbar-actions">
          {/* Review lost its tab when Quotes took the slot, and Home's "waiting
              your OK" card came off at leadership's request — so without this
              a rep would have no way of learning a draft is waiting except by
              being on Home. It follows them here instead, on every screen, and
              only when there is actually something to answer for. */}
          {reviewCount > 0 && !pathname.startsWith("/review") && (
            <Link
              href="/review"
              className="navbar-icon navbar-review"
              aria-label={`${reviewCount} waiting for your OK`}
            >
              <CheckIcon size={19} />
              <span className="tab-badge" aria-hidden="true">
                {reviewCount > 9 ? "9+" : reviewCount}
              </span>
            </Link>
          )}
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

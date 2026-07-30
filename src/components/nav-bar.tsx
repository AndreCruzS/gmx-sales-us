"use client";

// Top nav bar (kit: Nav Bar, 56px). The screen's own name lives here — the app
// name told a rep nothing they didn't already know, and this is the most
// valuable strip on a phone.
//
// Root tabs get search; everything else gets a back affordance, because a form
// or a report with no exit but the tab bar is a dead end.

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronRightIcon, SearchIcon } from "./icons";
import { SyncBadge } from "./sync-badge";

const TITLES: Record<string, string> = {
  "/": "Home",
  "/visits": "Visits",
  "/accounts": "Accounts",
  "/record": "Record",
  "/review": "Review",
  "/dashboard": "Insights",
  "/weekly": "Weekly review",
};

// The tab-bar destinations — these are roots, so they carry no back button.
const ROOTS = new Set(["/", "/accounts", "/record", "/review", "/dashboard"]);

export function NavBar() {
  const pathname = usePathname();
  const router = useRouter();

  if (pathname === "/login") return null;

  const title =
    TITLES[pathname] ??
    (pathname.startsWith("/accounts/") ? "Account" : "Commercial OS");
  const isRoot = ROOTS.has(pathname);

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

        <h1 className="navbar-title">{title}</h1>

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

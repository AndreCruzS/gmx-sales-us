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
  "/": "Today",
  "/agenda": "Agenda",
  "/capture": "Register activity",
  "/debriefs": "Voice debrief",
  "/dashboard": "Dashboard",
  "/weekly": "Weekly review",
  "/tray": "Needs attention",
  "/search": "Search",
};

// The tab-bar destinations — these are roots, so they carry no back button.
const ROOTS = new Set(["/", "/agenda", "/debriefs", "/dashboard"]);

export function NavBar() {
  const pathname = usePathname();
  const router = useRouter();

  if (pathname === "/login") return null;

  const title =
    TITLES[pathname] ??
    (pathname.startsWith("/accounts/") ? "Account" : "Commercial OS");
  const isRoot = ROOTS.has(pathname);

  return (
    <header className="navbar">
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
        {pathname !== "/search" && (
          <Link href="/search" className="navbar-icon" aria-label="Search">
            <SearchIcon size={19} />
          </Link>
        )}
        <SyncBadge />
      </div>
    </header>
  );
}

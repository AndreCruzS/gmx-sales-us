"use client";

// Bottom tab bar — five destinations drawn from the rep's day, not from the
// system's modules: my day, my week, add something, my patch, my money.
//
// The demo's own bar was Today · Card · [Talk] · Plan · Patch, and Card and
// Talk have both moved inside the plus — which freed the two slots this now
// spends on the week and on quotes. Review and Insights lost their tabs with
// it: Review's count moved to the nav bar so it still follows a rep from
// screen to screen, and Insights is a desk screen reached from Home.
//
// The centre is the elevated action, and it is a PLUS rather than a mic. A
// rep's hand goes to the middle of the bar to put something into the system,
// and until now that gesture could only ever mean "talk" — adding a dealer or
// booking a visit meant navigating somewhere first and finding a button. One
// tap now unfolds the three things a rep actually adds. Talking stays nearest
// the thumb, because it is still the flow that must never be more than a tap
// away (D45).

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useOffline } from "@/components/offline-provider";
import { isAdmin, manages } from "@/lib/domain/roles";
import { useReviewCount } from "@/lib/review/count";
import { SyncBadge } from "./sync-badge";
import { SignOutButton } from "./sign-out";
import {
  BuildingIcon,
  CalendarIcon,
  ChartIcon,
  CheckIcon,
  FileIcon,
  HomeIcon,
  MicrophoneIcon,
  PlusIcon,
  SearchIcon,
  UploadIcon,
  type IconProps,
} from "./icons";

const TABS = [
  { href: "/", label: "Home", Icon: HomeIcon },
  { href: "/visits", label: "Agenda", Icon: CalendarIcon },
  { href: "/accounts", label: "Accounts", Icon: BuildingIcon },
  { href: "/quotes", label: "Quotes", Icon: FileIcon },
];

// Listed nearest-thumb first: the menu unfolds upward, so the first entry ends
// up closest to the button that opened it. The order is how often a rep
// actually reaches for each — notes daily, visits weekly, quotes when the
// conversation turns to price, a new company rarely.
interface AddItem {
  href: string;
  label: string;
  hint: string;
  Icon: (p: IconProps) => React.ReactElement;
}

const ADD_ITEMS: readonly AddItem[] = [
  {
    href: "/record",
    label: "Voice note",
    hint: "Log a visit in 20 seconds",
    Icon: MicrophoneIcon,
  },
  {
    href: "/visits?plan=new",
    label: "Plan a visit",
    hint: "Book a stop with an objective",
    Icon: CalendarIcon,
  },
  {
    href: "/quotes/new",
    label: "Quote",
    hint: "Price something for an account",
    Icon: FileIcon,
  },
  {
    href: "/accounts/new",
    label: "Company",
    hint: "A new door in the patch",
    Icon: BuildingIcon,
  },
];

// The desk's own entry, and the only one that is not a rep's. The sales figures
// do not come from anybody using this app: a distributor sends a spreadsheet and
// an admin loads it. That is the single most consequential thing anyone puts INTO
// the system — every sales screen is downstream of it — and it had no home at
// all, which meant the person whose job it is had to be told where to go.
//
// Furthest from the thumb because it is monthly, not daily.
const ADMIN_ADD_ITEM: AddItem = {
  href: "/sell-through",
  label: "Sales report",
  hint: "Load a distributor's month",
  Icon: UploadIcon,
};

// How long the fold-away takes: the last item's delay plus its own duration
// (0.12s + 0.18s, now that the desk's menu is five items deep)
// (see .add-menu.is-closing in globals.css). The menu stays mounted for
// exactly this long so the exit can be seen — unmounting on the click would
// make it vanish, which is the thing that felt wrong.
const CLOSE_MS = 300;

export function TabBar() {
  const pathname = usePathname();
  const { profile } = useOffline();
  const reviewCount = useReviewCount();
  // Three states, not two: a menu that is on its way out is still on screen.
  const [addState, setAddState] = useState<"closed" | "open" | "closing">(
    "closed",
  );
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const addOpen = addState === "open";
  const addVisible = addState !== "closed";

  const stopTimer = useCallback(() => {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const closeAdd = useCallback(() => {
    stopTimer();
    // Someone who has asked for less motion gets none: it goes at once rather
    // than sitting through an animation they turned off.
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setAddState("closed");
      return;
    }
    setAddState("closing");
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      setAddState("closed");
    }, CLOSE_MS);
  }, [stopTimer]);

  function toggleAdd() {
    if (addState === "open") {
      closeAdd();
    } else {
      // Re-opening mid-fold has to cancel the pending unmount, or the menu
      // would open and then disappear a moment later.
      stopTimer();
      setAddState("open");
    }
  }

  // Escape closes it, the way any menu should. Registered from an effect but
  // only ever setting state from inside the handler — never synchronously
  // during the effect body.
  useEffect(() => {
    if (!addOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeAdd();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [addOpen, closeAdd]);

  // A pending unmount must not outlive the component.
  useEffect(() => stopTimer, [stopTimer]);

  if (pathname === "/login") return null;

  // The week has its own tab now, so Home no longer claims /visits. /routine
  // still has no tab of its own — it is a chore list a rep opens from Home and
  // clears — so the Home tab stays lit while on it, the same way
  // "/accounts/[id]" keeps Accounts lit via startsWith.
  // Reps get the four things a rep adds; the desk gets a fifth. ADMIN, not
  // manager: every write policy on the sell-through tables is is_admin(), so
  // offering this to a manager would be offering a form that fails on save.
  // Until the profile resolves this is the rep's list, which is the same default
  // the home switch takes — capture must never wait on a role lookup.
  const addItems = isAdmin(profile?.role)
    ? [...ADD_ITEMS, ADMIN_ADD_ITEM]
    : ADD_ITEMS;

  const isActive = (href: string) =>
    href === "/"
      ? pathname === "/" || pathname.startsWith("/routine")
      : pathname.startsWith(href);

  const [today, agenda, accounts, quotes] = TABS;
  // For the desk's roles every destination IS a dashboard — the first one is
  // the overview, not anybody's "home", and it wears the chart, not the
  // little house (Andre: "melhor do que a casinha"). A rep's day still
  // starts at Home, under its roof.
  const desk = manages(profile?.role);
  const labelOf = (label: string) =>
    label === "Home" && desk ? "Overview" : label;
  const iconOf = (label: string, Icon: (p: IconProps) => React.ReactElement) =>
    label === "Home" && desk ? ChartIcon : Icon;

  return (
    <>
      {addVisible && (
        <>
          {/* A tap anywhere else closes it — the scrim is the affordance that
              says the rest of the screen is waiting. */}
          <button
            type="button"
            className={`add-scrim${addState === "closing" ? " is-closing" : ""}`}
            aria-label="Close the add menu"
            onClick={closeAdd}
          />
          <div
            className={`add-menu${addState === "closing" ? " is-closing" : ""}`}
            role="menu"
            aria-label="Add to the system"
          >
            {addItems.map(({ href, label, hint, Icon }) => (
              <Link
                key={href}
                href={href}
                role="menuitem"
                className="add-item"
                onClick={closeAdd}
              >
                <span className="add-item-mark">
                  <Icon size={18} />
                </span>
                <span>
                  <span className="add-item-label">{label}</span>
                  <span className="add-item-hint">{hint}</span>
                </span>
              </Link>
            ))}
          </div>
        </>
      )}

      <nav className="tabbar" aria-label="Primary">
        {[today, agenda].map(({ href, label, Icon }) => {
          const TabIcon = iconOf(label, Icon);
          return (
            <Link
              key={href}
              href={href}
              className="tab"
              data-active={isActive(href)}
              aria-current={isActive(href) ? "page" : undefined}
            >
              <TabIcon size={21} />
              {labelOf(label)}
            </Link>
          );
        })}

        <button
          type="button"
          className="tab tab-capture"
          data-open={addOpen}
          aria-expanded={addOpen}
          aria-haspopup="menu"
          aria-label={addOpen ? "Close the add menu" : "Add to the system"}
          onClick={toggleAdd}
        >
          <span className="tab-fab">
            <PlusIcon size={22} strokeWidth={3} />
          </span>
          <span className="tab-capture-label">Add</span>
        </button>

        {[accounts, quotes].map(({ href, label, Icon }) => (
          <Link
            key={href}
            href={href}
            className="tab"
            data-active={isActive(href)}
            aria-current={isActive(href) ? "page" : undefined}
          >
            <Icon size={21} />
            {labelOf(label)}
          </Link>
        ))}

        {/* THE DESK'S TOOL SHELF, top right beside Add: the review badge, the
            account search, the sync chip. The phone never shows this — its
            nav bar already carries all three. */}
        <span className="tabbar-tools">
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
          {!pathname.startsWith("/accounts") && (
            <Link
              href="/accounts"
              className="navbar-icon"
              aria-label="Find an account"
            >
              <SearchIcon size={19} />
            </Link>
          )}
          <SyncBadge />
          <SignOutButton />
        </span>
      </nav>
    </>
  );
}

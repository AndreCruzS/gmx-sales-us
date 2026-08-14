"use client";

// Bottom tab bar — five destinations drawn from the rep's day, not from the
// system's modules: my day, my accounts, add something, things waiting on me,
// how it's going.
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
import { useEffect, useState } from "react";
import { useReviewCount } from "@/lib/review/count";
import {
  BuildingIcon,
  CalendarIcon,
  ChartIcon,
  CheckIcon,
  FileIcon,
  HomeIcon,
  MicrophoneIcon,
  PlusIcon,
  type IconProps,
} from "./icons";

const TABS = [
  { href: "/", label: "Home", Icon: HomeIcon },
  { href: "/accounts", label: "Accounts", Icon: BuildingIcon },
  { href: "/review", label: "Review", Icon: CheckIcon },
  { href: "/dashboard", label: "Insights", Icon: ChartIcon },
];

// Listed nearest-thumb first: the menu unfolds upward, so the first entry ends
// up closest to the button that opened it. The order is how often a rep
// actually reaches for each — notes daily, visits weekly, quotes when the
// conversation turns to price, a new company rarely.
const ADD_ITEMS: readonly {
  href: string;
  label: string;
  hint: string;
  Icon: (p: IconProps) => React.ReactElement;
}[] = [
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

export function TabBar() {
  const pathname = usePathname();
  const reviewCount = useReviewCount();
  const [addOpen, setAddOpen] = useState(false);

  // Escape closes it, the way any menu should. Registered from an effect but
  // only ever setting state from inside the handler — never synchronously
  // during the effect body.
  useEffect(() => {
    if (!addOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAddOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [addOpen]);

  if (pathname === "/login") return null;

  // /visits and /routine are both one tap behind Home (the day list moved to
  // /visits in Task 4; the chore list is /routine, Task 8) but neither is its
  // own tab destination — the Home tab stays lit while on either, same as how
  // "/accounts/[id]" keeps the Accounts tab lit via startsWith.
  const isActive = (href: string) =>
    href === "/"
      ? pathname === "/" ||
        pathname.startsWith("/visits") ||
        pathname.startsWith("/routine")
      : pathname.startsWith(href);

  const [today, accounts, review, insights] = TABS;

  return (
    <>
      {addOpen && (
        <>
          {/* A tap anywhere else closes it — the scrim is the affordance that
              says the rest of the screen is waiting. */}
          <button
            type="button"
            className="add-scrim"
            aria-label="Close the add menu"
            onClick={() => setAddOpen(false)}
          />
          <div className="add-menu" role="menu" aria-label="Add to the system">
            {ADD_ITEMS.map(({ href, label, hint, Icon }) => (
              <Link
                key={href}
                href={href}
                role="menuitem"
                className="add-item"
                onClick={() => setAddOpen(false)}
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
        {/* the app name belongs in the rail on desktop; on mobile the nav bar
            carries the screen name instead and this stays hidden */}
        <Link href="/" className="tabbar-brand">
          Commercial OS
        </Link>

        {[today, accounts].map(({ href, label, Icon }) => (
          <Link
            key={href}
            href={href}
            className="tab"
            data-active={isActive(href)}
            aria-current={isActive(href) ? "page" : undefined}
          >
            <Icon size={21} />
            {label}
          </Link>
        ))}

        <button
          type="button"
          className="tab tab-capture"
          data-open={addOpen}
          aria-expanded={addOpen}
          aria-haspopup="menu"
          aria-label={addOpen ? "Close the add menu" : "Add to the system"}
          onClick={() => setAddOpen((v) => !v)}
        >
          <span className="tab-fab">
            <PlusIcon size={20} />
          </span>
          Add
        </button>

        {[review, insights].map(({ href, label, Icon }) => (
          <Link
            key={href}
            href={href}
            className="tab"
            data-active={isActive(href)}
            aria-current={isActive(href) ? "page" : undefined}
          >
            <span className="tab-icon">
              <Icon size={21} />
              {href === "/review" && reviewCount > 0 && (
                <span className="tab-badge" aria-label={`${reviewCount} waiting for your review`}>
                  {reviewCount > 9 ? "9+" : reviewCount}
                </span>
              )}
            </span>
            {label}
          </Link>
        ))}
      </nav>
    </>
  );
}

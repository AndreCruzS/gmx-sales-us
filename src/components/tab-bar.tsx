"use client";

// Bottom tab bar — five destinations drawn from the rep's day, not from the
// system's modules: my day, my accounts, record what happened, things waiting
// on me, how it's going.
//
// Record sits in the centre as the elevated action because it is the one flow
// that must never be more than a tap away (D45): a rep in a truck opens the
// app and talks, from whatever screen they were on.

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BuildingIcon,
  ChartIcon,
  CheckIcon,
  HomeIcon,
  MicrophoneIcon,
} from "./icons";

const TABS = [
  { href: "/", label: "Today", Icon: HomeIcon },
  { href: "/accounts", label: "Accounts", Icon: BuildingIcon },
  { href: "/review", label: "Review", Icon: CheckIcon },
  { href: "/dashboard", label: "Insights", Icon: ChartIcon },
];

export function TabBar() {
  const pathname = usePathname();
  if (pathname === "/login") return null;

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  const [today, accounts, review, insights] = TABS;

  return (
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

      <Link
        href="/record"
        className="tab tab-capture"
        data-active={isActive("/record")}
        aria-label="Record what happened"
      >
        <span className="tab-fab">
          <MicrophoneIcon size={20} />
        </span>
        Record
      </Link>

      {[review, insights].map(({ href, label, Icon }) => (
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
    </nav>
  );
}

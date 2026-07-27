"use client";

// Bottom tab bar — layout per the prototyping kit's Tab bar (a 56px row over
// the home-indicator safe area), colour per the GMX kit.
//
// Capture sits in the centre as an elevated action because it is the one flow
// that must never be more than a tap away (D45): a rep in a truck opens the
// app and records, from whatever screen they were on.

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarIcon,
  ChartIcon,
  HomeIcon,
  MicrophoneIcon,
  PlusIcon,
} from "./icons";

const TABS = [
  { href: "/", label: "Home", Icon: HomeIcon },
  { href: "/agenda", label: "Agenda", Icon: CalendarIcon },
  { href: "/debriefs", label: "Debrief", Icon: MicrophoneIcon },
  { href: "/dashboard", label: "Insights", Icon: ChartIcon },
];

export function TabBar() {
  const pathname = usePathname();
  if (pathname === "/login") return null;

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  const [home, agenda, debrief, insights] = TABS;

  return (
    <nav className="tabbar" aria-label="Primary">
      {[home, agenda].map(({ href, label, Icon }) => (
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
        href="/capture"
        className="tab tab-capture"
        data-active={isActive("/capture")}
        aria-label="Register activity"
      >
        <span className="tab-fab">
          <PlusIcon size={22} />
        </span>
        Capture
      </Link>

      {[debrief, insights].map(({ href, label, Icon }) => (
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

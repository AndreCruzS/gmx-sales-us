"use client";

// THE REPS MENU (Andre, 2026-10-06, from the 2026-10-02 meeting with Bianca):
// the desk's bar is SALES · REPS · ACCOUNTS · CONTACTS and nothing else. The
// Agenda and the Quotes did not leave the desk — they are what a rep DOES, so
// they live under Reps, as the three readings of one board: the people, their
// week, their money out for an answer.
//
// THE BOARD ITSELF CARRIES ALL THREE (Andre, 2026-10-06, the same day): the
// Reps page reads like Sales — filter row, three figures, then the team, the
// agenda, the promises and the quotes on one screen. So this strip is not on
// the board any more; it sits on the two full views the board links out to —
// the month on the wall at /visits and the searchable list at /quotes — as
// the way back and across. A row of chips and not a dropdown, for the reason
// the Sales lenses are: a menu that has to be re-opened to see where you are
// loses the reader their place.
//
// A rep never sees it. Their Agenda and Quotes keep their own tabs on the
// phone's bar, where the thumb already knows them.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useOffline } from "@/components/offline-provider";
import { manages } from "@/lib/domain/roles";

export const REPS_MENU = [
  { href: "/reps", label: "Reps" },
  { href: "/visits", label: "Agenda" },
  { href: "/quotes", label: "Quotes" },
] as const;

/** True when this path is one of the Reps board's readings. */
export function underReps(pathname: string): boolean {
  return REPS_MENU.some((m) => pathname.startsWith(m.href));
}

export function RepsMenu() {
  const pathname = usePathname();
  const { profile } = useOffline();
  if (!manages(profile?.role)) return null;
  return (
    // data-span: on the Reps board the page is the desk's 12-column grid and a
    // child that names no width takes ONE column — the row was clipped to its
    // first chip. The attribute is inert on the Agenda and the Quotes.
    <nav className="chip-row reps-menu" data-span="full" aria-label="Reps board">
      {REPS_MENU.map(({ href, label }) => {
        const on = pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className="chip"
            aria-current={on ? "page" : undefined}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

// The two faces of the Agenda (spec 2026-11-03 §4): the day, and the PK
// follow-up of the rep's own PKs. Same segment as the Dealers tabs.

import Link from "next/link";

const TABS = [
  { key: "day", href: "/visits", label: "Day" },
  { key: "pk", href: "/visits/pk", label: "PK follow-up" },
] as const;

export function AgendaTabs({ current }: { current: "day" | "pk" }) {
  return (
    <nav className="dl-tabs" aria-label="Agenda views">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className="dl-tab"
          aria-current={t.key === current ? "page" : undefined}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

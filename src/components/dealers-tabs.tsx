// The two faces of Dealers (PK follow-up spec, 2026-11-02 §3): the overview
// board and the PK follow-up board. Two links under the page title, the
// current one filled in ink — the mockup's segment, with real addresses so a
// reader can bookmark either.

import Link from "next/link";

const TABS = [
  { key: "overview", href: "/dealers", label: "Overview" },
  { key: "pk", href: "/dealers/pk", label: "Action items" },
] as const;

export function DealersTabs({ current }: { current: "overview" | "pk" }) {
  return (
    <nav className="dl-tabs" aria-label="Dealers views">
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

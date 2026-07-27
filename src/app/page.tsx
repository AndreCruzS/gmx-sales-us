"use client";

// Home is operational, never a table dump (spec §9): quick actions first —
// Register Commercial Activity is the primary action (D45).

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useOffline } from "@/components/offline-provider";
import {
  AlertIcon,
  CalendarIcon,
  ChartIcon,
  FileIcon,
  MicrophoneIcon,
} from "@/components/icons";
import { getOfflineLayer, wipeLocalData, type CachedActivity } from "@/lib/offline";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

interface ExceptionRow {
  exception_type: string;
  subject_id: string;
  title: string | null;
  detail: string | null;
}

export default function HomePage() {
  const { profile, status } = useOffline();
  const router = useRouter();
  const [recent, setRecent] = useState<CachedActivity[]>([]);
  const [attention, setAttention] = useState<ExceptionRow[]>([]);

  useEffect(() => {
    if (!profile) return;
    void getOfflineLayer()
      .local.getRecentActivities()
      .then((a) => setRecent(a.slice(0, 5)));
    // re-read after every pull (lastPulledAt) and every queue change (pending)
  }, [profile, status.pending, status.lastPulledAt]);

  useEffect(() => {
    if (!profile) return;
    // Requires Attention (spec §3 home + §14): management by exception. The
    // security_invoker views scope this to the caller's RLS visibility.
    void getSupabaseBrowserClient()
      .from("exceptions")
      .select("exception_type, subject_id, title, detail")
      .order("since", { ascending: true })
      .limit(8)
      .then(({ data }) => setAttention((data as ExceptionRow[]) ?? []));
  }, [profile, status.lastPulledAt]);

  async function logout() {
    // D60: wipe the local cache before the session goes away.
    await wipeLocalData();
    await getSupabaseBrowserClient().auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const shortcuts = [
    { href: "/debriefs", label: "Voice debrief", Icon: MicrophoneIcon },
    { href: "/agenda", label: "Agenda", Icon: CalendarIcon },
    { href: "/dashboard", label: "Dashboard", Icon: ChartIcon },
    { href: "/weekly", label: "Weekly review", Icon: FileIcon },
  ];

  return (
    <div className="stack pt-2">
      <section>
        <Link href="/capture" className="btn-primary">
          Register activity
        </Link>
        <p className="t-meta mt-2 text-center">
          One note is enough — works with no signal.
        </p>

        <div className="mt-5 grid grid-cols-2 gap-2">
          {shortcuts.map(({ href, label, Icon }) => (
            <Link key={href} href={href} className="btn-secondary">
              <Icon size={17} style={{ color: "var(--ink-secondary)" }} />
              {label}
            </Link>
          ))}
        </div>
      </section>

      {attention.length > 0 && (
        <section>
          <div className="section-head">
            <h2 className="t-section">Requires attention</h2>
            <span className="tag tag-danger">{attention.length}</span>
          </div>
          <ul className="list">
            {attention.map((e) => (
              <li key={`${e.exception_type}-${e.subject_id}`} className="row">
                <span
                  className="row-lead"
                  style={{ background: "var(--danger-tint)" }}
                >
                  <AlertIcon size={18} style={{ color: "var(--danger)" }} />
                </span>
                <span className="row-body">
                  <span className="t-title block truncate">{e.title}</span>
                  <span className="t-sub block">
                    {e.exception_type.replaceAll("_", " ").toLowerCase()}
                    {e.detail ? ` — ${e.detail}` : ""}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <div className="section-head">
          <h2 className="t-section">Recent activity</h2>
          <Link href="/weekly" className="t-action">
            See week
          </Link>
        </div>
        {recent.length === 0 ? (
          <p className="t-sub px-1">
            Nothing yet. Your captures land here the moment you save them —
            online or not.
          </p>
        ) : (
          <ul className="list">
            {recent.map((a) => (
              <li key={a.id} className="row">
                {/* the lead slot carries the date — the kit's date-tag pattern,
                    but with information rather than decoration */}
                <span className="row-lead flex-col leading-none">
                  <span className="text-[15px] font-bold">
                    {new Date(a.occurred_at).getDate()}
                  </span>
                  <span className="text-[9px] font-semibold uppercase tracking-wide opacity-70">
                    {new Date(a.occurred_at).toLocaleString("en-US", {
                      month: "short",
                    })}
                  </span>
                </span>
                <span className="row-body">
                  <span className="flex items-center gap-2">
                    <span className="t-title truncate capitalize">
                      {a.activity_type.replaceAll("_", " ").toLowerCase()}
                    </span>
                    {a.pendingSync && (
                      <span className="tag tag-accent">to sync</span>
                    )}
                  </span>
                  {a.what_happened && (
                    <span className="t-sub line-clamp-2 block">
                      {a.what_happened}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {profile && (
        <section className="flex items-center justify-between">
          <span className="t-meta truncate">{profile.email}</span>
          <button onClick={logout} className="btn-quiet">
            Log out
          </button>
        </section>
      )}
    </div>
  );
}

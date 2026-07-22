"use client";

// Home is operational, never a table dump (spec §9): quick actions first —
// Register Commercial Activity is the primary action (D45).

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useOffline } from "@/components/offline-provider";
import { getOfflineLayer, wipeLocalData, type CachedActivity } from "@/lib/offline";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export default function HomePage() {
  const { profile, status } = useOffline();
  const router = useRouter();
  const [recent, setRecent] = useState<CachedActivity[]>([]);

  useEffect(() => {
    if (!profile) return;
    void getOfflineLayer()
      .local.getRecentActivities()
      .then((a) => setRecent(a.slice(0, 5)));
  }, [profile, status.pending]);

  async function logout() {
    // D60: wipe the local cache before the session goes away.
    await wipeLocalData();
    await getSupabaseBrowserClient().auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <Link
          href="/capture"
          className="rounded-2xl bg-amber-500 px-5 py-4 text-center text-lg font-semibold text-black shadow-sm active:scale-[0.99]"
        >
          + Register Commercial Activity
        </Link>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <Link
            href="/tray"
            className="rounded-xl border border-black/10 px-4 py-3 text-center font-medium dark:border-white/15"
          >
            Error tray{status.rejected > 0 ? ` (${status.rejected})` : ""}
          </Link>
          <button
            onClick={logout}
            className="rounded-xl border border-black/10 px-4 py-3 font-medium dark:border-white/15"
          >
            Log out
          </button>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide opacity-60">
          Recent activity
        </h2>
        {recent.length === 0 ? (
          <p className="text-sm opacity-60">
            Nothing yet — your captures appear here, online or offline.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {recent.map((a) => (
              <li
                key={a.id}
                className="rounded-xl border border-black/10 px-4 py-3 text-sm dark:border-white/15"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">
                    {a.activity_type.replaceAll("_", " ")}
                  </span>
                  {a.pendingSync && (
                    <span className="text-xs font-medium text-amber-600">
                      unsynced
                    </span>
                  )}
                </div>
                {a.what_happened && (
                  <p className="mt-1 line-clamp-2 opacity-70">{a.what_happened}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {profile && (
        <p className="text-center text-xs opacity-50">
          Signed in as {profile.email}
        </p>
      )}
    </div>
  );
}

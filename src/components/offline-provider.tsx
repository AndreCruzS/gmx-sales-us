"use client";

// Boots the offline layer once a session exists: resolves the rep's profile
// (org from the JWT claim, membership row for ownership), starts the D58 sync
// triggers, and exposes profile + sync status to the tree.

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { getOfflineLayer, type SyncStatus } from "@/lib/offline";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export interface Profile {
  userId: string;
  orgId: string;
  membershipId: string;
  email: string;
  // Needed to create accounts in the field (accounts.territory_id is NOT NULL);
  // null for managers/admins without a territory. Older cached profiles lack
  // the key — treat undefined as null.
  territoryId?: string | null;
  /**
   * What this person opens the app to do. RLS decides what they may SEE and
   * always will; this only decides which screen they land on, because a
   * manager reading a rep's day in the first person ("2 visits left this
   * week", with a Done button on someone else's stop) is the wrong screen
   * rather than the wrong permission. Older cached profiles lack the key.
   */
  role?: string | null;
}

interface OfflineContextValue {
  profile: Profile | null;
  status: SyncStatus;
  /**
   * True until the first attempt to resolve the profile has finished, however it
   * finished.
   *
   * `profile === null` was doing two jobs and could not do either well: "we are
   * still looking" and "there is nobody" are the same value, so a screen that
   * needs the role had to guess. Home guessed the rep's day, which meant every
   * manager watched somebody else's diary for a beat before their own team
   * replaced it.
   *
   * It goes false even when resolution FAILED — no session, no membership, no
   * signal and no cache. A flag that only clears on success is a spinner that
   * never stops.
   */
  resolving: boolean;
}

const OfflineContext = createContext<OfflineContextValue>({
  profile: null,
  status: { pending: 0, rejected: 0, syncing: false, lastPulledAt: null },
  resolving: true,
});

export function useOffline(): OfflineContextValue {
  return useContext(OfflineContext);
}

function orgIdFromAccessToken(token: string): string | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.org_id ?? null;
  } catch {
    return null;
  }
}

export function OfflineProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [resolving, setResolving] = useState(true);
  const [status, setStatus] = useState<SyncStatus>({
    pending: 0,
    rejected: 0,
    syncing: false,
    lastPulledAt: null,
  });

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let stopped = false;
    let booted = false;

    async function boot() {
      if (booted || stopped) return;
      const supabase = getSupabaseBrowserClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session || stopped) return;
      booted = true;

      const layer = getOfflineLayer();
      let resolved: Profile | null = null;

      const orgId = orgIdFromAccessToken(session.access_token);
      if (orgId) {
        const { data: membership } = await supabase
          .from("memberships")
          .select("id, territory_id, role")
          .eq("user_id", session.user.id)
          .eq("org_id", orgId)
          .eq("status", "active")
          .single();
        if (membership) {
          resolved = {
            userId: session.user.id,
            orgId,
            membershipId: membership.id,
            email: session.user.email ?? "",
            territoryId: membership.territory_id ?? null,
            role: membership.role ?? null,
          };
          // Cache for offline cold starts — the profile is part of the D56
          // working set: capture must work with no network at all.
          await layer.local.setMeta("profile", JSON.stringify(resolved));
        }
      }

      if (!resolved) {
        // Offline (or transient failure): fall back to the cached profile so
        // an airplane-mode cold start can still capture. The cache was wiped
        // on logout/org switch (D60), so it can only belong to this session's
        // tenant boundary.
        const cached = await layer.local.getMeta("profile");
        if (cached) {
          const parsed = JSON.parse(cached) as Profile;
          if (parsed.userId === session.user.id) resolved = parsed;
        }
      }

      if (!resolved || stopped) return;
      setProfile(resolved);
      unsubscribe = layer.sync.subscribe(setStatus);
      layer.sync.start();
    }

    // Every path out of boot() has to report that it finished, including the
    // ones that failed: no session, no membership, no signal and no cache. A
    // resolving flag that only clears on success is a spinner with no way out.
    const settle = () => {
      if (!stopped) setResolving(false);
    };

    // Boot when a session exists now, AND when one appears later — the
    // provider mounts on the login page before sign-in, and client-side
    // navigation never remounts it.
    void boot().finally(settle);
    const supabase = getSupabaseBrowserClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        // Back into the loading state only when boot has not already run. On the
        // login page the first attempt settled with no session, so signing in has
        // to reopen it; a TOKEN_REFRESHED for somebody already working must not,
        // or their screen would blink back to a skeleton for no reason.
        if (!booted && !stopped) setResolving(true);
        void boot().finally(settle);
      }
      if (event === "SIGNED_OUT") {
        booted = false;
        setProfile(null);
      }
    });

    return () => {
      stopped = true;
      subscription.unsubscribe();
      unsubscribe?.();
    };
  }, []);

  return (
    <OfflineContext.Provider value={{ profile, status, resolving }}>
      {children}
    </OfflineContext.Provider>
  );
}

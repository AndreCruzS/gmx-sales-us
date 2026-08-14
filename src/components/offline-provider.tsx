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
}

const OfflineContext = createContext<OfflineContextValue>({
  profile: null,
  status: { pending: 0, rejected: 0, syncing: false, lastPulledAt: null },
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

    // Boot when a session exists now, AND when one appears later — the
    // provider mounts on the login page before sign-in, and client-side
    // navigation never remounts it.
    void boot();
    const supabase = getSupabaseBrowserClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") void boot();
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
    <OfflineContext.Provider value={{ profile, status }}>
      {children}
    </OfflineContext.Provider>
  );
}

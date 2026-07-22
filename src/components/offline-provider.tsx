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

    async function boot() {
      const supabase = getSupabaseBrowserClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session || stopped) return;

      const orgId = orgIdFromAccessToken(session.access_token);
      if (!orgId) return; // no active membership — nothing to sync

      const { data: membership } = await supabase
        .from("memberships")
        .select("id")
        .eq("user_id", session.user.id)
        .eq("org_id", orgId)
        .eq("status", "active")
        .single();
      if (!membership || stopped) return;

      setProfile({
        userId: session.user.id,
        orgId,
        membershipId: membership.id,
        email: session.user.email ?? "",
      });

      const layer = getOfflineLayer();
      unsubscribe = layer.sync.subscribe(setStatus);
      layer.sync.start();
    }

    void boot();
    return () => {
      stopped = true;
      unsubscribe?.();
    };
  }, []);

  return (
    <OfflineContext.Provider value={{ profile, status }}>
      {children}
    </OfflineContext.Provider>
  );
}

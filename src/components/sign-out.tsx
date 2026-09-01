"use client";

// The way OUT — one button, same everywhere it appears.
//
// D60 order matters: the local cache is wiped BEFORE the session goes away,
// so a shared or handed-back device never carries the last rep's book into
// the next person's login. The Agenda page had this buried in its own code;
// pulled here the day the shell grew a visible door (Andre, 2026-09-01).

import { useRouter } from "next/navigation";
import { useState } from "react";
import { wipeLocalData } from "@/lib/offline";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { LogOutIcon } from "./icons";

export function SignOutButton({ className }: { className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    try {
      await wipeLocalData();
      await getSupabaseBrowserClient().auth.signOut();
      router.push("/login");
      router.refresh();
    } catch {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      className={className ?? "navbar-icon"}
      aria-label="Sign out"
      title="Sign out"
      disabled={busy}
      onClick={() => void logout()}
    >
      <LogOutIcon size={19} />
    </button>
  );
}

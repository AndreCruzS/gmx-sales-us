"use client";

// Which home. RLS decides what a person may SEE and always will; this only
// decides which screen they land on, because a manager reading a rep's day in
// the first person — a route they do not walk, "2 visits left this week"
// counted across other people's diaries, a Done button on someone else's stop
// — is the wrong screen rather than the wrong permission.
//
// Reps and support keep the day. Managers and admins get the team.

import { useOffline } from "@/components/offline-provider";
import { manages } from "@/lib/domain/roles";
import HomeClient from "./home-client";
import { ManagerHome } from "./manager-home";

/** "bianca@gmxgroup.com" → "Bianca". The cache never holds a display name. */
function nameFromEmail(email: string): string {
  const local = email.split("@")[0]?.split(/[._-]/)[0] ?? "";
  return local ? local.charAt(0).toUpperCase() + local.slice(1) : "";
}

export function HomeSwitch() {
  const { profile } = useOffline();

  // Until the profile resolves, the rep day is the safe default: it is the one
  // that works with no signal at all (D56), and capture must never wait on a
  // role lookup.
  if (profile && manages(profile.role)) {
    return <ManagerHome name={nameFromEmail(profile.email)} />;
  }
  return <HomeClient />;
}

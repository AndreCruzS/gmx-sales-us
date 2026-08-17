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
import { HomeBootSkeleton } from "./home-skeleton";
import { ManagerHome } from "./manager-home";

/** "bianca@gmxgroup.com" → "Bianca". The cache never holds a display name. */
function nameFromEmail(email: string): string {
  const local = email.split("@")[0]?.split(/[._-]/)[0] ?? "";
  return local ? local.charAt(0).toUpperCase() + local.slice(1) : "";
}

export function HomeSwitch() {
  const { profile, resolving } = useOffline();

  // WAIT RATHER THAN GUESS. This used to default to the rep's day while the
  // profile resolved, on the reasoning that the rep day works with no signal at
  // all (D56) and capture must never wait on a role lookup. The reasoning was
  // sound and the conclusion was wrong: a manager watched somebody else's diary —
  // a route they do not walk, visits counted across other people's weeks — for a
  // beat before their own team replaced it.
  //
  // Capture is not what waits here. The + button lives in the nav bar, outside
  // this tree, so it is on screen and working throughout. What waits is the
  // ANSWER, and the answer is worth the fraction of a second it takes to know
  // whose it is. `resolving` clears even when resolution failed, so this can
  // never be the last thing anybody sees.
  if (resolving && !profile) return <HomeBootSkeleton />;

  if (profile && manages(profile.role)) {
    return <ManagerHome name={nameFromEmail(profile.email)} />;
  }
  return <HomeClient />;
}

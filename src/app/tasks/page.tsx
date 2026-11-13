"use client";

// TASKS — its own place in the desk's bar (Andre, 2026-11-13: SALES | TASKS |
// DEALERS | REPS | ACCOUNTS). Every task the team owes, wherever it was born:
// a PK's follow-ups in the PK's band, every other task in its dealer's band,
// on the same board with the same drawer (pk-follow-up-view.tsx). It used to
// be Dealers' second tab at /dealers/pk, which now sends here. A rep reads
// his own at /visits/pk, under the Agenda, so one who lands here is sent there.

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useOffline } from "@/components/offline-provider";
import { PkFollowUpView } from "@/components/pk-follow-up-view";
import { seesDealersBoard } from "@/lib/domain/roles";

export default function TasksPage() {
  const { profile } = useOffline();
  const router = useRouter();
  const desk = !profile || seesDealersBoard(profile.role);
  useEffect(() => {
    if (!desk) router.replace("/visits/pk");
  }, [desk, router]);
  if (!desk) return null;
  return (
    <PkFollowUpView
      title={<h1 className="text-[28px] font-extrabold leading-tight tracking-tight">Tasks</h1>}
    />
  );
}

"use client";

// PK FOLLOW-UP — the second face of Dealers, for the desk (spec 2026-11-02).
// The board lives in pk-follow-up-view.tsx; a rep reaches the same board from
// his Agenda at /visits/pk (spec 2026-11-03), so one who lands here is sent there.

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { DealersTabs } from "@/components/dealers-tabs";
import { useOffline } from "@/components/offline-provider";
import { PkFollowUpView } from "@/components/pk-follow-up-view";
import { seesDealersBoard } from "@/lib/domain/roles";

export default function PkFollowUpPage() {
  const { profile } = useOffline();
  const router = useRouter();
  const desk = !profile || seesDealersBoard(profile.role);
  useEffect(() => {
    if (!desk) router.replace("/visits/pk");
  }, [desk, router]);
  if (!desk) return null;
  return (
    <PkFollowUpView
      title={
        <>
          <h1 className="text-[28px] font-extrabold leading-tight tracking-tight">Dealers</h1>
          <DealersTabs current="pk" />
        </>
      }
    />
  );
}

"use client";

// PK FOLLOW-UP from the Agenda (spec 2026-11-03): the rep's own PKs, in full,
// and the band of any item handed to him. The same board the desk reads at
// /dealers/pk; RLS decides what is on it.

import { AgendaTabs } from "@/components/agenda-tabs";
import { PkFollowUpView } from "@/components/pk-follow-up-view";

export default function AgendaPkPage() {
  return (
    <PkFollowUpView
      title={
        <>
          <h1 className="text-[28px] font-extrabold leading-tight tracking-tight">Agenda</h1>
          <AgendaTabs current="pk" />
        </>
      }
    />
  );
}

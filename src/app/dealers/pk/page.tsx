"use client";

// The board moved out of Dealers to its own tab, Tasks (Andre, 2026-11-13).
// Old links and bookmarks land here; the ?item= deep link rides along.

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";

function ToTasks() {
  const router = useRouter();
  const params = useSearchParams();
  useEffect(() => {
    const q = params.toString();
    router.replace(q ? `/tasks?${q}` : "/tasks");
  }, [router, params]);
  return null;
}

export default function OldPkFollowUpPage() {
  return (
    <Suspense fallback={null}>
      <ToTasks />
    </Suspense>
  );
}

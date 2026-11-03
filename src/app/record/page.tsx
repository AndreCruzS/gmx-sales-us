"use client";

// LOG A VISIT IS SAY IT NOW (spec 2026-11-04-one-mic-design.md §3.4). Say it
// logs what happened as well as booking what is next, offline included, and
// the business-card snap moved there with it. This route stays only so old
// links, bookmarks and the PWA's history still land — with their context:
// ?visit=<id> or ?item=<id> (a planned visit) and ?account=<id>.

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { sayHref } from "@/lib/voice/say-href";

function Redirect() {
  const router = useRouter();
  const params = useSearchParams();
  useEffect(() => {
    router.replace(sayHref(new URLSearchParams(params.toString())));
  }, [router, params]);
  return null;
}

export default function RecordPage() {
  return (
    <Suspense fallback={null}>
      <Redirect />
    </Suspense>
  );
}

"use client";

import { useEffect } from "react";

// The service worker exists to keep the shell loadable in a dead-signal back
// room (D3/D58). In development it does the opposite: it serves a cached shell
// against freshly-built CSS, so the page renders with a stale stylesheet and
// looks broken. Register in production only, and actively unregister anything
// a previous dev session left behind.
export function SwRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    if (process.env.NODE_ENV !== "production") {
      void navigator.serviceWorker
        .getRegistrations()
        .then((regs) => regs.forEach((r) => void r.unregister()));
      void caches
        ?.keys()
        .then((keys) =>
          keys.filter((k) => k.startsWith("cos-")).forEach((k) => void caches.delete(k)),
        );
      return;
    }

    void navigator.serviceWorker.register("/sw.js");
  }, []);

  return null;
}

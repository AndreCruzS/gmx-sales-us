// PushChannel (D55): Web Push works only on installed PWAs (iOS 16.4+), so
// push is an ENHANCEMENT — Workspace mail remains the guaranteed alert
// channel (D25). This stub holds the interface seam; real subscription
// plumbing arrives with the exception engine (Phase 3+).

import type { PushChannel } from "./types";

export class WebPushChannel implements PushChannel {
  async requestPermission(): Promise<"granted" | "denied" | "unsupported"> {
    if (typeof Notification === "undefined") return "unsupported";
    const result = await Notification.requestPermission();
    return result === "granted" ? "granted" : "denied";
  }

  async subscribe(): Promise<PushSubscription | null> {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return null;
    }
    const reg = await navigator.serviceWorker.ready;
    return reg.pushManager.getSubscription();
  }
}

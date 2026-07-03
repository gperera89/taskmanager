"use client";

import { useEffect, useState } from "react";

type Status = "checking" | "unsupported" | "needs-install" | "off" | "denied" | "on" | "error";

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

// VAPID public keys are base64url; PushManager.subscribe wants a raw Uint8Array.
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base64Safe = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64Safe);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

// Everything here is knowable synchronously except whether a subscription already exists,
// which needs an async service worker registration — that part alone belongs in an effect.
function computeInitialStatus(): Status {
  if (typeof window === "undefined") return "checking";
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return "unsupported";
  if (isIos() && !isStandalone()) return "needs-install";
  if (Notification.permission === "denied") return "denied";
  return "checking";
}

export default function NotificationSetup() {
  const [status, setStatus] = useState<Status>(computeInitialStatus);

  useEffect(() => {
    if (status !== "checking") return;
    navigator.serviceWorker.register("/sw.js").then(async (registration) => {
      const existing = await registration.pushManager.getSubscription();
      setStatus(existing ? "on" : "off");
    });
  }, [status]);

  async function enable() {
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus("denied");
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!) as BufferSource,
      });
      const res = await fetch("/api/push/subscribe", { method: "POST", body: JSON.stringify(subscription) });
      if (!res.ok) throw new Error("Failed to save subscription");
      setStatus("on");
    } catch (err) {
      console.error("[notifications] enable failed:", err);
      setStatus("error");
    }
  }

  async function disable() {
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await fetch("/api/push/subscribe", { method: "DELETE", body: JSON.stringify({ endpoint: subscription.endpoint }) });
        await subscription.unsubscribe();
      }
      setStatus("off");
    } catch (err) {
      console.error("[notifications] disable failed:", err);
      setStatus("error");
    }
  }

  if (status === "checking") return null;

  return (
    <div className="rounded-lg border border-[#d3c9b3] bg-white p-2.5 text-sm text-[#2a2622]">
      {status === "unsupported" && <p className="text-[#8a8069]">This browser doesn&apos;t support push notifications.</p>}
      {status === "needs-install" && (
        <p className="text-[#8a8069]">
          On iPhone, notifications only work once this app is added to your home screen. Tap the Share button in
          Safari, then &ldquo;Add to Home Screen,&rdquo; and reopen it from there.
        </p>
      )}
      {status === "denied" && (
        <p className="text-[#8a4040]">
          Notifications are blocked for this site. Enable them in your browser&apos;s site settings to turn this on.
        </p>
      )}
      {(status === "off" || status === "error") && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-[#8a8069]">Get a notification when a task or project comes due.</span>
          <button
            type="button"
            onClick={enable}
            className="cursor-pointer whitespace-nowrap rounded-md bg-[#17399b] px-2.5 py-1 text-xs text-white"
          >
            Enable
          </button>
        </div>
      )}
      {status === "on" && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-[#557694]">Notifications are on for this device.</span>
          <button type="button" onClick={disable} className="cursor-pointer text-xs text-[#b3a988] hover:text-[#8a4040]">
            Turn off
          </button>
        </div>
      )}
    </div>
  );
}

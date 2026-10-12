"use client";

import { getPushPublicKey, removePushSubscription, savePushSubscription } from "@/app/actions";

// Client side of Web Push: subscribing this device and keeping its subscription alive.
//
// iOS only offers Web Push to an app added to the Home Screen, never to a Safari tab, and it
// revokes subscriptions now and then without telling anyone. So the device re-registers itself
// on start (at most once a day) — the server answers "dead" if a reminder already bounced off this
// exact subscription, and the device then swaps it for a fresh one. Between those checks the
// server falls back to ntfy (lib/notifications.ts), so a revoked subscription never loses a
// reminder.

export type PushState =
  | "unsupported" // no Web Push here (e.g. iPhone Safari outside the Home Screen app)
  | "unavailable" // the server has no VAPID keys configured
  | "off" // supported, permission not asked yet
  | "blocked" // permission denied — only the OS/browser settings can undo that
  | "on";

const SYNC_KEY = "cura-push-synced";
const SYNC_EVERY_MS = 24 * 60 * 60 * 1000;

export function pushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

// Installed to the Home Screen / Dock, as opposed to a browser tab.
export function isStandalone(): boolean {
  return (
    typeof window !== "undefined" &&
    (window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true)
  );
}

export async function getPushState(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  if (Notification.permission === "default") return "off";
  const reg = await navigator.serviceWorker.ready;
  return (await reg.pushManager.getSubscription()) ? "on" : "off";
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = (value + "=".repeat((4 - (value.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function toRecord(sub: PushSubscription): { endpoint: string; p256dh: string; auth: string } {
  const json = sub.toJSON();
  return { endpoint: sub.endpoint, p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" };
}

// Make sure this device holds a live subscription and the server knows it. Assumes permission is
// already granted. Returns false when the server can't take subscriptions (no VAPID keys).
async function ensureSubscribed(): Promise<boolean> {
  const key = await getPushPublicKey();
  if (!key) return false;
  const reg = await navigator.serviceWorker.ready;
  const subscribe = () => reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(key) });

  let sub = (await reg.pushManager.getSubscription()) ?? (await subscribe());
  if ((await savePushSubscription(toRecord(sub))) === "dead") {
    await sub.unsubscribe().catch(() => {});
    sub = await subscribe();
    await savePushSubscription(toRecord(sub));
  }
  try {
    localStorage.setItem(SYNC_KEY, String(Date.now()));
  } catch {
    // Private mode etc. — just means the next start re-checks.
  }
  return true;
}

// From a tap (iOS only shows the permission prompt in response to one).
export async function enablePush(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  const permission = await Notification.requestPermission();
  if (permission === "denied") return "blocked";
  if (permission !== "granted") return "off";
  return (await ensureSubscribed()) ? "on" : "unavailable";
}

export async function disablePush(): Promise<void> {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  await removePushSubscription(sub.endpoint).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}

// On start, and when the service worker reports the browser rotated the subscription. Silent:
// never prompts, and does nothing until permission has been granted from Settings or the banner.
export async function syncPush({ force = false }: { force?: boolean } = {}): Promise<void> {
  if (!pushSupported() || Notification.permission !== "granted") return;
  if (!force) {
    let last = 0;
    try {
      last = Number(localStorage.getItem(SYNC_KEY) ?? 0);
    } catch {
      // Unreadable storage — treat as never synced.
    }
    if (Date.now() - last < SYNC_EVERY_MS) return;
  }
  try {
    await ensureSubscribed();
  } catch (err) {
    console.error("[push] re-registering this device failed:", err);
  }
}

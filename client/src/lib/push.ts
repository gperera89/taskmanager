import "server-only";
import webpush, { WebPushError } from "web-push";
import { getLivePushSubscriptions, markPushSubscriptionFailed } from "@/lib/api";

// Web Push: Cura's own notifications, shown by the installed app itself (see the push handler in
// public/sw.js) rather than by the ntfy app. Configure with:
//   NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY  (one pair, from
//       `npx web-push generate-vapid-keys`; rotating it invalidates every device's subscription.
//       The public key is handed to devices through a server action, so despite the
//       NEXT_PUBLIC_ prefix — kept from the original Web Push setup — nothing reads it at build time)
//   VAPID_SUBJECT  (the contact push services ask for: a mailto: or https: URL; APP_URL if unset)
// Without the keys this channel is simply off and every reminder goes to ntfy, as before.

export type WebPushMessage = {
  title: string;
  body: string;
  url: string;
  tag?: string;
  // Buttons where the platform supports them (Chrome, Android). iOS and Safari ignore them —
  // there, tapping opens `url`, which deep-links to the item (see ReminderSheet).
  actions?: { label: string; path: string }[];
};

export function webPushPublicKey(): string | null {
  return process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || null;
}

function configured(): boolean {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || process.env.APP_URL || "https://www.cura-gp.app", publicKey, privateKey);
  return true;
}

// Sends to every live device and resolves with how many push services accepted the message. Zero
// means nobody got it — no devices, keys unset, or every subscription dead — and the caller falls
// back to ntfy. Accepted is not the same as shown, but a subscription iOS has revoked is rejected
// here (404/410), which is exactly the failure the fallback exists for.
export async function sendWebPush(message: WebPushMessage): Promise<number> {
  if (!configured()) return 0;
  const subs = await getLivePushSubscriptions();
  if (subs.length === 0) return 0;

  const payload = JSON.stringify({
    title: message.title,
    body: message.body,
    url: message.url,
    tag: message.tag,
    // The service worker posts these back to /api/notify-action with the session cookie.
    actions: (message.actions ?? []).map((a, i) => ({ action: `a${i}`, title: a.label, path: a.path })),
  });

  const results = await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, {
          // A reminder that can't be delivered within a few hours is no longer worth showing.
          TTL: 4 * 60 * 60,
          urgency: "high",
          topic: message.tag?.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) || undefined,
        });
        return true;
      } catch (err) {
        if (err instanceof WebPushError && (err.statusCode === 404 || err.statusCode === 410)) {
          await markPushSubscriptionFailed(sub.endpoint);
        } else {
          console.error("[push] send failed:", err);
        }
        return false;
      }
    })
  );
  return results.filter(Boolean).length;
}

"use client";

import { useTaskbook } from "./store";

// The notification cron should run about once a minute; if nothing has stamped the heartbeat
// in this long, the external scheduler has almost certainly lapsed.
const CRON_STALE_MS = 10 * 60 * 1000;

// Slim, non-blocking banners under the header: offline/pending-sync state, and a warning when
// the notification cron's heartbeat goes stale (a lapsed scheduler otherwise fails silently).
export default function StatusBanners() {
  const { offline, pendingOps, data, nowMs } = useTaskbook();

  // Escape hatch for a device stuck on a stale cached shell: drop the service worker and every
  // cache, then hard-reload. Queued edits live in IndexedDB, which this deliberately leaves alone.
  async function resetAppCache() {
    try {
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
      if ("caches" in window) {
        const names = await caches.keys();
        await Promise.all(names.map((n) => caches.delete(n)));
      }
    } finally {
      window.location.reload();
    }
  }

  const cronStale = data.lastCronAtMs === null || nowMs - data.lastCronAtMs > CRON_STALE_MS;
  const showSync = offline || pendingOps > 0;
  if (!showSync && !cronStale) return null;

  return (
    <div className="flex flex-none flex-col">
      {showSync && (
        <div className="border-b border-(--border-strong) bg-(--surface-active) px-6 py-1.5 text-center text-xs text-(--ink-muted)">
          {offline
            ? pendingOps > 0
              ? `Offline — ${pendingOps} change${pendingOps === 1 ? "" : "s"} will sync when you reconnect.`
              : "Offline — changes will sync when you reconnect."
            : `Syncing ${pendingOps} change${pendingOps === 1 ? "" : "s"}…`}
          {offline && (
            <button
              type="button"
              onClick={() => void resetAppCache()}
              className="ml-2 cursor-pointer underline decoration-dotted underline-offset-2"
            >
              Reset &amp; reload
            </button>
          )}
        </div>
      )}
      {cronStale && (
        <div className="border-b border-(--border-strong) bg-(--danger-surface) px-6 py-1.5 text-center text-xs text-(--danger)">
          {data.lastCronAtMs === null
            ? "Reminders may not be set up — the notification checker has never run."
            : `Reminders may not be firing — the notification checker last ran ${Math.round((nowMs - data.lastCronAtMs) / 60000)} min ago.`}
        </div>
      )}
    </div>
  );
}

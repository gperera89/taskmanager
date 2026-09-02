"use client";

import { useEffect, useState } from "react";
import { useTaskbook } from "./store";

// The notification cron should run about once a minute; if nothing has stamped the heartbeat
// in this long, the external scheduler has almost certainly lapsed.
const CRON_STALE_MS = 10 * 60 * 1000;

// A write normally lands in a couple of hundred milliseconds. Announcing that is pure noise —
// a bar that appears and vanishes between two blinks — so "Syncing…" waits this long before it
// says anything, and most ticks never show it at all. Going offline is a sustained state, so
// that half shows immediately.
const SYNC_NOTICE_DELAY_MS = 700;

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

  const syncing = !offline && pendingOps > 0;
  const [syncNoticeDue, setSyncNoticeDue] = useState(false);
  useEffect(() => {
    if (!syncing) return;
    const timer = window.setTimeout(() => setSyncNoticeDue(true), SYNC_NOTICE_DELAY_MS);
    // Cleanup runs the moment the sync finishes, so the notice is armed again from scratch for
    // the next one rather than flashing up instantly on the following tick.
    return () => {
      window.clearTimeout(timer);
      setSyncNoticeDue(false);
    };
  }, [syncing]);

  const cronStale = data.lastCronAtMs === null || nowMs - data.lastCronAtMs > CRON_STALE_MS;
  const showSync = offline || (syncing && syncNoticeDue);
  if (!showSync && !cronStale) return null;

  return (
    <div className="relative flex flex-none flex-col">
      {cronStale && (
        <div className="border-b border-(--border-strong) bg-(--danger-surface) px-6 py-1.5 text-center text-xs text-(--danger)">
          {data.lastCronAtMs === null
            ? "Reminders may not be set up — the notification checker has never run."
            : `Reminders may not be firing — the notification checker last ran ${Math.round((nowMs - data.lastCronAtMs) / 60000)} min ago.`}
        </div>
      )}
      {/* The sync notice floats over the top of the content instead of sitting in the column:
          it comes and goes on its own schedule, and taking a row of layout each time pushed every
          list down and then back up again — the rows moving for a reason that has nothing to do
          with what the user just did. A zero-height, overflow-visible slot keeps it in exactly
          the place it used to occupy while costing the page no height at all. */}
      {showSync && (
        <div className="pointer-events-none relative z-20 h-0 overflow-visible">
          <div className="pointer-events-auto absolute inset-x-0 top-0 border-b border-(--border-strong) bg-(--surface-active) px-6 py-1.5 text-center text-xs text-(--ink-muted) shadow-[0_4px_12px_rgba(42,38,34,.12)] motion-safe:animate-[status-fade-in_160ms_ease-out]">
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
        </div>
      )}
    </div>
  );
}

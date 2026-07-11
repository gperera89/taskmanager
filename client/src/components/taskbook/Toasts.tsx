"use client";

import { useTaskbook } from "./store";

// Bottom-center toast stack: write-failure notices and undoable-delete prompts from the store.
export default function Toasts() {
  const { toasts, dismissToast } = useTaskbook();
  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex flex-col items-center gap-2 px-4">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto flex items-center gap-3 rounded-full border border-(--border) bg-(--toast-bg) px-4 py-2 text-[13px] text-(--toast-ink) shadow-[0_8px_24px_rgba(42,38,34,.35)]"
        >
          <span>{t.message}</span>
          {t.actionLabel && (
            <button
              type="button"
              onClick={() => {
                t.onAction?.();
                dismissToast(t.id);
              }}
              className="cursor-pointer font-semibold text-(--toast-action) underline decoration-dotted underline-offset-2"
            >
              {t.actionLabel}
            </button>
          )}
          <button type="button" onClick={() => dismissToast(t.id)} aria-label="Dismiss" className="cursor-pointer text-(--ink-faint)">
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

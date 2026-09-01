"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";

// Shared motion vocabulary for the lists. Everything the user sees move uses these, so the whole
// app reads as one piece rather than each view inventing its own timing.
//
// The problem this solves: every list in the app re-sorts itself the moment you tick something —
// a completed task leaves its group, a ticked routine sinks to the bottom, a project's counts
// re-rank it — and the rows below used to teleport into the gap. The data is right, but the eye
// loses its place, so the app feels jumpy even though nothing is wrong.

/** Long enough to be followed, short enough not to be waited on. */
export const MOVE_MS = 260;
/** Rows arriving (a section unfolding, a new row) come in slightly quicker than things reshuffle. */
export const ENTER_MS = 200;
/** The fade a row plays on its way out, before it's actually removed from the list. */
export const EXIT_MS = 180;
/** Decelerating — fast off the mark, settling gently, so a move telegraphs where it's going. */
export const EASE = "cubic-bezier(.2,.7,.3,1)";
/** A row that has to cross more than this starts its glide from here instead of its true old
    position. Filtering a long list can move a row hundreds of pixels, and animating the whole
    distance in MOVE_MS is a blur flying across the page — worse than the jump it replaced. The
    clamp keeps the direction legible and the speed constant-ish however far the row actually
    travelled. */
export const MAX_TRAVEL_PX = 320;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The style a row wears while it's fading out (see useCompletionHold's `isLeaving`). */
export const leavingStyle: React.CSSProperties = {
  opacity: 0,
  transition: `opacity ${EXIT_MS}ms ease-out`,
  pointerEvents: "none",
};

/**
 * A list whose rows glide between positions instead of teleporting (FLIP: measure where each row
 * *was*, let React lay it out where it now goes, then play the difference backwards).
 *
 * Mark each row with `data-flip-id="<stable id>"`. Only rows whose nearest enclosing list is this
 * one are animated, so a list nested inside a row (a project card's tasks inside the projects
 * list) is driven by its own AnimatedList and never double-animated by the outer one.
 *
 * Rows appearing for the first time fade in — except on the very first render, where every row
 * would qualify and the whole page would flutter on load.
 */
export function AnimatedList({
  children,
  className,
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const previous = useRef<Map<string, { x: number; y: number }>>(new Map());
  const running = useRef<Map<string, Animation>>(new Map());
  const isFirstRender = useRef(true);

  // No dependency array on purpose: the list has to re-measure after *every* commit, since the
  // thing that moved a row (a store mutation, a filter, a search keystroke) is never local state
  // this component could depend on.
  useLayoutEffect(() => {
    const container = ref.current;
    if (!container) return;

    const first = isFirstRender.current;
    isFirstRender.current = false;
    if (prefersReducedMotion()) return;

    const rows = Array.from(container.querySelectorAll<HTMLElement>("[data-flip-id]")).filter(
      (row) => row.closest("[data-flip-list]") === container
    );

    // Positions are measured *relative to this list*, not the viewport, so a list nested inside
    // an animating row (a project card's tasks while the card itself is sliding) sees only its
    // own movement — the ancestor's transform shifts row and container alike and cancels out.
    const origin = container.getBoundingClientRect();

    const measured = new Map<string, { x: number; y: number }>();
    for (const row of rows) {
      const id = row.dataset.flipId;
      if (!id) continue;

      // Cancel any in-flight move before measuring — a running transform would otherwise be baked
      // into the rect and every subsequent frame would drift further from the real layout.
      running.current.get(id)?.cancel();
      running.current.delete(id);

      const box = row.getBoundingClientRect();
      const to = { x: box.left - origin.left, y: box.top - origin.top };
      measured.set(id, to);
      if (first) continue;

      const from = previous.current.get(id);
      if (!from) {
        row.animate(
          [
            { opacity: 0, transform: "translateY(-6px)" },
            { opacity: 1, transform: "none" },
          ],
          { duration: ENTER_MS, easing: EASE }
        );
        continue;
      }

      const rawX = from.x - to.x;
      const rawY = from.y - to.y;
      // Sub-pixel shifts (a re-render nudging a row by rounding) aren't worth an animation and
      // just churn the compositor.
      if (Math.abs(rawX) < 2 && Math.abs(rawY) < 2) continue;

      const distance = Math.hypot(rawX, rawY);
      const scale = distance > MAX_TRAVEL_PX ? MAX_TRAVEL_PX / distance : 1;
      const dx = rawX * scale;
      const dy = rawY * scale;

      const animation = row.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], {
        duration: MOVE_MS,
        easing: EASE,
      });
      running.current.set(id, animation);
      animation.finished.then(() => {
        if (running.current.get(id) === animation) running.current.delete(id);
      }, () => {});
    }

    previous.current = measured;
  });

  return (
    <div ref={ref} data-flip-list className={className} style={style}>
      {children}
    </div>
  );
}

/**
 * Keeps a just-completed row in place for a beat after the underlying data says it no longer
 * belongs there, so the tick and strike-through actually play where the user is looking. The row
 * then fades (`isLeaving`) before it's dropped, and AnimatedList closes the gap behind it.
 */
const STRIKE_MS = 460;

export function useCompletionHold() {
  const [held, setHeld] = useState<Map<string, "holding" | "leaving">>(new Map());

  const hold = useCallback((id: string) => {
    setHeld((prev) => new Map(prev).set(id, "holding"));
    window.setTimeout(() => {
      setHeld((prev) => (prev.has(id) ? new Map(prev).set(id, "leaving") : prev));
    }, STRIKE_MS);
    window.setTimeout(() => {
      setHeld((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
    }, STRIKE_MS + EXIT_MS);
  }, []);

  return {
    isHeld: (id: string) => held.has(id),
    isLeaving: (id: string) => held.get(id) === "leaving",
    hold,
  };
}

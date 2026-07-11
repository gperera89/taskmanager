"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { ICON_PATH } from "./ModeToggle";

const AUTO_GROW_MAX_LINES = 3;

function resizeAutoGrowTextarea(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  const styles = window.getComputedStyle(el);
  const lineHeight = parseFloat(styles.lineHeight) || 16;
  const verticalExtra =
    parseFloat(styles.paddingTop) +
    parseFloat(styles.paddingBottom) +
    parseFloat(styles.borderTopWidth) +
    parseFloat(styles.borderBottomWidth);
  const maxHeight = lineHeight * AUTO_GROW_MAX_LINES + verticalExtra;
  el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
}

/** A textarea that grows with its content (controlled or uncontrolled) up to
    AUTO_GROW_MAX_LINES lines, then scrolls instead of growing further. */
export function AutoGrowTextarea({
  onInput,
  value,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    if (ref.current) resizeAutoGrowTextarea(ref.current);
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      onInput={(e) => {
        resizeAutoGrowTextarea(e.currentTarget);
        onInput?.(e);
      }}
      {...props}
    />
  );
}

export function Chip({ children, variant = "default" }: { children: React.ReactNode; variant?: "default" | "project" }) {
  const style =
    variant === "project"
      ? { color: "var(--ink-muted)", background: "var(--muted-wash)" }
      : { color: "var(--info)", background: "var(--info-wash)" };
  return (
    <span className="whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11.5px]" style={style}>
      {children}
    </span>
  );
}

export function CheckSquare({
  action,
  checked,
  size = 22,
  completing = false,
}: {
  action: () => void;
  checked: boolean;
  size?: number;
  /** Mid-flight on the transition to checked — plays the pen-drawn tick animation. */
  completing?: boolean;
}) {
  const showTick = checked || completing;
  return (
    <button
      type="button"
      onClick={action}
      aria-label={checked ? "Mark incomplete" : "Mark complete"}
      className="flex flex-none cursor-pointer items-center justify-center rounded"
      style={{
        width: size,
        height: size,
        border: `1.5px solid ${showTick ? "var(--accent-text)" : "var(--ink-faint)"}`,
        background: showTick ? "var(--accent-wash)" : "transparent",
        transition: "border-color .15s, background .15s",
      }}
    >
      {showTick && (
        <svg width={size * 0.64} height={size * 0.64} viewBox="0 0 24 24" fill="none">
          <path
            d="M4 13.5 L9.5 18.5 L20 5.5"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              stroke: "var(--accent-text)",
              ...(completing ? { strokeDasharray: 26, strokeDashoffset: 26, animation: "check-draw .32s ease-out forwards" } : undefined),
            }}
          />
        </svg>
      )}
    </button>
  );
}

/** Cobalt line that sweeps left-to-right over a title as it's checked off, ahead of the row
    settling into its static (muted, native line-through) completed style. Pinned to the top
    line's vertical center (rather than centered on the whole, possibly-wrapped block) so a
    multi-line title gets a clean strike through its first line instead of a mid-block underline —
    titles use a fixed 22px (leading-5.5) line-height so this offset lines up everywhere. */
export function StrikeSweep() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute left-0 top-2.5 h-[1.5px] w-full origin-left bg-(--accent)"
      style={{ animation: "strike-draw .36s .08s ease-out both" }}
    />
  );
}

/** A checkbox + title, sharing the exact complete/strike-through animation as the main Tasks
    view's TaskRow — used by the calendar rail and full day view so completing a task looks the
    same everywhere it appears. */
export function CalendarTaskItem({
  title,
  isCompleted,
  onToggle,
  projectName,
  size = 20,
  textClassName = "text-sm",
}: {
  title: string;
  isCompleted: boolean;
  onToggle: () => void;
  projectName?: string | null;
  size?: number;
  textClassName?: string;
}) {
  const [completing, setCompleting] = useState(false);
  function handleToggle() {
    if (isCompleted) {
      onToggle();
      return;
    }
    setCompleting(true);
    onToggle();
    window.setTimeout(() => setCompleting(false), 460);
  }
  return (
    <>
      <CheckSquare action={handleToggle} checked={isCompleted} completing={completing} size={size} />
      <div className="min-w-0 flex-1">
        <div
          className={`relative ${textClassName}`}
          style={{ color: isCompleted ? "var(--ink-soft)" : "var(--ink)", textDecoration: isCompleted && !completing ? "line-through" : "none" }}
        >
          {title}
          {completing && <StrikeSweep />}
        </div>
        {projectName && <div className="mt-px text-[11.5px] text-(--ink-soft)">{projectName}</div>}
      </div>
    </>
  );
}

// Reuses the ModeToggle's home/work glyphs so a calendar event visually matches which calendar
// (Gmail = home, Outlook = work) it came from — hovering swaps the glyph for a dismiss "x",
// so the marker doubles as the dismiss control instead of needing a separate button.
export function CalendarEventMarker({
  source,
  title,
  onDismiss,
  size = 20,
}: {
  source: string;
  title: string;
  onDismiss: () => void;
  size?: number;
}) {
  const iconPath = source === "Outlook" ? ICON_PATH.work : source === "Gmail" ? ICON_PATH.home : ICON_PATH.all;
  return (
    <button
      type="button"
      onClick={onDismiss}
      aria-label={`Dismiss ${title}`}
      title="Dismiss"
      className="group relative mt-0.5 flex flex-none cursor-pointer items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg
        className="absolute transition-opacity group-hover:opacity-0"
        width={size * 0.72}
        height={size * 0.72}
        viewBox="0 -960 960 960"
      >
        <path d={iconPath} style={{ fill: "var(--ink-soft)" }} />
      </svg>
      <svg
        className="absolute opacity-0 transition-opacity group-hover:opacity-100"
        width={size * 0.6}
        height={size * 0.6}
        viewBox="0 -960 960 960"
      >
        <path
          d="m336-280-56-56 144-144-144-143 56-56 144 144 143-144 56 56-144 143 144 144-56 56-143-144-144 144Z"
          style={{ fill: "var(--danger)" }}
        />
      </svg>
    </button>
  );
}

const COMPLETE_HOLD_MS = 550;

/** Keeps a just-completed row visible in an "active" list for a beat after the underlying data
    flips to completed, so its checkbox/strike animation (~450ms) has time to actually play before
    the row is filtered out. */
export function useCompletionHold() {
  const [held, setHeld] = useState<Set<string>>(new Set());

  const hold = useCallback((id: string) => {
    setHeld((prev) => new Set(prev).add(id));
    window.setTimeout(() => {
      setHeld((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, COMPLETE_HOLD_MS);
  }, []);

  return { isHeld: (id: string) => held.has(id), hold };
}

export function RowDeleteButton({ action }: { action: () => void }) {
  return (
    <button
      type="button"
      onClick={action}
      title="Delete"
      aria-label="Delete"
      className="cursor-pointer text-[13px] text-(--ink-faint) opacity-0 transition-opacity hover:text-(--danger) group-hover:opacity-100"
    >
      Delete
    </button>
  );
}

export const labelClass = "text-[11px] uppercase tracking-[0.16em] text-(--ink-soft)";

/** Renders `children` on one line, shrinking the font size (down to `minFontSize`) so it never
    overflows the container's width — for decorative script text where letter widths vary too
    much to size by character count alone. Re-measures on resize. */
export function FitText({
  children,
  maxFontSize,
  minFontSize = 24,
  className,
}: {
  children: string;
  maxFontSize: number;
  minFontSize?: number;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLSpanElement | null>(null);
  const [fontSize, setFontSize] = useState(maxFontSize);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const text = textRef.current;
    if (!container || !text) return;

    const fit = () => {
      text.style.fontSize = `${maxFontSize}px`;
      const containerWidth = container.clientWidth;
      const textWidth = text.scrollWidth;
      setFontSize(textWidth > containerWidth ? Math.max(minFontSize, maxFontSize * (containerWidth / textWidth)) : maxFontSize);
    };

    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(container);
    return () => observer.disconnect();
  }, [children, maxFontSize, minFontSize]);

  return (
    <div ref={containerRef} className="w-full">
      <span ref={textRef} className={className} style={{ fontSize, whiteSpace: "nowrap", display: "inline-block" }}>
        {children}
      </span>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { DURATION_OPTIONS } from "@/lib/shared";
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

// A free-text duration box with a styled dropdown of preset suggestions (5 min … 1.5 hours) —
// a native <datalist> can't be themed, so this is a custom dropdown that matches the app's
// look. The raw text is submitted under name="duration" and parsed into whole minutes by
// parseDurationInput (server + client), so custom values like "20 min" work too. The options
// list renders in normal flow (not absolutely positioned) so the modal's scroll container
// never clips it.
export function DurationField({
  className,
  defaultValue,
}: {
  className?: string;
  defaultValue?: string;
}) {
  const [value, setValue] = useState(defaultValue ?? "");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <input
        name="duration"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={() => setOpen(true)}
        placeholder="e.g. 30 min, 1.5 hours"
        autoComplete="off"
        className={className}
      />
      {open && (
        <div className="mt-1 flex flex-col overflow-hidden rounded-lg border border-(--border-strong) bg-(--card) shadow-[0_8px_24px_rgba(70,55,30,.14)]">
          {DURATION_OPTIONS.map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => {
                setValue(o);
                setOpen(false);
              }}
              className="cursor-pointer px-3 py-1.5 text-left text-sm text-(--ink) hover:bg-[rgba(85,118,148,.08)]"
            >
              {o}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// The caret below is an SVG data URI, which cannot resolve var() — these are fixed mid-tones
// chosen to read acceptably on the chip washes in BOTH light and dark themes.
export const SELECT_CARET_INFO = "#7d97b5";
export const SELECT_CARET_MUTED = "#988f7a";

/** Replaces the OS-native dropdown caret on the few remaining native <select>s (compact chip
    and popover controls, where SelectField's in-flow menu wouldn't fit): appearance-none plus
    a small Material "arrow_drop_down" glyph pulled in close to the label, colored to match
    the select's text. */
export function selectCaretStyle(literalHex: string): React.CSSProperties {
  const fill = encodeURIComponent(literalHex);
  return {
    appearance: "none",
    WebkitAppearance: "none",
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 -960 960 960'%3E%3Cpath d='M480-360 240-600h480L480-360Z' fill='${fill}'/%3E%3C/svg%3E")`,
    backgroundRepeat: "no-repeat",
    backgroundPosition: "right 4px center",
    backgroundSize: "13px 13px",
    paddingRight: 20,
  };
}

export type SelectOption = { value: string; label: string };

/** A native-<select> replacement styled in the app's design language — a trigger button plus
    a dropdown of options matching DurationField's menu, instead of the OS-chrome select and
    its unthemeable popup. Uncontrolled (pass `name` + optional `defaultValue`, the current
    value rides in a hidden input for FormData) or controlled (pass `value` + `onChange`; add
    `name` too if a form also needs to read it). Like DurationField, the open menu renders in
    normal flow so a modal's scroll container never clips it. */
export function SelectField({
  options,
  name,
  defaultValue,
  value,
  onChange,
  className,
  triggerStyle,
  placeholder,
  ariaLabel,
}: {
  options: SelectOption[];
  name?: string;
  defaultValue?: string;
  value?: string;
  onChange?: (value: string) => void;
  /** Trigger button styling — pass the same input class the old <select> wore. */
  className?: string;
  triggerStyle?: React.CSSProperties;
  /** Trigger label when the current value isn't one of the options (e.g. "More timezones…"). */
  placeholder?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [internal, setInternal] = useState(defaultValue ?? options[0]?.value ?? "");
  const current = value !== undefined ? value : internal;
  const currentLabel = options.find((o) => o.value === current)?.label ?? placeholder ?? current;
  const wrapRef = useRef<HTMLDivElement>(null);

  // Click-away close, not onBlur — macOS Safari never focuses a <button> on click.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function pick(next: string) {
    if (value === undefined) setInternal(next);
    onChange?.(next);
    setOpen(false);
  }

  return (
    <div ref={wrapRef} onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
      {name && <input type="hidden" name={name} value={current} />}
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
        className={`${className ?? ""} flex cursor-pointer items-center justify-between gap-2 text-left`}
        style={triggerStyle}
      >
        <span className="truncate">{currentLabel}</span>
        {/* Material Symbols "arrow_drop_down" — replaces the OS-native select caret. */}
        <svg width="14" height="14" viewBox="0 -960 960 960" className="flex-none" aria-hidden>
          <path d="M480-360 240-600h480L480-360Z" style={{ fill: "var(--ink-muted)" }} />
        </svg>
      </button>
      {open && (
        <div
          role="listbox"
          className="mt-1 flex max-h-56 flex-col overflow-y-auto rounded-lg border border-(--border-strong) bg-(--card) py-1 shadow-[0_8px_24px_rgba(70,55,30,.14)]"
        >
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === current}
              onClick={() => pick(o.value)}
              className={`cursor-pointer px-3 py-1.5 text-left text-sm hover:bg-[rgba(85,118,148,.08)] ${
                o.value === current ? "text-(--accent-text)" : "text-(--ink)"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
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

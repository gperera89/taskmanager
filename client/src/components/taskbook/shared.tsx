export function Chip({ children, variant = "default" }: { children: React.ReactNode; variant?: "default" | "project" }) {
  const style =
    variant === "project"
      ? { color: "#8a8069", background: "rgba(138,128,105,.13)" }
      : { color: "#557694", background: "rgba(85,118,148,.1)" };
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
}: {
  action: () => Promise<void>;
  checked: boolean;
  size?: number;
}) {
  return (
    <form action={action} className="flex-none">
      <button
        type="submit"
        aria-label={checked ? "Mark incomplete" : "Mark complete"}
        className="flex cursor-pointer items-center justify-center rounded"
        style={{
          width: size,
          height: size,
          border: `1.5px solid ${checked ? "#17399b" : "#b3a988"}`,
          background: checked ? "rgba(23,57,155,.06)" : "transparent",
        }}
      >
        {checked && (
          <svg width={size * 0.64} height={size * 0.64} viewBox="0 0 24 24" fill="none">
            <path d="M4 13.5 L9.5 18.5 L20 5.5" stroke="#17399b" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
    </form>
  );
}

export function RowDeleteButton({ action }: { action: () => Promise<void> }) {
  return (
    <form action={action} className="opacity-0 transition-opacity group-hover:opacity-100">
      <button
        type="submit"
        title="Delete"
        aria-label="Delete"
        className="cursor-pointer text-[13px] text-[#b3a988] hover:text-[#8a4040]"
      >
        Delete
      </button>
    </form>
  );
}

export const labelClass = "text-[11px] uppercase tracking-[0.16em] text-[#a49a82]";

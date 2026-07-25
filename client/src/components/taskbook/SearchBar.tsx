"use client";

// The inline search bar that sits at the top of each main view (where the old natural-language
// quick add used to live). One shared `query` in TaskbookApp drives all of them, so the field
// reads the same whichever tab it's typed in — on mobile every carousel panel renders its own
// copy, hence the `data-taskbook-search` hook instead of a duplicated id.
const SEARCH_ICON_PATH =
  "M784-120 532-372q-30 24-69 38t-83 14q-109 0-184.5-75.5T120-580q0-109 75.5-184.5T380-840q109 0 184.5 75.5T640-580q0 44-14 83t-38 69l252 252-56 56ZM380-400q75 0 127.5-52.5T560-580q0-75-52.5-127.5T380-760q-75 0-127.5 52.5T200-580q0 75 52.5 127.5T380-400Z";

export default function SearchBar({
  query,
  onQueryChange,
  placeholder,
}: {
  query: string;
  onQueryChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="mb-5 mt-4 flex max-w-[680px] items-center gap-2 rounded-full border border-(--border-strong) bg-(--card) px-4 py-2 text-(--ink-soft)">
      <svg width="15" height="15" viewBox="0 -960 960 960" className="flex-none">
        <path d={SEARCH_ICON_PATH} style={{ fill: "var(--ink-faint)" }} />
      </svg>
      <input
        data-taskbook-search
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            onQueryChange("");
            (e.target as HTMLInputElement).blur();
          }
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full min-w-0 bg-transparent text-[14px] text-(--ink) outline-none placeholder:text-(--ink-faint)"
      />
      {query && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onQueryChange("")}
          className="flex h-5 w-5 flex-none cursor-pointer items-center justify-center rounded-full"
        >
          <svg width="12" height="12" viewBox="0 -960 960 960">
            <path
              d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"
              style={{ fill: "var(--ink-soft)" }}
            />
          </svg>
        </button>
      )}
    </div>
  );
}

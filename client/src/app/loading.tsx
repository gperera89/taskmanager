// Streaming fallback for `page.tsx`. Without this, Next has nothing to send until every server
// fetch on the page has resolved, so a phone on a cold start sits on a blank white document for
// as long as the slowest query takes. With it, the chrome below is in the first flush — the
// browser starts on the stylesheet and fonts straight away and the real UI swaps in underneath.
//
// Deliberately static: no spinner, no animation, no client JS. It exists to make the first paint
// look like the app rather than like a loading screen, so the swap reads as content filling in.

// Same shape and labels as BottomTabs, minus the counts (which need the data we're waiting on)
// and the interactivity. Keeping the frame identical means the real tab bar replaces this one
// in place, with nothing shifting.
const TABS = ["Tasks", "Projects", "Routines", "Habits", "Calendar"];

export default function Loading() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-(--surface)">
      <div className="flex flex-1 items-center justify-center">
        <span className="font-script text-5xl leading-[0.8] text-(--ink-ghost) select-none">Cura</span>
      </div>
      <div className="flex h-[calc(70px+env(safe-area-inset-bottom))] flex-none border-t border-(--border) bg-(--surface-raised) pb-[env(safe-area-inset-bottom)]">
        {TABS.map((name, i) => (
          <div
            key={name}
            className={`flex h-full flex-1 flex-col items-center justify-center gap-0.5 ${
              i === TABS.length - 1 ? "lg:hidden" : "border-r border-(--border)"
            } ${i === TABS.length - 2 ? "lg:border-r-0" : ""}`}
          >
            <span className="text-[15px] text-(--ink-faint)">{name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

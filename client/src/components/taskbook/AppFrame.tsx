// The app's static frame — wordmark and tab bar, no data, no interactivity. Drawn while there is
// nothing trustworthy to show yet: as the streaming fallback for the page (app/loading.tsx) and by
// the store until it has picked which rows to paint (StoreProvider's `ready`). Both are the same
// component, so the hand-off from one to the other is invisible.
//
// Deliberately static: no spinner, no animation, no client JS. It exists to make the first paint
// look like the app rather than like a loading screen, so the swap reads as content filling in.

// Same shape and labels as BottomTabs, minus the counts (which need the data we're waiting on)
// and the interactivity. Keeping the frame identical means the real tab bar replaces this one
// in place, with nothing shifting.
const TABS = ["Tasks", "Projects", "Routines", "Habits", "Calendar"];

export default function AppFrame() {
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

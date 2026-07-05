"use client";

import { useEffect } from "react";

// The PWA on a phone keeps its JS running while backgrounded/suspended. If a new deploy has
// gone out by the time you reopen it, the app's next router.refresh() (fired by store.tsx's
// focus/visibility listener) points at chunks the new build no longer serves and throws — with
// no boundary here, that used to unmount the whole tree to a blank white screen. A hard reload
// picks up the current deployment's HTML/JS instead. The sessionStorage guard stops a reload
// loop if the error turns out to be unrelated to a stale build.
export default function Error({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    console.error(error);
    const key = "taskbook-error-reload-at";
    const last = Number(sessionStorage.getItem(key) || 0);
    if (Date.now() - last > 10_000) {
      sessionStorage.setItem(key, String(Date.now()));
      window.location.reload();
    }
  }, [error]);

  return (
    <div className="flex h-screen items-center justify-center bg-[#efe9dc] font-serif text-[#8a8069]">
      Updating…
    </div>
  );
}

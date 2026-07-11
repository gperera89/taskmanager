"use client";

import { useEffect } from "react";

// Same stale-build recovery as error.tsx, but for errors thrown from the root layout itself
// (e.g. the auth() call) — global-error replaces the whole document, so it must render its own
// <html>/<body>.
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
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
    <html lang="en">
      <body className="flex h-screen items-center justify-center bg-(--surface) font-serif text-(--ink-muted)">
        Updating…
      </body>
    </html>
  );
}

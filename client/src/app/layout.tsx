import type { Metadata, Viewport } from "next";
import type { Session } from "next-auth";
import { Suspense } from "react";
import { Lora, Pinyon_Script } from "next/font/google";
import "./globals.css";
import { auth, signOut } from "@/auth";

const lora = Lora({
  variable: "--font-lora",
  subsets: ["latin"],
});

const pinyon = Pinyon_Script({
  variable: "--font-pinyon",
  weight: "400",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Cura - Gayan Perera",
  description: "Tasks, projects, routines and habits in one place.",
};

// Lock the viewport at 100% so mobile browsers don't auto-zoom when a text field is focused
// (iOS zooms toward any input under 16px), which otherwise forces the user to pinch back out.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

// Shared by the real bar and its streaming placeholder so the two are always the same height —
// the placeholder is what's on screen until `auth()` resolves, and any mismatch would show up as
// the whole app jumping down a row when the real bar swaps in.
const TOP_BAR_CLASS =
  "flex flex-none items-center justify-end gap-3 border-b border-(--border) bg-(--surface-raised) px-6 py-2.5 text-xs text-(--ink-muted)";

// `auth()` decodes the session cookie, which is enough work to hold up the *entire* document —
// nothing paints, not even the stylesheet or fonts, while it runs. Isolating it in its own async
// component behind Suspense lets the shell flush on the first byte and streams the bar in after.
async function TopBar() {
  // Never allowed to throw. Inside a Suspense boundary a thrown error doesn't just blank this
  // bar — it fails the boundary, and with the page's own `loading.tsx` fallback in play the
  // result is a document stuck on the loading shell with the real content parsed but never
  // revealed. A misconfigured or unreachable auth provider should cost the sign-out button,
  // not the entire app.
  // Typed as Session explicitly: `auth` is overloaded (it doubles as the middleware wrapper), so
  // inferring from its return type resolves to the wrong signature.
  let session: Session | null = null;
  try {
    session = await auth();
  } catch (err) {
    console.error("[layout] failed to resolve the session:", err);
    return null;
  }
  if (!session?.user) return null;

  return (
    <div className={TOP_BAR_CLASS}>
      {/* Filled via portal by Header.tsx on mobile, where settings/notifications/mode
          toggle would otherwise overflow off-screen alongside the search bar. */}
      <div id="mobile-top-actions" className="flex items-center gap-2 lg:hidden" />
      <span className="hidden lg:inline">{session.user.name ?? session.user.email}</span>
      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/" });
        }}
      >
        <button type="submit" className="hover:text-(--accent-text)">
          Sign out
        </button>
      </form>
    </div>
  );
}

// Identifies the deploy this document was rendered by. The service worker parses it out of the
// cached shell (see public/sw.js): serving a cached shell is only safe as long as it belongs to
// the deploy that's still live, so when a background revalidate sees this value change, it tells
// the open page to reload onto the new build. Vercel sets these at runtime; local dev has neither.
// `||`, not `??`: Next inlines a `process.env` lookup that has no value as an empty string rather
// than undefined, and `??` would happily pass that through — leaving the stamp blank and the
// service worker's deploy check permanently dead.
const BUILD_ID = process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_GIT_COMMIT_SHA || "dev";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${lora.variable} ${pinyon.variable} h-full antialiased`}
    >
      <head>
        <meta name="cura-build" content={BUILD_ID} />
      </head>
      {/* h-dvh (not h-screen/100vh) so iOS Safari's collapsing chrome never hides the bottom
          tab bar behind the home indicator. */}
      <body className="flex h-dvh flex-col overflow-hidden font-serif bg-(--surface)">
        {/* The placeholder reserves the bar's exact height with invisible text rather than a
            fixed pixel value, so it tracks the real bar's font/padding automatically. This app
            is signed-in effectively all the time (proxy.ts redirects everyone else), so drawing
            the bar shape up front is the right guess. */}
        <Suspense
          fallback={
            <div className={TOP_BAR_CLASS} aria-hidden>
              <span className="invisible">Sign out</span>
            </div>
          }
        >
          <TopBar />
        </Suspense>
        {children}
      </body>
    </html>
  );
}

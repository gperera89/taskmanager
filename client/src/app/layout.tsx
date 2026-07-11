import type { Metadata } from "next";
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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();

  return (
    <html
      lang="en"
      className={`${lora.variable} ${pinyon.variable} h-full antialiased`}
    >
      {/* h-dvh (not h-screen/100vh) so iOS Safari's collapsing chrome never hides the bottom
          tab bar behind the home indicator. */}
      <body className="flex h-dvh flex-col overflow-hidden font-serif bg-(--surface)">
        {session?.user && (
          <div className="flex flex-none items-center justify-end gap-3 border-b border-(--border) bg-(--surface-raised) px-6 py-2.5 text-xs text-(--ink-muted)">
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
        )}
        {children}
      </body>
    </html>
  );
}

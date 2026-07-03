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
      <body className="flex h-screen flex-col overflow-hidden font-serif bg-[#efe9dc]">
        {session?.user && (
          <div className="flex flex-none items-center justify-end gap-3 border-b border-[#ddd4c1] bg-[#e6ded0] px-6 py-2.5 text-xs text-[#8a8069]">
            <span>{session.user.email}</span>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/" });
              }}
            >
              <button type="submit" className="hover:text-[#17399b]">
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

import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { logout } from "@/actions/auth";
import { Logo } from "@/components/logo";
import { requireUser } from "@/lib/auth";
import { getSettings } from "@/lib/db";

export const metadata: Metadata = { title: { default: "My gigs", template: "%s · Gigsaw" } };
export const viewport: Viewport = { themeColor: "#15181c" };

export default async function ArtistAppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser(["ARTIST"]);
  const settings = await getSettings(user.agencyId);
  return (
    <div className="min-h-screen bg-ink-950 text-white">
      <div className="mx-auto max-w-lg">
        <header className="sticky top-0 z-10 flex items-center justify-between bg-ink-950/85 px-5 py-4 backdrop-blur">
          <Link href="/app">
            <Logo size={28} sub={settings.agencyName} />
          </Link>
          <form action={logout}>
            <button className="text-xs text-ink-400 hover:text-white">Sign out</button>
          </form>
        </header>
        <main className="px-5 pt-2 pb-16">
          <p className="mb-6 text-[15px] text-ink-400">Hi {user.name.split(" ")[0]}</p>
          {children}
        </main>
      </div>
    </div>
  );
}

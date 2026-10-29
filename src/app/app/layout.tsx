import type { Metadata } from "next";
import Link from "next/link";
import { logout } from "@/actions/auth";
import { requireUser } from "@/lib/auth";
import { getSettings } from "@/lib/db";

export const metadata: Metadata = { title: { default: "My gigs", template: "%s · Gigsaw" } };

export default async function ArtistAppLayout({ children }: { children: React.ReactNode }) {
  const [user, settings] = await Promise.all([requireUser(["ARTIST"]), getSettings()]);
  return (
    <div className="mx-auto min-h-screen max-w-lg bg-slate-50">
      <header className="sticky top-0 z-10 flex items-center justify-between bg-brand-700 px-4 py-3 text-white">
        <Link href="/app" className="flex items-center gap-2">
          <img src="/icon.svg" alt="" className="h-7 w-7 rounded-md ring-1 ring-white/40" />
          <span className="leading-tight">
            <span className="block font-bold">Gigsaw</span>
            <span className="block text-xs text-white/70">{settings.agencyName}</span>
          </span>
        </Link>
        <form action={logout}>
          <button className="text-xs text-white/80 hover:text-white">Sign out ({user.name.split(" ")[0]})</button>
        </form>
      </header>
      <main className="p-4 pb-12">{children}</main>
    </div>
  );
}

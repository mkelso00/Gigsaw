import type { Metadata } from "next";
import Link from "next/link";
import { logout } from "@/actions/auth";
import { requireOwner } from "@/lib/auth";

export const metadata: Metadata = { title: { default: "Owner", template: "%s · Gigsaw owner" } };

export default async function OwnerLayout({ children }: { children: React.ReactNode }) {
  const user = await requireOwner();
  return (
    <div className="min-h-screen">
      <header className="no-print border-b border-slate-800 bg-slate-900 text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
          <Link href="/owner" className="flex items-center gap-2.5">
            <img src="/icon.svg" alt="" className="h-8 w-8 rounded-lg" />
            <span className="leading-tight">
              <span className="block font-bold">Gigsaw</span>
              <span className="block text-xs text-slate-400">Owner area</span>
            </span>
          </Link>
          <nav className="flex gap-1 text-sm">
            <Link href="/owner" className="rounded-md px-3 py-1.5 hover:bg-white/10">
              Agencies
            </Link>
            <Link href="/owner/billing" className="rounded-md px-3 py-1.5 hover:bg-white/10">
              Billing
            </Link>
            {user.agencyId && (
              <Link href="/dashboard" className="rounded-md px-3 py-1.5 text-slate-300 hover:bg-white/10">
                My agency →
              </Link>
            )}
          </nav>
          <form action={logout} className="ml-auto">
            <button className="text-xs text-slate-400 hover:text-white">Sign out ({user.name.split(" ")[0]})</button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}

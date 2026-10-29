import Link from "next/link";
import { logout } from "@/actions/auth";
import { NavLinks } from "@/components/nav";
import { requireStaff } from "@/lib/auth";
import { getSettings } from "@/lib/db";

export default async function AgencyLayout({ children }: { children: React.ReactNode }) {
  const [user, settings] = await Promise.all([requireStaff(), getSettings()]);
  return (
    <div className="min-h-screen lg:flex">
      <aside className="no-print border-b border-slate-200 bg-white lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-60 lg:shrink-0 lg:flex-col lg:border-r lg:border-b-0">
        <div className="flex items-center justify-between gap-3 px-4 py-4 lg:px-5">
          <Link href="/dashboard" className="flex items-center gap-2.5">
            <img src="/icon.svg" alt="" className="h-8 w-8 rounded-lg" />
            <span>
              <span className="block text-lg leading-tight font-bold tracking-tight">Gigsaw</span>
              <span className="block max-w-36 truncate text-xs text-slate-500">{settings.agencyName}</span>
            </span>
          </Link>
        </div>
        <NavLinks isAdmin={user.role === "ADMIN"} />
        <div className="mt-auto hidden border-t border-slate-200 p-4 text-sm lg:block">
          <div className="font-medium">{user.name}</div>
          <div className="text-xs text-slate-500">{user.role === "ADMIN" ? "Admin" : "Agent"}</div>
          <form action={logout} className="mt-2">
            <button className="text-xs text-slate-500 hover:text-slate-900">Sign out</button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">{children}</main>
    </div>
  );
}

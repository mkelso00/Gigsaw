import Link from "next/link";
import { Suspense } from "react";
import { QuickSearch } from "@/components/quick-search";
import { logout } from "@/actions/auth";
import { Icon } from "@/components/icons";
import { Logo } from "@/components/logo";
import { NavLinks } from "@/components/nav";
import { requireStaff } from "@/lib/auth";
import { getSettings } from "@/lib/db";

export default async function AgencyLayout({ children }: { children: React.ReactNode }) {
  const user = await requireStaff();
  const settings = await getSettings(user.agencyId);
  const initials = user.name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <div className="min-h-screen lg:flex">
      <aside className="no-print bg-ink-950 lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-64 lg:shrink-0 lg:flex-col">
        <div className="flex items-center justify-between px-5 pt-5 pb-4 lg:pb-6">
          <Link href="/dashboard">
            <Logo sub={settings.agencyName} />
          </Link>
          <form action={logout} className="lg:hidden">
            <button className="text-xs text-ink-400 hover:text-white">Sign out</button>
          </form>
        </div>
        <NavLinks isAdmin={user.role === "ADMIN"} isOwner={user.isOwner} />
        <div className="mt-auto hidden border-t border-white/[0.06] p-4 lg:block">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink-800 text-xs font-semibold text-volt-300">{initials}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-white">{user.name}</div>
              <div className="text-xs text-ink-500">{user.role === "ADMIN" ? "Admin" : "Agent"}</div>
            </div>
            <form action={logout}>
              <button className="rounded-md p-1.5 text-ink-500 hover:bg-white/[0.06] hover:text-white" title="Sign out" aria-label="Sign out">
                <Icon name="out" className="h-4 w-4" />
              </button>
            </form>
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-5 sm:px-8 lg:px-12 lg:py-6">
        <div className="mx-auto max-w-[1400px]">
          <div className="no-print mb-8 max-w-xl">
            <Suspense>
              <QuickSearch />
            </Suspense>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}

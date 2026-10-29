import Link from "next/link";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { QuickBooking } from "@/components/quick-booking";
import { QuickSearch } from "@/components/quick-search";
import { logout } from "@/actions/auth";
import { toggleTheme } from "@/actions/theme";
import { Icon } from "@/components/icons";
import { Logo } from "@/components/logo";
import { NavLinks } from "@/components/nav";
import { requireStaff } from "@/lib/auth";
import { getSettings, prisma } from "@/lib/db";
import { localDateKey } from "@/lib/time";
import { oneOffsNeedingAct, unfilledSlots } from "@/lib/unfilled";

export default async function AgencyLayout({ children }: { children: React.ReactNode }) {
  const user = await requireStaff();
  const theme = (await cookies()).get("gigsaw_theme")?.value === "light" ? "light" : "dark";
  const settings = await getSettings(user.agencyId);
  const pick = { where: { agencyId: user.agencyId }, orderBy: { name: "asc" as const }, select: { id: true, name: true } };
  const [unfilled, noAct, acts, venues, contacts] = await Promise.all([
    unfilledSlots(user.agencyId, settings.defaultTimezone, 7),
    oneOffsNeedingAct(user.agencyId, 7),
    prisma.artist.findMany(pick),
    prisma.venue.findMany(pick),
    prisma.contact.findMany(pick),
  ]);
  const unfilledThisWeek = unfilled.length + noAct;
  const initials = user.name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <div className="min-h-screen bg-ink-950 lg:flex">
      <aside className="no-print bg-ink-950 lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-64 lg:shrink-0 lg:flex-col">
        <div className="flex items-center justify-between px-5 pt-5 pb-4 lg:pb-6">
          <Link href="/dashboard">
            <Logo sub={settings.agencyName} />
          </Link>
          <form action={logout} className="lg:hidden">
            <button className="text-xs text-ink-400 hover:text-white">Sign out</button>
          </form>
        </div>
        <NavLinks isAdmin={user.role === "ADMIN"} isOwner={user.isOwner} badges={{ "/rota": unfilledThisWeek }} />
        <div className="mt-auto hidden border-t border-white/[0.06] p-4 lg:block">
          {user.isOwner && (
            <Link
              href="/owner"
              className="mb-3 flex items-center gap-3 rounded-lg border border-white/[0.08] px-3 py-2 text-sm text-ink-300 transition-colors hover:border-volt-400/40 hover:bg-white/[0.04] hover:text-white"
            >
              <Icon name="owner" className="h-[18px] w-[18px] text-volt-400" />
              Owner area
              <span className="ml-auto text-ink-500">→</span>
            </Link>
          )}
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink-800 text-xs font-semibold text-volt-300">{initials}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-white">{user.name}</div>
              <div className="text-xs text-ink-500">{user.role === "ADMIN" ? "Admin" : "Agent"}</div>
            </div>
            <form action={toggleTheme.bind(null, theme)}>
              <button
                className="rounded-md p-1.5 text-ink-500 hover:bg-white/[0.06] hover:text-white"
                title={theme === "dark" ? "Switch to light" : "Switch to dark"}
                aria-label={theme === "dark" ? "Switch to light" : "Switch to dark"}
              >
                <Icon name={theme === "dark" ? "sun" : "moon"} className="h-4 w-4" />
              </button>
            </form>
            <form action={logout}>
              <button className="rounded-md p-1.5 text-ink-500 hover:bg-white/[0.06] hover:text-white" title="Sign out" aria-label="Sign out">
                <Icon name="out" className="h-4 w-4" />
              </button>
            </form>
          </div>
        </div>
      </aside>
      <main className={`min-h-screen min-w-0 flex-1 bg-ink-50 px-4 py-5 sm:px-8 lg:px-12 lg:py-6 ${theme === "dark" ? "theme-dark" : ""}`}>
        <div className="mx-auto max-w-[1400px]">
          <div className="no-print mb-8 flex items-start gap-3">
            <div className="max-w-xl min-w-0 flex-1">
              <Suspense>
                <QuickSearch />
              </Suspense>
            </div>
            <div className="ml-auto">
              <QuickBooking
                acts={acts}
                venues={venues}
                contacts={contacts}
                currency={settings.defaultCurrency}
                today={localDateKey(new Date(), settings.defaultTimezone)}
              />
            </div>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}

import Link from "next/link";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { QuickBooking } from "@/components/quick-booking";
import { QuickSearch } from "@/components/quick-search";
import { logout } from "@/actions/auth";
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
  const [unfilled, noAct, acts, venues, contacts, newActs] = await Promise.all([
    unfilledSlots(user.agencyId, settings.defaultTimezone, 7),
    oneOffsNeedingAct(user.agencyId, 7),
    prisma.artist.findMany(pick),
    prisma.venue.findMany(pick),
    prisma.contact.findMany(pick),
    prisma.actApplication.count({ where: { agencyId: user.agencyId, status: "NEW" } }),
  ]);
  const unfilledThisWeek = unfilled.length + noAct;
  const initials = user.name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <div className="min-h-screen bg-[#060606] lg:flex">
      <aside className="no-print bg-[#060606] lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-60 lg:shrink-0 lg:flex-col">
        <div className="flex items-center justify-between px-5 pt-5 pb-4">
          <Link href="/dashboard">
            <Logo sub={settings.agencyName} />
          </Link>
          <form action={logout} className="lg:hidden">
            <button className="text-xs text-ink-400 hover:text-white">Sign out</button>
          </form>
        </div>
        <NavLinks
          isAdmin={user.role === "ADMIN"}
          isOwner={user.isOwner}
          badges={{ "/rota": unfilledThisWeek, "/artists": newActs }}
          business={{ name: settings.agencyName || user.agency?.name || "Your business", email: settings.agencyEmail }}
        />
        <div className="mt-auto hidden space-y-1 p-3 lg:block">
          {user.isOwner && (
            <Link
              href="/owner"
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-ink-400 transition-colors hover:bg-white/[0.04] hover:text-white"
            >
              <Icon name="owner" className="h-[18px] w-[18px] text-volt-400" />
              Owner area
            </Link>
          )}
          {user.role === "ADMIN" && (
            <Link
              href="/settings"
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-ink-400 transition-colors hover:bg-white/[0.04] hover:text-white"
            >
              <Icon name="settings" className="h-[18px] w-[18px] text-ink-500" />
              Settings
            </Link>
          )}
          <div className="flex items-center gap-1 rounded-lg hover:bg-white/[0.04]">
            <Link href="/profile" className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-ink-800 text-[11px] font-semibold text-volt-300">
                {initials}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-white">{user.name}</span>
                <span className="block truncate text-xs text-ink-500">{user.email}</span>
              </span>
            </Link>
            <Link
              href="/profile#notifications"
              className="mr-2 rounded-md p-1.5 text-ink-500 hover:bg-white/[0.06] hover:text-white"
              title="Your notifications"
              aria-label="Your notifications"
            >
              <Icon name="bell" className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </aside>
      <div className="min-w-0 flex-1 lg:py-2 lg:pr-2">
        <main
          className={`min-h-screen bg-ink-50 px-4 py-5 sm:px-8 lg:min-h-[calc(100vh-1rem)] lg:rounded-2xl lg:ring-1 lg:ring-white/[0.07] lg:px-10 lg:py-6 ${theme === "dark" ? "theme-dark" : ""}`}
        >
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
    </div>
  );
}

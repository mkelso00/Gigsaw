import Link from "next/link";
import { cookies, headers } from "next/headers";
import { Suspense } from "react";
import { QuickBooking } from "@/components/quick-booking";
import { QuickSearch } from "@/components/quick-search";
import { Icon } from "@/components/icons";
import { Logo } from "@/components/logo";
import { MobileTopIcons, SearchSlot } from "@/components/header-actions";
import { MobileMenu, NavLinks } from "@/components/nav";
import { requireStaff } from "@/lib/auth";
import { awayBetween } from "@/lib/away";
import { getSettings, prisma } from "@/lib/db";
import { OPEN_WHEN_LOCKED, billingState } from "@/lib/subscription";
import { localDateKey } from "@/lib/time";
import { oneOffsNeedingAct, unfilledSlots } from "@/lib/unfilled";

export default async function AgencyLayout({ children }: { children: React.ReactNode }) {
  const user = await requireStaff();
  const theme = (await cookies()).get("gigsaw_theme")?.value === "dark" ? "dark" : "light";
  const settings = await getSettings(user.agencyId);
  const pick = { where: { agencyId: user.agencyId }, orderBy: { name: "asc" as const }, select: { id: true, name: true } };
  const today = localDateKey(new Date(), settings.defaultTimezone);
  const [unfilled, noAct, acts, venues, contacts, newActs, away] = await Promise.all([
    unfilledSlots(user.agencyId, settings.defaultTimezone, 7),
    oneOffsNeedingAct(user.agencyId, 7),
    prisma.artist.findMany(pick),
    prisma.venue.findMany({ ...pick, select: { id: true, name: true, city: true } }),
    prisma.contact.findMany({ ...pick, select: { id: true, name: true, company: true } }),
    prisma.actApplication.count({ where: { agencyId: user.agencyId, status: "NEW" } }),
    // Days acts can't play, so New booking can mark them as away for the chosen date.
    awayBetween(user.agencyId, today, "9999-12-31"),
  ]);
  const unfilledThisWeek = unfilled.length + noAct;
  // A self-service business whose trial has ended (or subscription stopped) can only reach Plan and Profile.
  const billing = billingState(user.agency!);
  const path = (await headers()).get("x-pathname") ?? "";
  const locked = billing.locked && !OPEN_WHEN_LOCKED.some((p) => path.startsWith(p));
  const navProps = {
    isAdmin: user.role === "ADMIN",
    isOwner: user.isOwner,
    badges: { "/rota": unfilledThisWeek, "/artists": newActs },
    business: { name: settings.agencyName || user.agency?.name || "Your business", email: settings.agencyEmail },
  };
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
          <span className="flex items-center gap-1">
            <MobileTopIcons />
            <MobileMenu {...navProps} logo={<Logo sub={settings.agencyName} />} user={{ name: user.name, email: user.email }} />
          </span>
        </div>
        {/* Computers: the full sidebar. Phones: only Settings' scrolling strip shows here; the main menu is behind the menu button. */}
        <NavLinks {...navProps} />
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
            {/* On phones search and new booking are icons in the top bar instead; the search box drops in when tapped. */}
            <div className="no-print flex items-start gap-3 lg:mb-8">
              <SearchSlot>
                <Suspense>
                  <QuickSearch />
                </Suspense>
              </SearchSlot>
              <div className="ml-auto">
                <QuickBooking
                  acts={acts}
                  venues={venues.map((v) => ({ id: v.id, name: v.name, detail: v.city }))}
                  contacts={contacts.map((c) => ({ id: c.id, name: c.name, detail: c.company }))}
                  currency={settings.defaultCurrency}
                  today={today}
                  away={away.map(({ artistId, startDate, endDate, note, actName, own }) => ({ artistId, startDate, endDate, note, actName, own }))}
                />
              </div>
            </div>
            {billing.mode === "STRIPE" && !billing.subscribed && !billing.locked && billing.trialDaysLeft !== null && billing.trialDaysLeft <= 7 && (
              <Link
                href="/settings/plan"
                className="no-print mb-6 flex items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
              >
                <span>
                  Your free trial ends in {billing.trialDaysLeft} day{billing.trialDaysLeft === 1 ? "" : "s"}. Add a card to keep going.
                </span>
                <span className="font-medium">Choose a plan →</span>
              </Link>
            )}
            {billing.mode === "STRIPE" && billing.status === "PAST_DUE" && (
              <Link
                href="/settings/plan"
                className="no-print mb-6 flex items-center justify-between gap-3 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900"
              >
                <span>Your last payment didn&apos;t go through. Please update your card.</span>
                <span className="font-medium">Update card →</span>
              </Link>
            )}
            {locked ? (
              <div className="mx-auto max-w-xl py-16 text-center">
                <h1 className="text-3xl font-semibold tracking-tight">{billing.label}</h1>
                <p className="mt-3 text-ink-600">
                  Choose a plan and add a card to carry on. Everything you&apos;ve set up is safe, and your acts&apos; app keeps working in the meantime.
                </p>
                {user.role === "ADMIN" ? (
                  <Link href="/settings/plan" className="btn btn-primary mt-6">
                    Choose a plan
                  </Link>
                ) : (
                  <p className="mt-6 text-sm text-ink-500">Ask an admin at your business to choose a plan.</p>
                )}
              </div>
            ) : (
              children
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

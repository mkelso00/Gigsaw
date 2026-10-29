import type { Metadata } from "next";
import Link from "next/link";
import { SettingsCard, SettingsPage, SettingsRow, SettingsSection } from "@/components/settings-ui";
import { requireAdmin } from "@/lib/auth";
import { monthLabel, unresolvedPastWhere } from "@/lib/billing";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { internalUserCounts } from "@/lib/seat-counts";
import { userCharge } from "@/lib/seats";
import { usageForMonth } from "@/lib/usage";

export const metadata: Metadata = { title: "Plan" };
export const dynamic = "force-dynamic";

export default async function PlanSettings() {
  const user = await requireAdmin();
  const agencyId = user.agencyId!;
  const agency = user.agency!;
  const month = new Date().toISOString().slice(0, 7);
  const [usage, users, unresolved, statements] = await Promise.all([
    usageForMonth(month, agencyId),
    internalUserCounts([agencyId]),
    prisma.booking.count({ where: { agencyId, ...unresolvedPastWhere() } }),
    prisma.billingStatement.findMany({ where: { agencyId }, orderBy: { month: "desc" }, take: 12 }),
  ]);
  const gigs = usage.get(agencyId)?.count ?? 0;
  const seats = userCharge(agency, users.get(agencyId) ?? 0);
  const price = (m: number) => formatMoney(m, agency.billingCurrency);
  return (
    <SettingsPage title="Plan">
      <section className="rounded-[var(--radius-card)] bg-ink-950 p-6 text-white">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <div className="text-[13px] text-white/60">Your Gigsaw plan</div>
            <div className="mt-2 text-3xl font-semibold tracking-tight">
              {price(agency.pricePerGigMinor)} <span className="text-base font-normal text-white/60">per gig</span>
            </div>
            <div className="mt-1 text-xs text-white/60">
              {seats.users} internal user{seats.users === 1 ? "" : "s"}, {agency.includedUsers} included
              {seats.extra > 0 && agency.extraUserYearlyMinor > 0 ? ` · ${seats.extra} extra at ${price(agency.extraUserYearlyMinor)} a year each` : ""}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[13px] text-white/60">{monthLabel(month)} so far</div>
            <div className="mt-2 text-3xl font-semibold tracking-tight text-volt-400 tabular-nums">
              {price(gigs * agency.pricePerGigMinor + seats.monthlyMinor)}
            </div>
            <div className="text-xs text-white/60">
              {gigs} billable gig{gigs === 1 ? "" : "s"}
              {seats.monthlyMinor > 0 ? ` + ${price(seats.monthlyMinor)} for extra users` : ""}
            </div>
          </div>
        </div>
      </section>

      <SettingsSection title="How it's worked out">
        <SettingsCard>
          <SettingsRow
            icon="bookings"
            title="Per gig"
            sub="A gig counts when it's confirmed or settled, when the act checks in, or when it's still on hold or pending after its date. Cancelled gigs, enquiries and demo data are free."
          />
          <SettingsRow
            icon="contacts"
            title="Internal users"
            sub={`${agency.includedUsers} included. Internal users are you and your staff who log in to make bookings; acts, venue managers and customers are always free.`}
            href="/settings/users"
          />
          {unresolved > 0 && (
            <SettingsRow
              icon="clock"
              title={`${unresolved} past gig${unresolved === 1 ? " was" : "s were"} never confirmed or cancelled`}
              sub="They're counted until you confirm or cancel them."
              href="/bookings?status=UNRESOLVED&when=all"
            />
          )}
        </SettingsCard>
      </SettingsSection>

      {statements.length > 0 && (
        <SettingsSection title="Statements">
          <SettingsCard>
            {statements.map((s) => (
              <SettingsRow
                key={s.id}
                icon="billing"
                title={monthLabel(s.month)}
                sub={`${s.gigCount} gigs${s.extraUsers ? ` + ${s.extraUsers} extra user${s.extraUsers === 1 ? "" : "s"}` : ""}`}
                right={
                  <span className="text-right text-sm">
                    <span className="block font-medium tabular-nums">{formatMoney(s.amountMinor, s.currency)}</span>
                    <span className={s.status === "PAID" ? "text-emerald-600" : "text-amber-600"}>{s.status === "PAID" ? "Paid" : "Due"}</span>
                  </span>
                }
              />
            ))}
          </SettingsCard>
        </SettingsSection>
      )}
      <p className="text-sm text-ink-500">
        Questions about your bill?{" "}
        <Link href="mailto:hello@gigsaw.live" className="link">
          Get in touch
        </Link>
        .
      </p>
    </SettingsPage>
  );
}

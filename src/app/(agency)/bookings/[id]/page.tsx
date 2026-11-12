import type { Metadata } from "next";
import { PayLinksCard } from "@/components/pay-links-card";
import { cardPaymentsReady } from "@/lib/card-payments";
import { ArrivalPanel } from "@/components/arrival-panel";
import { ContractPanel } from "@/components/contract-panel";
import { requireStaff } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { loadBookingPage } from "./_data";
import { ActivitySection } from "./_sections/activity";
import { ArchiveActions } from "./_sections/archive";
import { CheckInsSection } from "./_sections/check-ins";
import { ChecklistSection } from "./_sections/checklist";
import { DetailsSection, ScheduleSection } from "./_sections/details";
import { BookingBanners, BookingHeader } from "./_sections/header";
import { MoneySection } from "./_sections/money";
import { PaymentsSection } from "./_sections/payments";
import { StatusSection } from "./_sections/status";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const user = await requireStaff();
  const b = await prisma.booking.findFirst({ where: { id, agencyId: user.agencyId }, select: { reference: true } });
  return { title: b?.reference ?? "Booking" };
}

export default async function BookingPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaff();
  const { id } = await params;
  const { booking, settings, now, zone, activity, asked, askedCounts, contractTarget, contract, deal, totals, checklist, arrival } = await loadBookingPage(
    user.agencyId,
    id,
  );

  return (
    <div>
      <BookingHeader booking={booking} />
      <BookingBanners booking={booking} arrival={arrival} />

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <ArrivalPanel booking={booking} arrival={arrival} settings={settings} />
          <CheckInsSection booking={booking} now={now} zone={zone} />
          <ScheduleSection booking={booking} zone={zone} />
          <DetailsSection booking={booking} />
          <PaymentsSection booking={booking} now={now} />
        </div>

        <div className="space-y-6">
          <StatusSection booking={booking} asked={asked} askedCounts={askedCounts} />

          {contract && (
            <ContractPanel
              kind={contractTarget.kind}
              id={contractTarget.id}
              status={contract}
              timeZone={booking.timezone}
              signer={booking.promoter ? { name: booking.promoter.name, email: booking.promoter.email } : null}
              previewHref={booking.event ? `/print/events/${booking.event.id}/contract` : `/print/bookings/${booking.id}/contract`}
              partOf={booking.event ? { href: `/events/${booking.event.id}`, name: booking.event.name } : undefined}
              agencySigned={!!settings.signatureImage}
            />
          )}

          <ChecklistSection checklist={checklist} />
          <MoneySection booking={booking} deal={deal} totals={totals} />

          {deal.totalDueMinor > 0 && booking.status !== "CANCELLED" && !booking.archivedAt && (
            <PayLinksCard
              target="booking"
              id={booking.id}
              gigs={[booking]}
              links={booking.payLinks}
              currency={booking.currency}
              ready={await cardPaymentsReady(user.agency!)}
              isAdmin={user.role === "ADMIN"}
              email={booking.promoter?.email ?? ""}
              timezone={settings.defaultTimezone}
            />
          )}

          <ActivitySection activity={activity} timeZone={settings.defaultTimezone} />
          <ArchiveActions booking={booking} isAdmin={user.role === "ADMIN"} />
        </div>
      </div>
    </div>
  );
}

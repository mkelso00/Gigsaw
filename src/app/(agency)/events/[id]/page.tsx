import type { Metadata } from "next";
import { deleteEvent } from "@/actions/events";
import { ContractPanel } from "@/components/contract-panel";
import { PayLinksCard } from "@/components/pay-links-card";
import { cardPaymentsReady } from "@/lib/card-payments";
import { ConfirmButton, ServerForm } from "@/components/forms";
import { requireStaff } from "@/lib/auth";
import { loadEventPage } from "./_data";
import { ActsSection } from "./_sections/acts";
import { ChecklistSection } from "./_sections/checklist";
import { AutoEmailsSection, PlannerSection } from "./_sections/emails";
import { EventHeader, EventStats, ProposalBanner } from "./_sections/header";
import { RecordPaymentSection } from "./_sections/payment";
import { EditEventDetails, PlanSection } from "./_sections/plan";
import { parseExtraFields } from "@/lib/event-plan";

export const metadata: Metadata = { title: "Wedding or event" };

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaff();
  const { id } = await params;
  const {
    event: e,
    settings,
    options,
    acts,
    tasks,
    sent,
    payLinks,
    proposal,
    today,
    totals: t,
    daysLeft,
    contract,
    contractSigned,
  } = await loadEventPage(user.agencyId, id);

  return (
    <div>
      <EventHeader event={e} daysLeft={daysLeft} />
      {proposal && <ProposalBanner proposal={proposal} timeZone={e.timezone} />}
      <EventStats totals={t} daysLeft={daysLeft} />

      <div className="grid gap-8 xl:grid-cols-[1fr_380px]">
        <div className="min-w-0 space-y-8">
          <ActsSection event={e} acts={acts} currency={t.currency} defaultCurrency={settings.defaultCurrency} />
          <PlanSection event={e} extras={parseExtraFields(settings.planExtraFields)} />
          <EditEventDetails event={e} options={options} />
        </div>

        <div className="space-y-6">
          <ChecklistSection event={e} tasks={tasks} totals={t} sent={sent} contractSigned={contractSigned} today={today} />

          <div id="contract" className="scroll-mt-6">
            <ContractPanel
              kind="event"
              id={e.id}
              status={contract}
              timeZone={e.timezone}
              signer={e.customer ? { name: e.customer.name, email: e.customer.email } : null}
              previewHref={`/print/events/${e.id}/contract`}
              agencySigned={!!settings.signatureImage}
            />
          </div>

          <PlannerSection event={e} />
          <AutoEmailsSection event={e} totals={t} sent={sent} daysLeft={daysLeft} eventEmails={settings.eventEmails} />

          {e.status === "ACTIVE" && (
            <PayLinksCard
              target="event"
              id={e.id}
              gigs={e.bookings.filter((b) => b.status !== "CANCELLED")}
              links={payLinks}
              currency={t.currency}
              ready={await cardPaymentsReady(user.agency!)}
              isAdmin={user.role === "ADMIN"}
              email={e.customer?.email ?? ""}
              timezone={e.timezone}
            />
          )}

          <RecordPaymentSection eventId={e.id} currency={t.currency} today={today} />

          {e.notes && (
            <section className="card card-pad">
              <h2 className="section-title mb-2">Notes</h2>
              <p className="text-sm whitespace-pre-wrap text-ink-700">{e.notes}</p>
            </section>
          )}

          <ServerForm action={deleteEvent.bind(null, e.id)}>
            <ConfirmButton message="Delete this wedding or event? The acts' bookings stay as normal bookings." className="btn btn-danger w-full">
              Delete
            </ConfirmButton>
          </ServerForm>
        </div>
      </div>
    </div>
  );
}

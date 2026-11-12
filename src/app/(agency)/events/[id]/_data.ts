import "server-only";
import { notFound } from "next/navigation";
import { contractState, eventContractDoc } from "@/lib/contract-doc";
import { contractStatusFor } from "@/lib/contracts";
import { getSettings, prisma } from "@/lib/db";
import { eventFormOptions } from "@/lib/event-options";
import { daysBetween } from "@/lib/event-plan";
import { eventInclude, eventTotals, sentEventMessages } from "@/lib/events";
import { localDateKey } from "@/lib/time";

/** Everything the wedding or event page shows, loaded in one place so the sections only render. */
export async function loadEventPage(agencyId: string, id: string) {
  const [e, settings, options, acts, tasks, sent, payLinks, proposal] = await Promise.all([
    prisma.event.findFirst({ where: { id, agencyId }, include: eventInclude }),
    getSettings(agencyId),
    eventFormOptions(agencyId),
    prisma.artist.findMany({ where: { agencyId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.eventTask.findMany({ where: { eventId: id, event: { agencyId } }, orderBy: [{ sort: "asc" }, { dueDate: "asc" }] }),
    sentEventMessages(id),
    prisma.payLink.findMany({ where: { eventId: id, agencyId } }),
    // The proposal the customer accepted to book this, if any.
    prisma.quote.findFirst({
      where: { eventId: id, agencyId, status: "ACCEPTED" },
      orderBy: { answeredAt: "desc" },
      select: { id: true, number: true, version: true, answerName: true, answeredAt: true },
    }),
  ]);
  if (!e) notFound();
  const today = localDateKey(new Date(), e.timezone);
  const totals = eventTotals(e.bookings);
  const daysLeft = daysBetween(today, e.date);
  const contractDoc = eventContractDoc({ ...e, reference: e.bookings[0]?.reference ?? e.id.slice(-6).toUpperCase() }, settings);
  const contract = await contractStatusFor(agencyId, { kind: "event", id: e.id }, contractDoc);
  // A signed proposal is the agreement: once the customer has signed it the booking is locked in.
  const contractSigned = !!proposal || (contractState(contract.current) === "SIGNED" && !contract.changes.length);

  return { event: e, settings, options, acts, tasks, sent, payLinks, proposal, today, totals, daysLeft, contract, contractSigned };
}

export type EventPageData = Awaited<ReturnType<typeof loadEventPage>>;
export type EventView = EventPageData["event"];

import "server-only";
import { notFound } from "next/navigation";
import { contractState } from "@/lib/contract-doc";
import { contractStatusFor, contractSubject } from "@/lib/contracts";
import { getSettings, prisma } from "@/lib/db";
import { eventFormOptions } from "@/lib/event-options";
import { daysBetween } from "@/lib/event-plan";
import { eventInclude, eventMessageLog, eventTotals } from "@/lib/events";
import { localDateKey } from "@/lib/time";

/** Everything the wedding or event page shows, loaded in one place so the sections only render. */
export async function loadEventPage(agencyId: string, id: string) {
  const [e, settings, options, acts, tasks, log, payLinks, proposal] = await Promise.all([
    prisma.event.findFirst({ where: { id, agencyId }, include: eventInclude }),
    getSettings(agencyId),
    eventFormOptions(agencyId),
    prisma.artist.findMany({ where: { agencyId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.eventTask.findMany({ where: { eventId: id, event: { agencyId } }, orderBy: [{ sort: "asc" }, { dueDate: "asc" }] }),
    eventMessageLog([id]),
    prisma.payLink.findMany({ where: { eventId: id, agencyId } }),
    // The proposal the customer accepted to book this, if any.
    prisma.quote.findFirst({
      where: { eventId: id, agencyId, status: "ACCEPTED" },
      orderBy: { answeredAt: "desc" },
      select: { id: true, number: true, version: true, answerName: true, answeredAt: true },
    }),
  ]);
  if (!e) notFound();
  const sent = log.sent.get(id)!;
  // Automatic emails looked at in their window and not needed then (e.g. nothing owed when the balance fell due).
  const checked = log.checked.get(id)!;
  // Who gets the staff notices: the lead agent (the wedding coordinator), or else the business email.
  const lead = e.agentId ? await prisma.user.findFirst({ where: { id: e.agentId, agencyId }, select: { name: true, email: true } }) : null;
  const coordinator = lead?.email ? lead.name : settings.agencyEmail || null;
  const today = localDateKey(new Date(), e.timezone);
  const totals = eventTotals(e.bookings);
  const daysLeft = daysBetween(today, e.date);
  // The contract as it stands, with the contract type it uses (the one chosen, the customer's, the event type's or the default).
  const subject = (await contractSubject(agencyId, { kind: "event", id: e.id }))!;
  const contract = await contractStatusFor(agencyId, { kind: "event", id: e.id }, subject.doc);
  const contractType = { templates: subject.templates, picked: subject.picked, auto: subject.auto, chosenId: subject.chosenId };
  // A signed proposal is the agreement: once the customer has signed it the booking is locked in.
  const contractSigned = !!proposal || (contractState(contract.current) === "SIGNED" && !contract.changes.length);

  return {
    event: e,
    settings,
    options,
    acts,
    tasks,
    sent,
    checked,
    coordinator,
    payLinks,
    proposal,
    today,
    totals,
    daysLeft,
    contract,
    contractType,
    contractSigned,
  };
}

export type EventPageData = Awaited<ReturnType<typeof loadEventPage>>;
export type EventView = EventPageData["event"];

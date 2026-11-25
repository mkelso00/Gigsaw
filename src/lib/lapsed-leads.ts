import "server-only";
import { queueCalendarSync } from "./calendar-sync/queue";
import { prisma } from "./db";
import { offerResetFor } from "./offer-links";
import { OPEN_STATUSES } from "./proposals";
import { log } from "@/server/log";

// A lead that went nowhere: its proposal expired with no reply, or the customer declined it. What the
// lead made (src/lib/enquiry-server.ts recordEnquiry) is cancelled so the date isn't held for them any
// more: the Enquiry booking, and the wedding or event with any gigs on it that are still only an
// enquiry or on hold. The lead is marked dealt with.
//
// Only for the latest version (not replaced by a newer one), and only while nothing has been agreed for
// the lead: no proposal for it accepted, no contract for its wedding signed, and no other proposal for
// it being drafted or out with the customer. Gigs that are Pending, Awaiting, Confirmed or Settled, and
// anything with a payment, are never touched. The acts aren't told: these gigs were never offered to
// them (an Enquiry gig is never shown to an act, and a held date leaves their connected calendar
// quietly). Each gig, the event and the lead get the reason in their activity log.
//
// Safe to run twice, or at the same time: each gig is claimed while it's still an enquiry or on hold, so
// a second run finds nothing left to do. Staff can still make a new version of the proposal; when the
// customer accepts that, acceptProposal makes a new wedding or event and new bookings as usual (it only
// reuses the lead's event while that is still active).

export const LAPSE_REASONS = {
  EXPIRED: "Proposal expired, no reply",
  DECLINED: "Proposal declined by the customer",
} as const;
export type Lapse = keyof typeof LAPSE_REASONS;

/** The proposal's activity entry when its lead's gigs are cancelled. Its detail lists them, e.g. "B-0012 and the wedding". */
export const FREED_ACTION = "cancelled what the lead held";

/** The gigs a lapsed lead frees: still only an enquiry, or a date on hold. */
export const FREEABLE_STATUSES = ["ENQUIRY", "HOLD"];

export type FreedLead = {
  /** The gigs cancelled now (none on a second run). */
  cancelled: { id: string; reference: string }[];
  eventCancelled: boolean;
  enquiryDone: boolean;
};

const isLapse = (s: string): s is Lapse => s in LAPSE_REASONS;

/**
 * Cancel what a lapsed proposal's lead made. Returns null when it isn't for this proposal to do (not
 * expired or declined, replaced by a newer version, no lead, or the lead is still in play).
 */
export async function freeLapsedLead(quoteId: string): Promise<FreedLead | null> {
  const pre = await prisma.quote.findUnique({ where: { id: quoteId }, select: { enquiry: { select: { eventId: true } } } });
  if (!pre?.enquiry) return null;
  const eventId = pre.enquiry.eventId;

  const result = await prisma.$transaction(async (tx) => {
    // One at a time per wedding, like the secure gate (src/lib/secure-event.ts): a payment or a signature
    // arriving at the same moment waits for this, or this waits for it and then sees it.
    if (eventId) await tx.$queryRaw`SELECT id FROM "Event" WHERE id = ${eventId} FOR UPDATE`;
    const q = await tx.quote.findUnique({
      where: { id: quoteId },
      select: {
        id: true,
        agencyId: true,
        status: true,
        supersededById: true,
        enquiry: { select: { id: true, name: true, status: true, doneAt: true, bookingId: true, eventId: true } },
      },
    });
    if (!q?.enquiry || q.supersededById || !isLapse(q.status)) return null;
    const e = q.enquiry;
    const reason = LAPSE_REASONS[q.status];

    // Still in play: something for this lead has been accepted or signed, or another proposal for it is
    // being drafted or is out with the customer (when that one lapses, it does this itself).
    const inPlay = await tx.quote.count({
      where: {
        agencyId: q.agencyId,
        id: { not: q.id },
        OR: [
          { enquiryId: e.id, status: "ACCEPTED" },
          { enquiryId: e.id, supersededById: null, status: { in: ["DRAFT", ...OPEN_STATUSES] } },
          ...(e.eventId ? [{ eventId: e.eventId, status: "ACCEPTED" }] : []),
        ],
      },
    });
    const signed = e.eventId ? await tx.contract.count({ where: { eventId: e.eventId, status: "SIGNED" } }) : 0;
    if (inPlay || signed) return null;

    const now = new Date();
    const { cancelled, event, eventCancelled } = await freeHolds(tx, q.agencyId, e);
    const enquiryDone = e.status === "NEW" || e.status === "CONTACTED";
    if (enquiryDone) await tx.enquiry.update({ where: { id: e.id }, data: { status: "DONE", doneAt: e.doneAt ?? now } });

    const what = event?.type === "WEDDING" ? "the wedding" : "the event";
    const freed = [...cancelled.map((c) => c.reference), ...(eventCancelled ? [what] : [])];
    const at = (i: number) => new Date(now.getTime() + i);
    const rows = [
      ...cancelled.map((c) => ({ entity: "BOOKING", entityId: c.id, action: "cancelled", detail: reason })),
      ...(eventCancelled && event ? [{ entity: "EVENT", entityId: event.id, action: "cancelled", detail: reason }] : []),
      ...(enquiryDone ? [{ entity: "ENQUIRY", entityId: e.id, action: "marked an enquiry dealt with", detail: `${e.name}: ${reason.toLowerCase()}` }] : []),
      ...(freed.length ? [{ entity: "QUOTE", entityId: q.id, action: FREED_ACTION, detail: listOf(freed) }] : []),
    ];
    if (rows.length) await tx.activity.createMany({ data: rows.map((r, i) => ({ agencyId: q.agencyId, ...r, createdAt: at(i) })) });
    return { cancelled, eventCancelled, enquiryDone };
  });

  // After the commit, as every booking change does: a held date leaves the act's connected calendar.
  if (result?.cancelled.length) queueCalendarSync(result.cancelled.map((c) => c.id));
  return result;
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * Cancel the dates a lead holds: its Enquiry booking and its wedding or event's gigs that are still only an enquiry
 * or on hold with nothing paid, then the wedding or event itself once every gig on it is cancelled. Inside the
 * caller's transaction; the caller logs why.
 */
async function freeHolds(tx: Tx, agencyId: string, e: { bookingId: string | null; eventId: string | null }) {
  const gigs = await tx.booking.findMany({
    where: {
      agencyId: agencyId,
      // Archived ones too: they'd be wrong if brought back.
      archivedAt: undefined,
      status: { in: FREEABLE_STATUSES },
      payments: { none: {} },
      // The lead's Enquiry booking, and the gigs on its wedding or event.
      OR: [...(e.bookingId ? [{ id: e.bookingId }] : []), ...(e.eventId ? [{ eventId: e.eventId }] : [])],
    },
    select: { id: true, reference: true, status: true, artistId: true },
    orderBy: { arriveBy: "asc" },
  });
  const cancelled: { id: string; reference: string }[] = [];
  for (const g of gigs) {
    // The usual cancel (setBookingStatus in src/actions/bookings.ts): the offer link goes. Claimed while
    // it's still an enquiry or on hold with nothing paid, so a second run, or a change made meanwhile, wins.
    const done = await tx.booking.updateMany({
      where: { id: g.id, status: g.status, payments: { none: {} } },
      data: { status: "CANCELLED", ...offerResetFor(g, { status: "CANCELLED" }) },
    });
    if (done.count) cancelled.push({ id: g.id, reference: g.reference });
  }

  // The wedding or event goes too once every gig on it is cancelled (or it never had any), and nothing on it was paid.
  const event = e.eventId ? await tx.event.findFirst({ where: { id: e.eventId, agencyId: agencyId }, select: { id: true, type: true, status: true } }) : null;
  const eventCancelled =
    !!event &&
    (
      await tx.event.updateMany({
        where: {
          id: event.id,
          status: "ACTIVE",
          bookings: { every: { status: "CANCELLED", payments: { none: {} } } },
          contracts: { none: { status: "SIGNED" } },
        },
        data: { status: "CANCELLED" },
      })
    ).count > 0;

  return { cancelled, event, eventCancelled };
}

/** freeLapsedLead for the places a proposal lapses (the customer's page, the scheduler, a decline): a failure is logged, never thrown. */
export async function freeLapsedLeadQuietly(quoteId: string) {
  try {
    return await freeLapsedLead(quoteId);
  } catch (e) {
    log.error("Couldn't cancel what a lapsed proposal's lead made", { err: e, quoteId });
    return null;
  }
}

/** "B-0001, B-0002 and the wedding". */
function listOf(items: string[]) {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** Why a lead isn't going ahead: the choices on the lead's "Not going ahead" button. */
export const CLOSE_REASONS = ["Didn't want a proposal", "Date not available", "Over their budget", "Booked someone else", "No reply", "Other"] as const;

export type ClosedLead = { ok: true; cancelled: string[]; eventCancelled: boolean; withdrawn: string[] } | { ok: false; why: string };

/**
 * Staff set a lead aside as not going ahead (Leads: "Not going ahead"), e.g. the customer didn't want a
 * proposal. The lead moves to Not going ahead with its reason; the dates it holds are freed as when its
 * proposal lapses (freeHolds); a proposal for it still being drafted or out with the customer is withdrawn,
 * so its link stops working. Refused once something for it has been agreed: an accepted proposal or a
 * signed contract (cancel the booking itself instead).
 */
export async function closeLead(agencyId: string, enquiryId: string, reason: string): Promise<ClosedLead> {
  const pre = await prisma.enquiry.findFirst({ where: { id: enquiryId, agencyId }, select: { eventId: true } });
  if (!pre) return { ok: false, why: "That lead isn't there any more." };
  const result = await prisma.$transaction(async (tx) => {
    if (pre.eventId) await tx.$queryRaw`SELECT id FROM "Event" WHERE id = ${pre.eventId} FOR UPDATE`;
    const e = await tx.enquiry.findFirst({ where: { id: enquiryId, agencyId }, select: { id: true, name: true, bookingId: true, eventId: true } });
    if (!e) return { ok: false as const, why: "That lead isn't there any more." };
    const agreed = await tx.quote.count({
      where: { agencyId, status: "ACCEPTED", OR: [{ enquiryId: e.id }, ...(e.eventId ? [{ eventId: e.eventId }] : [])] },
    });
    const signed = e.eventId ? await tx.contract.count({ where: { eventId: e.eventId, status: "SIGNED" } }) : 0;
    if (agreed || signed)
      return { ok: false as const, why: "This lead has a signed proposal or contract, so it's booked. Cancel the booking or wedding itself instead." };

    const open = await tx.quote.findMany({
      where: { agencyId, enquiryId: e.id, supersededById: null, status: { in: ["DRAFT", ...OPEN_STATUSES] } },
      select: { id: true, number: true, version: true },
    });
    if (open.length) await tx.quote.updateMany({ where: { id: { in: open.map((o) => o.id) } }, data: { status: "WITHDRAWN" } });
    const { cancelled, event, eventCancelled } = await freeHolds(tx, agencyId, e);
    const now = new Date();
    await tx.enquiry.update({ where: { id: e.id }, data: { status: "CLOSED", closedReason: reason, doneAt: now } });
    const detail = `Not going ahead: ${reason}`;
    const rows = [
      ...cancelled.map((c) => ({ entity: "BOOKING", entityId: c.id, action: "cancelled", detail })),
      ...(eventCancelled && event ? [{ entity: "EVENT", entityId: event.id, action: "cancelled", detail }] : []),
      ...open.map((o) => ({ entity: "QUOTE", entityId: o.id, action: "withdrew the proposal", detail })),
    ];
    await tx.activity.createMany({ data: rows.map((r, i) => ({ agencyId, ...r, createdAt: new Date(now.getTime() + i) })) });
    return {
      ok: true as const,
      cancelled: cancelled.map((c) => c.reference),
      cancelledIds: cancelled.map((c) => c.id),
      eventCancelled,
      withdrawn: open.map((o) => `${o.number}${o.version > 1 ? ` v${o.version}` : ""}`),
    };
  });
  if (!result.ok) return result;
  if (result.cancelledIds.length) queueCalendarSync(result.cancelledIds);
  return { ok: true, cancelled: result.cancelled, eventCancelled: result.eventCancelled, withdrawn: result.withdrawn };
}

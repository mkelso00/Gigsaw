import "server-only";
import { prisma } from "./db";
import { freeLapsedLeadQuietly } from "./lapsed-leads";
import { CHASE_DAYS, proposalInclude, sendProposalChase, type ChaseDay } from "./proposal-server";
import { OPEN_STATUSES, proposalRef } from "./proposals";
import { claimedReminders, claimReminder } from "./reminders";
import { addDaysToKey, localDateKey, localTime } from "./time";

// Proposals the customer hasn't answered, run by the scheduler every minute:
//  - a reminder 3 days after it was sent, and another after 7 (each claimed once in the Reminder
//    table, as QUOTE_CHASE_3 and QUOTE_CHASE_7 for "quote:<id>"), sent between 9am and 8pm in the
//    business's time zone, like the wedding emails;
//  - past its valid-until date (14 days by default), it's saved as Expired. The customer's page does the
//    same when it's opened (markExpired); this makes it happen even if nobody looks. Either way, what its
//    lead made (the Enquiry booking, or the wedding and its held gigs) is cancelled: src/lib/lapsed-leads.ts.
// Only proposals still out with the customer: not replaced by a newer version, withdrawn, accepted or
// declined. Demo customers are never emailed.

const DAY = 86_400_000;
/** Reminders aren't sent for a proposal sent longer ago than this (it's expired, or has no end date and has gone cold). */
const CHASE_WINDOW_DAYS = 30;

export const chaseKind = (day: ChaseDay) => `QUOTE_CHASE_${day}`;
export const chaseRecipient = (quoteId: string) => `quote:${quoteId}`;

/** The reminder due for a proposal sent this long ago, if any: the latest one it has reached. */
export function chaseDue(sentAt: Date, now: Date): ChaseDay | null {
  const days = (now.getTime() - sentAt.getTime()) / DAY;
  let due: ChaseDay | null = null;
  for (const d of CHASE_DAYS) if (days >= d) due = d;
  return due;
}

/** Office hours only: nothing before 9am or after 8pm in the business's time zone. */
export function inSendingHours(now: Date, timeZone: string) {
  const hour = localTime(now, timeZone);
  return hour >= "09:00" && hour < "20:00";
}

export async function runProposalChasers(now = new Date()) {
  const expired = await expireProposals(now);
  const chased = await chaseProposals(now);
  return { expired, chased };
}

/** Save proposals past their valid-until date as Expired. */
async function expireProposals(now: Date) {
  // Every time zone's "today" is within a day of UTC's, so this finds them all; each is checked in its own below.
  const candidates = await prisma.quote.findMany({
    where: { status: { in: OPEN_STATUSES }, supersededById: null, validUntil: { not: null, lt: addDaysToKey(localDateKey(now, "UTC"), 2) } },
    select: { id: true, agencyId: true, number: true, version: true, timezone: true, validUntil: true },
  });
  let expired = 0;
  for (const q of candidates) {
    if (!q.validUntil || q.validUntil >= localDateKey(now, q.timezone)) continue;
    const done = await prisma.quote.updateMany({
      where: { id: q.id, status: { in: OPEN_STATUSES }, supersededById: null, validUntil: { lt: localDateKey(now, q.timezone) } },
      data: { status: "EXPIRED" },
    });
    if (!done.count) continue;
    expired++;
    await prisma.activity.create({
      data: { agencyId: q.agencyId, entity: "QUOTE", entityId: q.id, action: `proposal ${proposalRef(q)} expired`, detail: `valid until ${q.validUntil}` },
    });
    // The lead's Enquiry booking or wedding stops holding the date.
    await freeLapsedLeadQuietly(q.id);
  }
  return expired;
}

/** Send the reminders that are due and haven't gone yet. */
async function chaseProposals(now: Date) {
  const open = await prisma.quote.findMany({
    where: {
      status: { in: OPEN_STATUSES },
      supersededById: null,
      token: { not: null },
      sentAt: { lte: new Date(now.getTime() - CHASE_DAYS[0] * DAY), gte: new Date(now.getTime() - CHASE_WINDOW_DAYS * DAY) },
      agency: { status: "ACTIVE" },
      OR: [{ contactId: null }, { contact: { demo: false } }],
    },
    select: {
      id: true,
      sentAt: true,
      timezone: true,
      validUntil: true,
      tokenExpiresAt: true,
      agency: { select: { settings: { select: { defaultTimezone: true } } } },
    },
  });
  const zoneOf = (q: (typeof open)[number]) => q.agency.settings?.defaultTimezone || q.timezone;
  const due = open
    .map((q) => ({ q, day: chaseDue(q.sentAt!, now) }))
    .filter(
      (x): x is { q: (typeof open)[number]; day: ChaseDay } =>
        !!x.day &&
        inSendingHours(now, zoneOf(x.q)) &&
        // Not past its valid-until date (it's about to be saved as Expired), and its link still opens.
        (!x.q.validUntil || x.q.validUntil >= localDateKey(now, x.q.timezone)) &&
        (!x.q.tokenExpiresAt || x.q.tokenExpiresAt > now),
    );
  if (!due.length) return 0;
  // Runs every minute: skip the ones already sent without trying to claim them again.
  const claimed = await claimedReminders(
    CHASE_DAYS.map(chaseKind),
    due.map((x) => chaseRecipient(x.q.id)),
    [""],
  );
  let sent = 0;
  for (const { q, day } of due) {
    if (claimed.has(`${chaseKind(day)}|${chaseRecipient(q.id)}|`)) continue;
    const full = await prisma.quote.findUnique({ where: { id: q.id }, include: proposalInclude });
    // Answered, withdrawn or replaced since the list was read.
    if (!full || !OPEN_STATUSES.includes(full.status as (typeof OPEN_STATUSES)[number]) || full.supersededById) continue;
    if (!(await claimReminder(chaseKind(day), chaseRecipient(q.id), ""))) continue;
    if (await sendProposalChase(full, day)) sent++;
  }
  return sent;
}

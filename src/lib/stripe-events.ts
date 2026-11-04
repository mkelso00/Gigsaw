import "server-only";
import { prisma } from "./db";

// Stripe sends an event again if it didn't hear back in time, so both webhooks note each event
// once its work is saved and skip it if it comes again. An event is only noted after the work,
// so one that failed half-way is done again on Stripe's retry; the work itself is safe to repeat
// (subscriptions are re-read from Stripe, a card payment is unique per Checkout Session).

// Stripe retries for up to three days, so a month is plenty.
const KEEP_MS = 30 * 86_400_000;

/** This event has already been dealt with. */
export async function stripeEventSeen(id: string) {
  return !!(await prisma.stripeEvent.findUnique({ where: { id }, select: { id: true } }));
}

/** Note an event as dealt with, and clear out ones too old to come again. */
export async function markStripeEvent(id: string, type: string) {
  await prisma.stripeEvent.createMany({ data: [{ id, type }], skipDuplicates: true });
  await prisma.stripeEvent.deleteMany({ where: { receivedAt: { lt: new Date(Date.now() - KEEP_MS) } } });
}

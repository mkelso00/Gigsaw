import "server-only";
import { prisma } from "./db";
import { eventTotals } from "./events";
import { messageFor } from "./message-templates";
import { sendEmail } from "./messaging";
import { dealBreakdown, formatMoney, paymentTotals } from "./money";
import { formatDate } from "./time";

/**
 * "Payment received": reassures a wedding or private customer that the money they paid has arrived, with what's
 * left to pay. Sent when staff record a payment in (or mark an act paid direct). Never to a venue: they work from
 * statements. Settings → Notifications can switch it off or reword it.
 */
export async function sendPaymentReceipt(o: { bookingId?: string; eventId?: string; amountMinor: number; paidTo?: string }) {
  const b = o.bookingId
    ? await prisma.booking.findUnique({
        where: { id: o.bookingId },
        include: { promoter: true, artist: { select: { name: true } }, venue: { select: { name: true } } },
      })
    : null;
  const eventId = o.eventId ?? b?.eventId ?? null;
  if (eventId) return eventReceipt(eventId, o.amountMinor, o.paidTo);
  if (!b || b.demo || b.promoter?.type !== "CLIENT" || !b.promoter.email) return false;
  const s = await prisma.settings.findUnique({ where: { agencyId: b.agencyId }, include: { agency: { select: { name: true } } } });
  const d = dealBreakdown(b);
  const paid = paymentTotals(await prisma.payment.findMany({ where: { bookingId: b.id } })).receivedMinor;
  const what = b.eventName || `${b.artist?.name ?? "Your booking"}${b.venue ? ` at ${b.venue.name}` : ""}, ${formatDate(b.arriveBy, b.timezone)}`;
  return send({
    agencyId: b.agencyId,
    bookingId: b.id,
    to: b.promoter.email,
    name: b.promoter.name,
    brand: s?.agencyName || s?.agency.name || "",
    replyTo: s?.agencyEmail,
    templates: s?.messageTemplates,
    what,
    currency: b.currency,
    amount: o.amountMinor,
    total: d.totalDueMinor,
    paid,
    paidTo: o.paidTo,
  });
}

async function eventReceipt(eventId: string, amountMinor: number, paidTo?: string) {
  const e = await prisma.event.findUnique({
    where: { id: eventId },
    include: { customer: true, agency: { include: { settings: true } }, bookings: { where: { archivedAt: null }, include: { payments: true } } },
  });
  if (!e || e.demo || !e.customer?.email) return false;
  const t = eventTotals(e.bookings);
  return send({
    agencyId: e.agencyId,
    bookingId: null,
    to: e.customer.email,
    name: e.customer.name,
    brand: e.agency.settings?.agencyName || e.agency.name,
    replyTo: e.agency.settings?.agencyEmail,
    templates: e.agency.settings?.messageTemplates,
    what: e.name,
    currency: t.currency,
    amount: amountMinor,
    total: t.total,
    paid: t.received,
    paidTo,
  });
}

async function send(o: {
  agencyId: string;
  bookingId: string | null;
  to: string;
  name: string;
  brand: string;
  replyTo?: string | null;
  templates: unknown;
  what: string;
  currency: string;
  amount: number;
  total: number;
  paid: number;
  paidTo?: string;
}) {
  const m = (x: number) => formatMoney(x, o.currency);
  const first = o.name.split(" ")[0] || "there";
  const t = messageFor(o.templates, "PAYMENT_RECEIVED", { first_name: first, amount: m(o.amount), what: o.what, business: o.brand });
  if (!t.on) return false;
  const left = Math.max(0, o.total - o.paid);
  await sendEmail({
    kind: "PAYMENT",
    agencyId: o.agencyId,
    bookingId: o.bookingId,
    to: o.to,
    replyTo: o.replyTo,
    subject: t.subject ?? `Payment received: ${m(o.amount)}`,
    email: {
      brand: o.brand,
      title: "Payment received, thank you",
      intro:
        t.intro ??
        (o.paidTo
          ? `Hi ${first}, thank you: we've noted your payment of ${m(o.amount)} to ${o.paidTo} for ${o.what}.`
          : `Hi ${first}, thank you: we've received your payment of ${m(o.amount)} for ${o.what}.`),
      highlight: { label: o.paidTo ? `Paid to ${o.paidTo}` : "Received", value: m(o.amount), tone: "good" },
      rows: [
        ["For", o.what],
        ["Total", m(o.total)],
        ["Paid so far", m(o.paid)],
        ["Left to pay", left > 0 ? m(left) : "Nothing: all paid"],
      ],
      rowsTitle: "Your payments",
      outro: left > 0 ? "Any questions, just reply to this email." : "That's everything paid. Thank you!",
    },
  });
  return true;
}

/** The same, never failing the save it follows: a receipt that can't go is logged (and in the outbox). */
export async function receiptQuietly(o: Parameters<typeof sendPaymentReceipt>[0]) {
  try {
    await sendPaymentReceipt(o);
  } catch (e) {
    const { log } = await import("@/server/log");
    log.error("Couldn't send a payment receipt", { err: e });
  }
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, requireStaff } from "@/lib/auth";
import { cardPaymentsReady, ensurePayLink, loadPayLink, onboardingLink, payUrl } from "@/lib/card-payments";
import { getSettings, logActivity, prisma } from "@/lib/db";
import { FormError, handleForm, str, type FormState } from "@/lib/forms";
import { messageFor } from "@/lib/message-templates";
import { isEmail, sendEmail } from "@/lib/messaging";
import { formatMoney } from "@/lib/money";
import { checkoutParams, isPayKind, PAY_KIND_LABELS } from "@/lib/pay-links";
import { stripe, stripeConfigured, StripeError } from "@/lib/stripe";

// Card payments: an admin connects the agency's own Stripe account (Settings > Card payments),
// staff send "Pay now" links for a booking's or an event's deposit or balance, and the venue or
// customer pays on the public /pay/<token> page.

const stripeProblem = (e: unknown, what: string) => {
  if (e instanceof StripeError) return new FormError(`Stripe couldn't ${what}: ${e.message}`);
  return e;
};

/** Make the agency's Stripe account the first time, then send the admin to Stripe to set it up. */
export async function connectStripe(_: FormState): Promise<FormState> {
  let url = "";
  const res = await handleForm(async () => {
    const user = await requireAdmin();
    if (!stripeConfigured()) throw new FormError("Card payments aren't switched on for Gigsaw yet. Please try again later.");
    const agency = await prisma.agency.findUniqueOrThrow({ where: { id: user.agencyId } });
    let account = agency.stripeAccountId;
    try {
      if (!account) {
        const settings = await getSettings(agency.id);
        const made = await stripe<{ id: string }>("POST", "accounts", {
          type: "standard",
          email: settings.agencyEmail || user.email,
          business_profile: { name: settings.agencyName || agency.name },
          metadata: { agencyId: agency.id },
        });
        account = made.id;
        await prisma.agency.update({ where: { id: agency.id }, data: { stripeAccountId: account, stripeChargesEnabled: false, stripeDetailsDone: false } });
        await logActivity(user, "SETTINGS", agency.id, "connected a Stripe account", account);
      }
      url = await onboardingLink(account);
    } catch (e) {
      throw stripeProblem(e, "start the setup");
    }
  });
  if (res?.error) return res;
  redirect(url);
}

/**
 * Stop taking card payments through Gigsaw. The Stripe account is the agency's own, so it stays
 * as it is in Stripe; Gigsaw just forgets it. Links already sent stop offering card payment.
 */
export async function disconnectStripe() {
  const user = await requireAdmin();
  const agency = await prisma.agency.findUniqueOrThrow({ where: { id: user.agencyId } });
  if (!agency.stripeAccountId) return;
  await prisma.agency.update({ where: { id: agency.id }, data: { stripeAccountId: null, stripeChargesEnabled: false, stripeDetailsDone: false } });
  await logActivity(user, "SETTINGS", agency.id, "disconnected Stripe", agency.stripeAccountId);
  revalidatePath("/", "layout");
}

/** Make the "Pay now" link for a booking's or an event's deposit or balance. */
export async function makePayLink(target: "booking" | "event", id: string, kind: string, _: FormState): Promise<FormState> {
  const user = await requireStaff();
  return handleForm(async () => {
    if (!isPayKind(kind)) throw new FormError("Unknown payment");
    if (!cardPaymentsReady(user.agency!)) throw new FormError("Connect Stripe in Settings, Card payments first.");
    if (target === "booking") {
      const b = await prisma.booking.findFirst({ where: { id, agencyId: user.agencyId }, select: { id: true } });
      if (!b) throw new FormError("Booking not found");
      await ensurePayLink(user.agencyId, { bookingId: b.id }, kind);
      await logActivity(user, "BOOKING", b.id, "made a card payment link", PAY_KIND_LABELS[kind].toLowerCase());
    } else {
      const e = await prisma.event.findFirst({ where: { id, agencyId: user.agencyId }, select: { id: true } });
      if (!e) throw new FormError("Wedding or event not found");
      await ensurePayLink(user.agencyId, { eventId: e.id }, kind);
      await logActivity(user, "EVENT", e.id, "made a card payment link", PAY_KIND_LABELS[kind].toLowerCase());
    }
    revalidatePath(target === "booking" ? `/bookings/${id}` : `/events/${id}`);
    return { ok: "Payment link ready. Copy it or email it." };
  });
}

/** Email a pay link to the venue or customer, in the business's own wording if it has set one. */
export async function emailPayLink(linkId: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  return handleForm(async () => {
    const t = await loadPayLink({ id: linkId });
    if (!t || t.agency.id !== user.agencyId) throw new FormError("Payment link not found");
    const to = str(form, "to");
    if (!isEmail(to)) throw new FormError("Enter the email address to send it to");
    if (!t.open) throw new FormError("This booking is cancelled or archived, so there's nothing to pay.");
    if (!cardPaymentsReady(t.agency)) throw new FormError("Connect Stripe in Settings, Card payments first.");
    if (t.dueMinor <= 0) throw new FormError("Nothing left to pay on this one.");
    const amount = formatMoney(t.dueMinor, t.currency);
    const firstName = (t.payer?.email === to ? t.payer.name : "").split(" ")[0];
    const label = PAY_KIND_LABELS[t.kind].toLowerCase();
    const w = messageFor(t.agency.settings?.messageTemplates, "PAY_LINK", { first_name: firstName, what: t.what, amount, business: t.brand });
    if (!w.on) throw new FormError("The payment link email is turned off in Settings, Notifications. Copy the link and send it yourself.");
    const replyTo = user.email || t.agency.settings?.agencyEmail;
    await sendEmail({
      kind: "PAYMENT",
      agencyId: user.agencyId,
      bookingId: t.link.bookingId,
      to,
      replyTo,
      subject: w.subject ?? `${t.what}: ${amount} to pay`,
      email: {
        brand: t.brand,
        title: `Your ${label}: ${amount}`,
        intro: w.intro ?? `Hi${firstName ? ` ${firstName}` : ""}, here's a secure link to pay ${amount} by card for ${t.what}.`,
        rows: [
          ["For", t.what],
          ...(t.reference ? ([["Reference", t.reference]] as [string, string][]) : []),
          [t.kind === "DEPOSIT" ? "Deposit" : "Left to pay", amount],
        ],
        cta: { label: `Pay ${amount}`, url: payUrl(t.link.token) },
        outro: "Payments are taken securely by Stripe. Any questions, just reply to this email.",
      },
    });
    await prisma.payLink.update({ where: { id: t.link.id }, data: { sentAt: new Date() } });
    const [entity, entityId] = t.link.bookingId ? ["BOOKING", t.link.bookingId] : ["EVENT", t.link.eventId!];
    await logActivity(user, entity, entityId, "emailed a card payment link", `${label} ${amount} to ${to}`);
    revalidatePath(t.link.bookingId ? `/bookings/${t.link.bookingId}` : `/events/${t.link.eventId}`);
    return { ok: `Sent to ${to}.` };
  });
}

/** The venue or customer presses Pay: a Stripe Checkout Session on the agency's own account. No login. */
export async function startCardPayment(token: string, _: FormState): Promise<FormState> {
  let url = "";
  const res = await handleForm(async () => {
    const t = token && token.length >= 20 ? await loadPayLink({ token }) : null;
    if (!t || !t.open) throw new FormError("This link isn't valid any more. Please get in touch with us.");
    if (!cardPaymentsReady(t.agency)) throw new FormError(`Card payments aren't available right now. Please get in touch with ${t.brand}.`);
    if (t.dueMinor <= 0) throw new FormError("There's nothing left to pay. Thank you!");
    const page = payUrl(token);
    try {
      const session = await stripe<{ url: string }>(
        "POST",
        "checkout/sessions",
        checkoutParams({
          amountMinor: t.dueMinor,
          currency: t.currency,
          description: `${PAY_KIND_LABELS[t.kind]}: ${t.what}`,
          linkId: t.link.id,
          kind: t.kind,
          agencyId: t.agency.id,
          email: t.payer?.email && isEmail(t.payer.email) ? t.payer.email : null,
          successUrl: `${page}?paid=1`,
          cancelUrl: page,
        }),
        { account: t.agency.stripeAccountId! },
      );
      url = session.url;
    } catch (e) {
      if (e instanceof StripeError) throw new FormError("We couldn't start the payment just now. Please try again in a minute.");
      throw e;
    }
  });
  if (res?.error) return res;
  redirect(url);
}

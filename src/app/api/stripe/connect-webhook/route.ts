import { NextResponse } from "next/server";
import { stripeKeys } from "@/lib/stripe-keys";
import { applyAccount, recordCardPayment, recordCardRefund, type StripeAccount } from "@/lib/card-payments";
import { prisma } from "@/lib/db";
import { verifyWebhook } from "@/lib/stripe";
import { markStripeEvent, stripeEventSeen } from "@/lib/stripe-events";

// Events from agencies' own Stripe accounts (Stripe Connect): card payments from venues and
// customers, refunds, and changes to an account's set-up. In the Stripe dashboard add a webhook
// endpoint at <site>/api/stripe/connect-webhook that listens to events on connected accounts, with
// checkout.session.completed, checkout.session.async_payment_succeeded, charge.refunded,
// account.updated and account.application.deauthorized. Its signing secret is STRIPE_CONNECT_WEBHOOK_SECRET.
//
// A paid session is always saved before this answers 200, matched or not (see recordCardPayment);
// if saving fails it answers 500 and Stripe tries again.

type ConnectEvent = { id: string; type: string; account?: string; data: { object: Record<string, unknown> } };

export async function POST(req: Request) {
  const secret = (await stripeKeys()).connectWebhookSecret;
  if (!secret) return NextResponse.json({ error: "Webhook not set up" }, { status: 503 });
  const body = await req.text();
  if (!verifyWebhook(body, req.headers.get("stripe-signature"), secret)) return NextResponse.json({ error: "Bad signature" }, { status: 400 });
  const event = JSON.parse(body) as ConnectEvent;
  const obj = event.data.object;
  // Only events from a connected account belong here; Gigsaw's own go to /api/stripe/webhook.
  if (!event.account) return NextResponse.json({ received: true, ignored: "not a connected account" });
  if (await stripeEventSeen(event.id)) return NextResponse.json({ received: true, duplicate: true });

  let result: string | undefined;
  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    // Card payments are "paid" straight away; slower methods (e.g. bank debits) are recorded once they clear.
    if (obj.mode === "payment") result = await recordCardPayment(obj as Parameters<typeof recordCardPayment>[0], event.account);
  } else if (event.type === "charge.refunded") {
    result = await recordCardRefund(obj as Parameters<typeof recordCardRefund>[0], event.account);
  } else if (event.type === "account.updated") {
    await applyAccount(obj as unknown as StripeAccount);
  } else if (event.type === "account.application.deauthorized") {
    // The agency disconnected Gigsaw from inside Stripe.
    await prisma.agency.updateMany({
      where: { stripeAccountId: event.account },
      data: { stripeAccountId: null, stripeChargesEnabled: false, stripeDetailsDone: false },
    });
  }
  await markStripeEvent(event.id, event.type);
  return NextResponse.json({ received: true, ...(result ? { result } : {}) });
}

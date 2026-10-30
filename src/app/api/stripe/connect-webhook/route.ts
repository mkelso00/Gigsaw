import { NextResponse } from "next/server";
import { stripeKeys } from "@/lib/stripe-keys";
import { applyAccount, recordCardPayment, type StripeAccount } from "@/lib/card-payments";
import { prisma } from "@/lib/db";
import { verifyWebhook } from "@/lib/stripe";

// Events from agencies' own Stripe accounts (Stripe Connect): card payments from venues and
// customers, and changes to an account's set-up. In the Stripe dashboard add a webhook endpoint
// at <site>/api/stripe/connect-webhook that listens to events on connected accounts, with
// checkout.session.completed, checkout.session.async_payment_succeeded, account.updated and
// account.application.deauthorized. Its signing secret is STRIPE_CONNECT_WEBHOOK_SECRET.

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

  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    // Card payments are "paid" straight away; slower methods (e.g. bank debits) are recorded once they clear.
    if (obj.mode === "payment") {
      const result = await recordCardPayment(obj as Parameters<typeof recordCardPayment>[0], event.account);
      return NextResponse.json({ received: true, result });
    }
  } else if (event.type === "account.updated") {
    await applyAccount(obj as unknown as StripeAccount);
  } else if (event.type === "account.application.deauthorized") {
    // The agency disconnected Gigsaw from inside Stripe.
    await prisma.agency.updateMany({
      where: { stripeAccountId: event.account },
      data: { stripeAccountId: null, stripeChargesEnabled: false, stripeDetailsDone: false },
    });
  }
  return NextResponse.json({ received: true });
}

import { NextResponse } from "next/server";
import { stripeKeys } from "@/lib/stripe-keys";
import { verifyWebhook } from "@/lib/stripe";
import { markStripeEvent, stripeEventSeen } from "@/lib/stripe-events";
import { syncSubscription } from "@/lib/subscription-sync";

// Stripe tells us about subscription changes here. Point a webhook in the Stripe dashboard at
// <site>/api/stripe/webhook with these events: checkout.session.completed and
// customer.subscription.created, .updated and .deleted. Its signing secret is STRIPE_WEBHOOK_SECRET.
//
// Events can come late, twice or out of order, so the event is only a nudge: the subscription is
// fetched from Stripe and its current state saved, and only if it's the business's own one (see
// applySubscription). Each event is noted once handled and skipped if it comes again. Anything
// that fails answers 500, so Stripe tries again.

type StripeEvent = { id: string; type: string; data: { object: Record<string, unknown> } };

const idOf = (v: unknown) => (typeof v === "string" ? v : v && typeof v === "object" && "id" in v ? String((v as { id: unknown }).id) : null);

export async function POST(req: Request) {
  const secret = (await stripeKeys()).webhookSecret;
  if (!secret) return NextResponse.json({ error: "Webhook not set up" }, { status: 503 });
  const body = await req.text();
  if (!verifyWebhook(body, req.headers.get("stripe-signature"), secret)) return NextResponse.json({ error: "Bad signature" }, { status: 400 });
  const event = JSON.parse(body) as StripeEvent;
  if (await stripeEventSeen(event.id)) return NextResponse.json({ received: true, duplicate: true });
  const obj = event.data.object;

  let result = "ignored";
  if (event.type === "checkout.session.completed" && obj.mode === "subscription") {
    const subscription = idOf(obj.subscription);
    if (subscription) result = await syncSubscription(subscription, obj.client_reference_id as string | null);
  } else if (event.type.startsWith("customer.subscription.")) {
    const subscription = idOf(obj.id);
    if (subscription) result = await syncSubscription(subscription);
  }
  await markStripeEvent(event.id, event.type);
  return NextResponse.json({ received: true, result });
}

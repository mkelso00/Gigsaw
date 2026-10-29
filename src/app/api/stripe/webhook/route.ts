import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { stripe, verifyWebhook } from "@/lib/stripe";
import { applySubscription, type StripeSubscription } from "@/lib/subscription-sync";

// Stripe tells us about subscription changes here. Point a webhook in the Stripe dashboard at
// <site>/api/stripe/webhook with these events: checkout.session.completed and
// customer.subscription.created, .updated and .deleted. Its signing secret is STRIPE_WEBHOOK_SECRET.

export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Webhook not set up" }, { status: 503 });
  const body = await req.text();
  if (!verifyWebhook(body, req.headers.get("stripe-signature"), secret)) return NextResponse.json({ error: "Bad signature" }, { status: 400 });
  const event = JSON.parse(body) as { type: string; data: { object: Record<string, unknown> } };
  const obj = event.data.object;

  if (event.type === "checkout.session.completed" && obj.mode === "subscription") {
    const agencyId = obj.client_reference_id as string | null;
    if (agencyId && obj.subscription) {
      await prisma.agency.updateMany({
        where: { id: agencyId },
        data: { stripeCustomerId: obj.customer as string, stripeSubscriptionId: obj.subscription as string },
      });
      await applySubscription(await stripe<StripeSubscription>("GET", `subscriptions/${obj.subscription as string}`));
    }
  } else if (event.type.startsWith("customer.subscription.")) {
    await applySubscription(obj as unknown as StripeSubscription);
  }
  return NextResponse.json({ received: true });
}

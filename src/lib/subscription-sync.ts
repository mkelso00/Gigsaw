import "server-only";
import { prisma } from "./db";
import { planByKey } from "./plans";
import { INTERNAL_ROLES } from "./seats";
import { ensurePrice, parseLookupKey, stripe, stripeConfigured, type Interval } from "./stripe";
import { fromStripeStatus } from "./subscription";

// Keeping Gigsaw and Stripe in step: the webhook passes each subscription change here, and adding
// or removing an internal user updates how many extra users the subscription charges for.

export type StripeSubscription = {
  id: string;
  customer: string;
  status: string;
  metadata?: Record<string, string>;
  current_period_end?: number;
  items: { data: { id: string; quantity?: number; current_period_end?: number; price: { id: string; lookup_key: string | null } }[] };
};

/** Save a subscription's state on its business. Returns false if no business matches. */
export async function applySubscription(sub: StripeSubscription) {
  const agency =
    (await prisma.agency.findFirst({ where: { stripeSubscriptionId: sub.id } })) ??
    (sub.metadata?.agencyId ? await prisma.agency.findUnique({ where: { id: sub.metadata.agencyId } }) : null) ??
    (await prisma.agency.findFirst({ where: { stripeCustomerId: sub.customer } }));
  if (!agency) return false;
  const planItem = sub.items.data.map((i) => parseLookupKey(i.price.lookup_key)).find((p) => p && p.kind !== "EXTRA_USER");
  const periodEnd = sub.current_period_end ?? sub.items.data[0]?.current_period_end;
  await prisma.agency.update({
    where: { id: agency.id },
    data: {
      billingMode: "STRIPE",
      stripeCustomerId: sub.customer,
      stripeSubscriptionId: sub.id,
      subscriptionStatus: fromStripeStatus(sub.status),
      currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
      ...(planItem ? { plan: planItem.kind, billingInterval: planItem.interval } : {}),
    },
  });
  if (planItem) await syncIncludedUsers(agency.id);
  return true;
}

/** The plan sets how many internal users are included; keep the business's record in step. */
async function syncIncludedUsers(agencyId: string) {
  const a = await prisma.agency.findUnique({ where: { id: agencyId }, select: { plan: true } });
  const plan = planByKey(a?.plan);
  if (plan) await prisma.agency.update({ where: { id: agencyId }, data: { includedUsers: plan.includedUsers } });
}

/** Make the subscription charge for however many internal users are over the plan's allowance. */
export async function syncExtraUsers(agencyId: string) {
  if (!(await stripeConfigured())) return;
  const a = await prisma.agency.findUnique({ where: { id: agencyId } });
  if (!a?.stripeSubscriptionId || a.billingMode !== "STRIPE") return;
  const plan = planByKey(a.plan);
  if (!plan) return;
  const users = await prisma.user.count({ where: { agencyId, role: { in: INTERNAL_ROLES }, demo: false } });
  const extra = Math.max(0, users - plan.includedUsers);
  const sub = await stripe<StripeSubscription>("GET", `subscriptions/${a.stripeSubscriptionId}`);
  const item = sub.items.data.find((i) => parseLookupKey(i.price.lookup_key)?.kind === "EXTRA_USER");
  if (item && (item.quantity ?? 0) === extra) return;
  if (item && extra === 0) await stripe("DELETE", `subscription_items/${item.id}`, { proration_behavior: "create_prorations" });
  else if (item) await stripe("POST", `subscription_items/${item.id}`, { quantity: extra, proration_behavior: "create_prorations" });
  else if (extra > 0)
    await stripe("POST", "subscription_items", {
      subscription: sub.id,
      price: await ensurePrice("EXTRA_USER", a.billingInterval as Interval),
      quantity: extra,
      proration_behavior: "create_prorations",
    });
}

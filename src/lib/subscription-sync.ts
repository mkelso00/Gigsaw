import "server-only";
import { prisma } from "./db";
import { planByKey } from "./plan-store";
import type { Plan } from "./plans";
import { INTERNAL_ROLES } from "./seats";
import { ensurePrice, parseLookupKey, stripe, stripeConfigured, type Interval } from "./stripe";
import { fromStripeStatus } from "./subscription";

// Keeping Gigsaw and Stripe in step: the webhook passes each subscription change here, and adding
// or removing an internal user updates how many extra users the subscription charges for.

export type StripeCoupon = {
  id: string;
  name?: string | null;
  percent_off?: number | null;
  amount_off?: number | null;
  currency?: string | null;
  duration: string;
  duration_in_months?: number | null;
};

export type StripeSubscription = {
  id: string;
  customer: string;
  status: string;
  metadata?: Record<string, string>;
  current_period_end?: number;
  trial_end?: number | null;
  discount?: { coupon: StripeCoupon; end?: number | null; promotion_code?: string | null } | null;
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
  const status = fromStripeStatus(sub.status);
  // A cancelled subscription doesn't move a business the owner has put on invoice or a free account back to card billing.
  const keepMode = status === "CANCELED" && agency.billingMode !== "STRIPE";
  await prisma.agency.update({
    where: { id: agency.id },
    data: {
      ...(keepMode ? {} : { billingMode: "STRIPE" }),
      stripeCustomerId: sub.customer,
      stripeSubscriptionId: sub.id,
      subscriptionStatus: status,
      currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
      // Stripe's trial is the one that counts once they've added a card (the owner may have moved it).
      ...(sub.trial_end && !keepMode ? { trialEndsAt: new Date(sub.trial_end * 1000) } : {}),
      ...(planItem && !keepMode ? { plan: planItem.kind, billingInterval: planItem.interval } : {}),
    },
  });
  if (planItem && !keepMode) await syncIncludedUsers(agency.id);
  return true;
}

/** The plan sets how many internal users are included; keep the business's record in step. */
async function syncIncludedUsers(agencyId: string) {
  const a = await prisma.agency.findUnique({ where: { id: agencyId }, select: { plan: true } });
  const plan = await planByKey(a?.plan);
  if (plan) await prisma.agency.update({ where: { id: agencyId }, data: { includedUsers: plan.includedUsers } });
}

const internalUsers = (agencyId: string) => prisma.user.count({ where: { agencyId, role: { in: INTERNAL_ROLES }, demo: false } });

/**
 * Put a live subscription on a plan at today's prices: the plan's price, and extra internal users
 * over what the plan includes. Used when a business changes plan, when the owner changes it for
 * them, and when the owner moves subscribers to new prices.
 * `proration` "create_prorations" adjusts the next bill for the days left (a plan change);
 * "none" just charges the new price from the next bill (a price change).
 */
export async function moveSubscription(
  agencyId: string,
  subscriptionId: string,
  plan: Plan,
  interval: Interval,
  proration: "create_prorations" | "none" = "create_prorations",
) {
  const sub = await stripe<StripeSubscription>("GET", `subscriptions/${subscriptionId}`);
  const planItem = sub.items.data.find((i) => {
    const k = parseLookupKey(i.price.lookup_key);
    return k && k.kind !== "EXTRA_USER";
  });
  const extraItem = sub.items.data.find((i) => parseLookupKey(i.price.lookup_key)?.kind === "EXTRA_USER");
  const extra = Math.max(0, (await internalUsers(agencyId)) - plan.includedUsers);
  const planPrice = await ensurePrice(plan.key, interval);
  const extraPrice = extra || extraItem ? await ensurePrice("EXTRA_USER", interval) : "";
  // Nothing to do if it's already on exactly these prices.
  const same = planItem?.price.id === planPrice && (extra ? extraItem?.price.id === extraPrice && extraItem.quantity === extra : !extraItem);
  if (same) return { sub, changed: false };
  const items: Record<string, unknown>[] = [];
  items.push(planItem ? { id: planItem.id, price: planPrice } : { price: planPrice });
  if (extraItem) items.push(extra ? { id: extraItem.id, price: extraPrice, quantity: extra } : { id: extraItem.id, deleted: true });
  else if (extra) items.push({ price: extraPrice, quantity: extra });
  const updated = await stripe<StripeSubscription>("POST", `subscriptions/${sub.id}`, { items, proration_behavior: proration });
  await applySubscription(updated);
  return { sub: updated, changed: true };
}

/** Make the subscription charge for however many internal users are over the plan's allowance. */
export async function syncExtraUsers(agencyId: string) {
  if (!(await stripeConfigured())) return;
  const a = await prisma.agency.findUnique({ where: { id: agencyId } });
  if (!a?.stripeSubscriptionId || a.billingMode !== "STRIPE") return;
  const plan = await planByKey(a.plan);
  if (!plan) return;
  const extra = Math.max(0, (await internalUsers(agencyId)) - plan.includedUsers);
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

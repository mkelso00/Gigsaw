// Where a self-service business stands with its subscription, and whether the app is open to it.
// Businesses billed by invoice, and free accounts (both set in the Owner area), are never locked.
// The plan itself (its name and price) comes from src/lib/plan-store.ts.

export type BillingMode = "INVOICE" | "STRIPE" | "FREE";

export type SubscriptionStatus = "NONE" | "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELED";

type AgencyBilling = {
  billingMode: string;
  plan: string | null;
  billingInterval: string;
  trialEndsAt: Date | null;
  subscriptionStatus: string;
  stripeSubscriptionId: string | null;
  currentPeriodEnd: Date | null;
};

const DAY = 86_400_000;

/** Stripe's subscription status in Gigsaw's terms. */
export function fromStripeStatus(s: string): SubscriptionStatus {
  if (s === "trialing") return "TRIALING";
  if (s === "active") return "ACTIVE";
  if (s === "past_due" || s === "unpaid") return "PAST_DUE";
  if (s === "canceled" || s === "incomplete_expired") return "CANCELED";
  return "NONE";
}

export function billingState(a: AgencyBilling, now = new Date()) {
  // A free account is never charged and never locked, whatever its trial date or Stripe state says.
  if (a.billingMode === "FREE") return { mode: "FREE" as const, locked: false, trialDaysLeft: null, subscribed: false, label: "Free account" };
  if (a.billingMode !== "STRIPE") return { mode: "INVOICE" as const, locked: false, trialDaysLeft: null, subscribed: false, label: "Billed by invoice" };
  const status = a.subscriptionStatus as SubscriptionStatus;
  const subscribed = !!a.stripeSubscriptionId && (status === "ACTIVE" || status === "TRIALING" || status === "PAST_DUE");
  const trialLeftMs = a.trialEndsAt ? a.trialEndsAt.getTime() - now.getTime() : 0;
  const trialDaysLeft = trialLeftMs > 0 ? Math.ceil(trialLeftMs / DAY) : 0;
  const inTrial = trialDaysLeft > 0;
  // Open while subscribed (a failed payment gets Stripe's retries before it cancels) or in the free trial.
  const locked = !subscribed && !inTrial;
  const label = subscribed
    ? status === "PAST_DUE"
      ? "Payment failed: please update your card"
      : inTrial
        ? `Free trial, ${trialDaysLeft} day${trialDaysLeft === 1 ? "" : "s"} left (card added)`
        : "Subscribed"
    : inTrial
      ? `Free trial, ${trialDaysLeft} day${trialDaysLeft === 1 ? "" : "s"} left`
      : status === "CANCELED"
        ? "Subscription cancelled"
        : "Trial ended";
  return { mode: "STRIPE" as const, locked, trialDaysLeft, subscribed, status, label };
}

/** Pages a locked business can still reach, so it can choose a plan and pay. */
export const OPEN_WHEN_LOCKED = ["/settings/plan", "/profile"];

/** A Stripe subscription that hasn't been cancelled (trialing, paid, retrying a failed payment, or still being set up). */
export function hasLiveSubscription(a: { stripeSubscriptionId: string | null; subscriptionStatus: string }) {
  return !!a.stripeSubscriptionId && a.subscriptionStatus !== "CANCELED";
}

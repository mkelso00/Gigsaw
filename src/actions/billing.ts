"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Agency } from "@prisma/client";
import { requireAdmin } from "@/lib/auth";
import { logActivity, prisma } from "@/lib/db";
import { FormError, handleForm, str, type FormState } from "@/lib/forms";
import { appUrl } from "@/lib/messaging";
import { allPlans } from "@/lib/plan-store";
import { findPlan } from "@/lib/plans";
import { INTERNAL_ROLES } from "@/lib/seats";
import { ensurePrice, stripe, stripeConfigured, StripeError, type Interval } from "@/lib/stripe";
import { hasLiveSubscription } from "@/lib/subscription";
import { moveSubscription } from "@/lib/subscription-sync";

// Settings > Plan: choose a plan, add a card (Stripe Checkout), manage billing (Stripe's billing
// portal: card, invoices, cancelling) and change plan. Admins only.

const DAY = 86_400_000;

function notByCard(agency: Agency) {
  if (agency.billingMode === "FREE") return "Your account is free, so there's nothing to pay.";
  return "Your plan is billed by invoice. Get in touch to change it.";
}

async function billingAgency() {
  const user = await requireAdmin();
  const agency = await prisma.agency.findUniqueOrThrow({ where: { id: user.agencyId! } });
  if (agency.billingMode !== "STRIPE") throw new FormError(notByCard(agency));
  if (!(await stripeConfigured())) throw new FormError("Card payments aren't switched on yet. Please try again later.");
  return { user, agency };
}

/**
 * A plan this business may pick: one on the website, or the plan it's already on (which the owner
 * may have hidden, archived, or given it specially).
 */
async function choosable(key: string, agency: Agency) {
  const plan = findPlan(await allPlans(), key);
  if (!plan) return null;
  if (plan.key === agency.plan) return plan;
  return plan.public && !plan.archived ? plan : null;
}

/** Send the admin to Stripe Checkout to add a card and start the subscription. */
export async function startCheckout(_: FormState, form: FormData): Promise<FormState> {
  let url = "";
  const res = await handleForm(async () => {
    const { user, agency } = await billingAgency();
    const plan = (await choosable(str(form, "plan"), agency)) ?? (await choosable(agency.plan ?? "", agency));
    if (!plan) throw new FormError("Choose a plan");
    const chosen = str(form, "interval") || agency.billingInterval;
    const interval: Interval = chosen === "year" ? "year" : "month";
    if (hasLiveSubscription(agency)) throw new FormError("You're already subscribed. Use Change plan or Manage billing.");

    // One Stripe customer per business.
    let customer = agency.stripeCustomerId;
    if (!customer) {
      const c = await stripe<{ id: string }>("POST", "customers", {
        name: agency.name,
        email: agency.billingEmail || user.email,
        metadata: { agencyId: agency.id },
      });
      customer = c.id;
      await prisma.agency.update({ where: { id: agency.id }, data: { stripeCustomerId: customer } });
    }
    const users = await prisma.user.count({ where: { agencyId: agency.id, role: { in: INTERNAL_ROLES }, demo: false } });
    const extra = Math.max(0, users - plan.includedUsers);
    const items = [{ price: await ensurePrice(plan.key, interval), quantity: 1 }];
    if (extra) items.push({ price: await ensurePrice("EXTRA_USER", interval), quantity: extra });
    // Whatever's left of the free trial carries over, so nobody pays early for adding a card.
    // (Stripe needs a trial to end at least two days away.)
    const trialEnd = agency.trialEndsAt && agency.trialEndsAt.getTime() > Date.now() + 2 * DAY ? Math.floor(agency.trialEndsAt.getTime() / 1000) : undefined;
    const session = await stripe<{ url: string }>("POST", "checkout/sessions", {
      mode: "subscription",
      customer,
      client_reference_id: agency.id,
      line_items: items,
      subscription_data: { metadata: { agencyId: agency.id }, ...(trialEnd ? { trial_end: trialEnd } : {}) },
      // Customers can type a discount code (Owner area → Discount codes).
      allow_promotion_codes: true,
      billing_address_collection: "required",
      tax_id_collection: { enabled: true },
      customer_update: { name: "auto", address: "auto" },
      success_url: `${appUrl()}/settings/plan?subscribed=1`,
      cancel_url: `${appUrl()}/settings/plan`,
    });
    await logActivity(user, "SETTINGS", agency.id, "started a subscription checkout", `${plan.name}, ${interval}ly`);
    url = session.url;
  });
  if (res?.error) return res;
  redirect(url);
}

/** Stripe's billing portal: change card, see invoices, cancel. */
export async function openBillingPortal(_: FormState): Promise<FormState> {
  let url = "";
  const res = await handleForm(async () => {
    const { agency } = await billingAgency();
    if (!agency.stripeCustomerId) throw new FormError("Add a card first.");
    const session = await stripe<{ url: string }>("POST", "billing_portal/sessions", {
      customer: agency.stripeCustomerId,
      return_url: `${appUrl()}/settings/plan`,
    });
    url = session.url;
  });
  if (res?.error) return res;
  redirect(url);
}

/** Change plan (and monthly or yearly). During the trial with no card yet it just changes the choice. */
export async function changePlan(_: FormState, form: FormData): Promise<FormState> {
  return handleForm(async () => {
    const user = await requireAdmin();
    const agency = await prisma.agency.findUniqueOrThrow({ where: { id: user.agencyId! } });
    if (agency.billingMode !== "STRIPE") throw new FormError(notByCard(agency));
    const plan = await choosable(str(form, "plan"), agency);
    if (!plan) throw new FormError("Choose a plan");
    const interval: Interval = str(form, "interval") === "year" ? "year" : "month";
    if (!hasLiveSubscription(agency)) {
      await prisma.agency.update({ where: { id: agency.id }, data: { plan: plan.key, billingInterval: interval, includedUsers: plan.includedUsers } });
    } else {
      if (!(await stripeConfigured())) throw new FormError("Card payments aren't switched on yet.");
      try {
        await moveSubscription(agency.id, agency.stripeSubscriptionId!, plan, interval);
      } catch (e) {
        if (e instanceof StripeError) throw new FormError(`Stripe couldn't change the plan: ${e.message}`);
        throw e;
      }
    }
    await logActivity(user, "SETTINGS", agency.id, "changed plan", `${plan.name}, ${interval}ly`);
    revalidatePath("/", "layout");
    return { ok: `You're on ${plan.name}, paid ${interval === "year" ? "yearly" : "monthly"}.` };
  });
}

"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { CURRENCIES } from "@/lib/constants";
import { logActivity, prisma } from "@/lib/db";
import { FormError, handleForm, oneOf, str, type FormState } from "@/lib/forms";
import { priceFrom, seatsFrom } from "@/lib/owner-forms";
import { allPlans, clearPlanCache, loadCatalogue } from "@/lib/plan-store";
import { choosablePlans, findPlan, newPlanKey, parsePlanInput, PlanError, poundsToMinor, type Plan } from "@/lib/plans";
import { productId, stripe, stripeConfigured, StripeError, type Interval } from "@/lib/stripe";
import { hasLiveSubscription } from "@/lib/subscription";
import { applySubscription, moveSubscription, type StripeSubscription } from "@/lib/subscription-sync";

// The Owner area's Plans page (edit, add, hide and archive plans; the trial and extra-user prices;
// moving subscribers to new prices) and the Plan section on a business's page (put it on a plan,
// a custom invoice price or a free account; extend or end its trial).

const DAY = 86_400_000;

/** Plan and price changes show on the website, sign-up and Settings > Plan straight away. */
function plansChanged() {
  clearPlanCache();
  revalidatePath("/", "layout");
}

/** Turn PlanErrors and Stripe errors into messages for the form. */
async function friendly<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof PlanError) throw new FormError(e.message);
    if (e instanceof StripeError) throw new FormError(`Stripe said: ${e.message}`);
    throw e;
  }
}

function planInput(form: FormData) {
  return parsePlanInput({
    name: str(form, "name"),
    tagline: str(form, "tagline"),
    monthly: str(form, "monthly"),
    yearly: str(form, "yearly"),
    bookings: str(form, "bookings"),
    includedUsers: str(form, "includedUsers"),
    highlights: String(form.get("highlights") ?? ""),
    public: form.get("public") === "on",
    sortOrder: str(form, "sortOrder"),
  });
}

/** Stop the owner leaving nothing for new customers to choose. */
async function keepOneChoosable(change: (p: Plan) => Plan) {
  if (!choosablePlans((await allPlans()).map(change)).length) {
    throw new FormError("Keep at least one plan on the website and not archived, so new businesses can sign up.");
  }
}

export async function createPlan(_: FormState, form: FormData): Promise<FormState> {
  const owner = await requireOwner();
  return handleForm(() =>
    friendly(async () => {
      const data = planInput(form);
      const existing = await prisma.plan.findMany({ select: { key: true, sortOrder: true } });
      const key = newPlanKey(
        str(form, "key"),
        data.name,
        existing.map((p) => p.key),
      );
      // New plans go at the end; the order can be changed afterwards.
      const sortOrder = Math.max(0, ...existing.map((p) => p.sortOrder)) + 10;
      await prisma.plan.create({ data: { ...data, key, sortOrder } });
      await logActivity({ id: owner.id, agencyId: null }, "PLAN", key, "plan added", data.name);
      plansChanged();
      return { ok: `${data.name} added${data.public ? " and shown on the website" : ". It's hidden, so only you can give it to a business"}.` };
    }),
  );
}

export async function savePlan(key: string, _: FormState, form: FormData): Promise<FormState> {
  const owner = await requireOwner();
  return handleForm(() =>
    friendly(async () => {
      const before = await prisma.plan.findUnique({ where: { key } });
      if (!before) throw new FormError("That plan has gone. Reload the page.");
      const data = planInput(form);
      if (!data.public) await keepOneChoosable((p) => (p.key === key ? { ...p, public: false } : p));
      await prisma.plan.update({ where: { key }, data });
      // Businesses still in their trial (no subscription yet) get the new number of included users now.
      await prisma.agency.updateMany({
        where: { plan: key, billingMode: "STRIPE", OR: [{ stripeSubscriptionId: null }, { subscriptionStatus: "CANCELED" }] },
        data: { includedUsers: data.includedUsers },
      });
      // Keep the product's name in Stripe in step (it shows on invoices). Not made yet is fine.
      if (before.name !== data.name && (await stripeConfigured())) {
        await stripe("POST", `products/${productId(key)}`, { name: `Gigsaw ${data.name}` }).catch(() => null);
      }
      const priceChanged = before.monthlyMinor !== data.monthlyMinor || before.yearlyMinor !== data.yearlyMinor;
      await logActivity({ id: owner.id, agencyId: null }, "PLAN", key, "plan changed", data.name);
      plansChanged();
      return {
        ok: priceChanged
          ? `${data.name} saved. New subscriptions pay the new price. Businesses already paying keep their old price until you move them.`
          : `${data.name} saved.`,
      };
    }),
  );
}

/** Archive (can't be chosen any more; businesses on it keep it) or bring back. */
export async function setPlanArchived(key: string, archived: boolean, _: FormState): Promise<FormState> {
  const owner = await requireOwner();
  return handleForm(async () => {
    if (archived) await keepOneChoosable((p) => (p.key === key ? { ...p, archived: true } : p));
    const plan = await prisma.plan.update({ where: { key }, data: { archived } });
    await logActivity({ id: owner.id, agencyId: null }, "PLAN", key, archived ? "plan archived" : "plan brought back", plan.name);
    plansChanged();
    return { ok: archived ? `${plan.name} archived. Businesses on it keep it.` : `${plan.name} can be chosen again.` };
  });
}

/** Only a plan no business has ever been put on can be deleted. */
export async function deletePlan(key: string, _: FormState): Promise<FormState> {
  const owner = await requireOwner();
  return handleForm(async () => {
    const using = await prisma.agency.count({ where: { plan: key } });
    if (using) throw new FormError(`${using} business${using === 1 ? " is" : "es are"} on this plan, so it can't be deleted. Archive it instead.`);
    await keepOneChoosable((p) => (p.key === key ? { ...p, archived: true } : p));
    const plan = await prisma.plan.delete({ where: { key } });
    await logActivity({ id: owner.id, agencyId: null }, "PLAN", key, "plan deleted", plan.name);
    plansChanged();
    return { ok: `${plan.name} deleted.` };
  });
}

/** The free trial's length and the extra-user prices, for every plan. */
export async function saveBillingSettings(_: FormState, form: FormData): Promise<FormState> {
  const owner = await requireOwner();
  return handleForm(() =>
    friendly(async () => {
      const trialDays = Number(str(form, "trialDays"));
      if (!Number.isInteger(trialDays) || trialDays < 0 || trialDays > 365) throw new FormError("The free trial has to be a whole number of days, up to 365");
      const extraUserMonthlyMinor = poundsToMinor(str(form, "extraMonthly"), "the monthly price per extra user");
      const extraUserYearlyMinor = poundsToMinor(str(form, "extraYearly"), "the yearly price per extra user");
      const data = { trialDays, extraUserMonthlyMinor, extraUserYearlyMinor };
      await prisma.billingSettings.upsert({ where: { id: "default" }, update: data, create: { id: "default", ...data } });
      await logActivity({ id: owner.id, agencyId: null }, "PLAN", "settings", "trial and extra-user prices changed");
      plansChanged();
      return { ok: "Saved. New sign-ups get this trial. New subscriptions pay these prices." };
    }),
  );
}

/**
 * Move businesses already paying by card to today's prices (one plan, or every plan when key is
 * ""). Their plan and monthly or yearly stay the same; the new price starts from their next bill,
 * with no extra charge or refund for the time already paid for.
 */
export async function moveSubscribersToCurrentPrices(key: string, _: FormState): Promise<FormState> {
  const owner = await requireOwner();
  return handleForm(async () => {
    if (!(await stripeConfigured())) throw new FormError("Stripe isn't connected, so there's nobody to move.");
    const plans = await allPlans();
    const agencies = await prisma.agency.findMany({
      where: { billingMode: "STRIPE", stripeSubscriptionId: { not: null }, subscriptionStatus: { not: "CANCELED" }, ...(key ? { plan: key } : {}) },
      select: { id: true, name: true, plan: true, billingInterval: true, stripeSubscriptionId: true },
    });
    let moved = 0;
    let already = 0;
    const failed: string[] = [];
    for (const a of agencies) {
      const plan = findPlan(plans, a.plan);
      if (!plan) continue;
      try {
        const r = await moveSubscription(a.id, a.stripeSubscriptionId!, plan, a.billingInterval as Interval, "none");
        if (r.changed) moved++;
        else already++;
      } catch {
        failed.push(a.name);
      }
    }
    await logActivity({ id: owner.id, agencyId: null }, "PLAN", key || "all", "subscribers moved to current prices", `${moved} moved`);
    revalidatePath("/owner", "layout");
    if (!agencies.length) return { ok: "Nobody is paying by card on this plan yet." };
    const parts = [`Moved ${moved} business${moved === 1 ? "" : "es"} to today's prices, from their next bill.`];
    if (already) parts.push(`${already} ${already === 1 ? "was" : "were"} already on them.`);
    if (failed.length) parts.push(`Stripe wouldn't change ${failed.join(", ")}. Try again, or look in Stripe.`);
    return failed.length && !moved ? { error: parts.join(" ") } : { ok: parts.join(" ") };
  });
}

const dateOnly = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

/**
 * The Plan section on a business's page. Three ways to pay:
 * PLAN: one of the plans, by card. With a live subscription the change goes to Stripe straight
 *   away (prorated, like the business changing plan itself); without one, the plan and trial are
 *   set and they're asked to add a card when the trial ends.
 * CUSTOM: billed by invoice at a price per booking.
 * FREE: no charge, never locked.
 */
export async function setAgencyPlan(agencyId: string, _: FormState, form: FormData): Promise<FormState> {
  const owner = await requireOwner();
  return handleForm(() =>
    friendly(async () => {
      const agency = await prisma.agency.findUniqueOrThrow({ where: { id: agencyId } });
      const mode = oneOf(str(form, "mode"), ["PLAN", "CUSTOM", "FREE"] as const, "PLAN");
      const live = hasLiveSubscription(agency);
      const log = (detail: string) => logActivity({ id: owner.id, agencyId }, "AGENCY", agencyId, "plan set by Gigsaw", detail);

      if (mode !== "PLAN") {
        // Moving off card payments: the subscription has to stop, or Stripe would carry on charging.
        if (live) {
          if (!form.get("cancelSubscription")) {
            throw new FormError('They pay by card in Stripe. Tick "Cancel their card subscription" so Stripe stops charging them, then save again.');
          }
          if (!(await stripeConfigured())) throw new FormError("Stripe isn't connected, so their subscription can't be cancelled from here.");
          await stripe("DELETE", `subscriptions/${agency.stripeSubscriptionId}`);
        }
        const stopped = live ? { subscriptionStatus: "CANCELED" } : {};
        if (mode === "FREE") {
          await prisma.agency.update({ where: { id: agencyId }, data: { billingMode: "FREE", ...stopped } });
          await log("free account");
          revalidatePath("/owner", "layout");
          return { ok: `${agency.name} is now a free account: no charge, and never locked.${live ? " Their card subscription is cancelled." : ""}` };
        }
        const currency = oneOf(str(form, "billingCurrency"), CURRENCIES, "GBP");
        await prisma.agency.update({
          where: { id: agencyId },
          data: { billingMode: "INVOICE", billingCurrency: currency, pricePerGigMinor: priceFrom(form, currency), ...seatsFrom(form, currency), ...stopped },
        });
        await log("custom price, by invoice");
        revalidatePath("/owner", "layout");
        return {
          ok: `${agency.name} is billed by invoice at a price per booking. Send statements from Billing.${live ? " Their card subscription is cancelled." : ""}`,
        };
      }

      const catalogue = await loadCatalogue();
      const plan = findPlan(catalogue.plans, str(form, "plan"));
      if (!plan) throw new FormError("Choose a plan");
      if (plan.archived && plan.key !== agency.plan) throw new FormError(`${plan.name} is archived. Bring it back on the Plans page first.`);
      const interval: Interval = str(form, "interval") === "year" ? "year" : "month";
      const typedTrial = str(form, "trialEndsAt");
      if (typedTrial && !/^\d{4}-\d{2}-\d{2}$/.test(typedTrial)) throw new FormError("Choose the day the free trial ends");
      const trialChanged = !!typedTrial && typedTrial !== dateOnly(agency.trialEndsAt);
      const trialEnd = typedTrial ? new Date(`${typedTrial}T23:59:00Z`) : null;
      const how = `${plan.name}, paid ${interval === "year" ? "yearly" : "monthly"}`;

      if (live) {
        if (!(await stripeConfigured())) throw new FormError("Stripe isn't connected, so their subscription can't be changed from here.");
        if (trialChanged && agency.subscriptionStatus !== "TRIALING")
          throw new FormError("Their free trial is over and they're paying, so there's no trial to change.");
        if (plan.key !== agency.plan || interval !== agency.billingInterval || agency.billingMode !== "STRIPE") {
          await moveSubscription(agencyId, agency.stripeSubscriptionId!, plan, interval, "create_prorations");
        }
        if (trialChanged && trialEnd) await setStripeTrial(agency.stripeSubscriptionId!, trialEnd);
        await log(how);
        revalidatePath("/owner", "layout");
        return { ok: `${agency.name} is on ${how}. Stripe has their subscription and adjusts their next bill for the days left.` };
      }

      // No subscription: set the plan and trial. They're asked to add a card when the trial ends.
      const startingFresh = agency.billingMode !== "STRIPE" || !agency.trialEndsAt;
      const trialEndsAt = trialEnd ?? (startingFresh ? new Date(Date.now() + catalogue.trialDays * DAY) : agency.trialEndsAt);
      await prisma.agency.update({
        where: { id: agencyId },
        data: {
          billingMode: "STRIPE",
          plan: plan.key,
          billingInterval: interval,
          includedUsers: plan.includedUsers,
          extraUserYearlyMinor: catalogue.extraUserYearlyMinor,
          trialEndsAt,
        },
      });
      await log(how);
      revalidatePath("/owner", "layout");
      const ends = trialEndsAt ? trialEndsAt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" }) : "";
      return {
        ok:
          trialEndsAt && trialEndsAt.getTime() > Date.now()
            ? `${agency.name} is on ${how}. Their free trial runs to ${ends}; they'll be asked to add a card before then.`
            : `${agency.name} is on ${how}. Their trial is over, so they'll be asked to add a card next time they sign in.`,
      };
    }),
  );
}

/** Move a trialing subscription's trial end in Stripe (or end it now, which charges them). */
async function setStripeTrial(subscriptionId: string, end: Date | "now") {
  const at = end === "now" || end.getTime() <= Date.now() + 60_000 ? "now" : Math.floor(end.getTime() / 1000);
  const updated = await stripe<StripeSubscription>("POST", `subscriptions/${subscriptionId}`, { trial_end: at, proration_behavior: "none" });
  await applySubscription(updated);
}

/** Quick trial buttons: add days, or end it today. */
export async function adjustTrial(agencyId: string, _: FormState, form: FormData): Promise<FormState> {
  const owner = await requireOwner();
  return handleForm(() =>
    friendly(async () => {
      const agency = await prisma.agency.findUniqueOrThrow({ where: { id: agencyId } });
      if (agency.billingMode !== "STRIPE") throw new FormError("Only businesses on a plan have a free trial.");
      const live = hasLiveSubscription(agency);
      if (live && agency.subscriptionStatus !== "TRIALING") throw new FormError("Their free trial is over and they're paying, so there's no trial to change.");
      const what = str(form, "trial");
      const now = Date.now();
      let end: Date;
      if (what === "end") end = new Date(now);
      else {
        const days = Number(what);
        if (!Number.isInteger(days) || days < 1 || days > 365) throw new FormError("Choose how many days to add");
        // Added on to whatever's left, or from today if it's already over.
        end = new Date(Math.max(now, agency.trialEndsAt?.getTime() ?? now) + days * DAY);
      }
      if (live) {
        if (!(await stripeConfigured())) throw new FormError("Stripe isn't connected, so their trial can't be changed from here.");
        await setStripeTrial(agency.stripeSubscriptionId!, what === "end" ? "now" : end);
      }
      await prisma.agency.update({ where: { id: agencyId }, data: { trialEndsAt: end } });
      await logActivity({ id: owner.id, agencyId }, "AGENCY", agencyId, what === "end" ? "trial ended by Gigsaw" : "trial extended by Gigsaw", dateOnly(end));
      revalidatePath("/owner", "layout");
      if (what === "end") {
        return { ok: live ? "Trial ended. Stripe charges their card now." : "Trial ended. They'll be asked to add a card next time they sign in." };
      }
      return { ok: `Trial now ends ${end.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" })}.` };
    }),
  );
}

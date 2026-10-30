"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { logActivity, prisma } from "@/lib/db";
import { couponParams, DiscountError, describeDiscount, parseDiscount, promotionCodeParams } from "@/lib/discounts";
import { FormError, handleForm, str, type FormState } from "@/lib/forms";
import { allPlans } from "@/lib/plan-store";
import { findPlan } from "@/lib/plans";
import { ensureProduct, stripe, stripeConfigured, StripeError } from "@/lib/stripe";
import { hasLiveSubscription } from "@/lib/subscription";
import { applySubscription, type StripeSubscription } from "@/lib/subscription-sync";

// Discount codes (Owner area → Discount codes): each is a Stripe coupon (how much comes off, for
// how long, which plans) plus a promotion code (the word customers type at checkout, with its
// expiry and limit). Also putting a discount straight onto one business's subscription.

async function needStripe() {
  if (!(await stripeConfigured())) throw new FormError("Stripe isn't connected yet. Connect it in Owner → Stripe first.");
}

async function friendly<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof DiscountError) throw new FormError(e.message);
    if (e instanceof StripeError) throw new FormError(`Stripe said: ${e.message}`);
    throw e;
  }
}

export async function createDiscountCode(_: FormState, form: FormData): Promise<FormState> {
  const owner = await requireOwner();
  return handleForm(() =>
    friendly(async () => {
      await needStripe();
      const spec = parseDiscount({
        code: str(form, "code"),
        kind: str(form, "kind"),
        percent: str(form, "percent"),
        amount: str(form, "amount"),
        duration: str(form, "duration"),
        months: str(form, "months"),
        expires: str(form, "expires"),
        maxRedemptions: str(form, "maxRedemptions"),
        planKeys: form.getAll("plans").map(String),
      });
      if (await prisma.discountCode.findUnique({ where: { code: spec.code } }))
        throw new FormError(`There's already a code called ${spec.code}. Choose another.`);
      const plans = await allPlans();
      for (const k of spec.planKeys) if (!findPlan(plans, k)) throw new FormError("One of the plans chosen has gone. Reload the page.");
      // A code limited to some plans needs those plans' products in Stripe.
      const products = [];
      for (const k of spec.planKeys) products.push(await ensureProduct(k));
      const coupon = await stripe<{ id: string }>("POST", "coupons", couponParams(spec, products));
      let promo: { id: string };
      try {
        promo = await stripe<{ id: string }>("POST", "promotion_codes", promotionCodeParams(spec, coupon.id));
      } catch (e) {
        // Don't leave a coupon behind with no code.
        await stripe("DELETE", `coupons/${coupon.id}`).catch(() => null);
        throw e;
      }
      await prisma.discountCode.create({
        data: {
          code: spec.code,
          percentOff: spec.percentOff,
          amountOffMinor: spec.amountOffMinor,
          currency: spec.currency,
          duration: spec.duration,
          durationMonths: spec.durationMonths,
          expiresAt: spec.expiresAt,
          maxRedemptions: spec.maxRedemptions,
          planKeys: spec.planKeys,
          stripeCouponId: coupon.id,
          stripePromotionCodeId: promo.id,
        },
      });
      await logActivity({ id: owner.id, agencyId: null }, "DISCOUNT", spec.code, "discount code made", describeDiscount(spec));
      revalidatePath("/owner/discounts");
      return { ok: `${spec.code} is ready: ${describeDiscount(spec)}. Customers type it when they add their card.` };
    }),
  );
}

/** Switch a code off (customers can't use it any more; anyone already given it keeps their discount) or back on. */
export async function setDiscountCodeActive(id: string, active: boolean, _: FormState): Promise<FormState> {
  const owner = await requireOwner();
  return handleForm(() =>
    friendly(async () => {
      await needStripe();
      const code = await prisma.discountCode.findUniqueOrThrow({ where: { id } });
      await stripe("POST", `promotion_codes/${code.stripePromotionCodeId}`, { active });
      await prisma.discountCode.update({ where: { id }, data: { active } });
      await logActivity({ id: owner.id, agencyId: null }, "DISCOUNT", code.code, active ? "discount code switched on" : "discount code switched off");
      revalidatePath("/owner/discounts");
      return { ok: active ? `${code.code} is on again.` : `${code.code} is off. Businesses already using it keep their discount.` };
    }),
  );
}

async function liveAgency(agencyId: string) {
  const agency = await prisma.agency.findUniqueOrThrow({ where: { id: agencyId } });
  if (agency.billingMode !== "STRIPE" || !hasLiveSubscription(agency)) {
    throw new FormError("Discounts go on a card subscription, and this business doesn't have one yet.");
  }
  return agency;
}

/** Put one of the discount codes' discounts straight onto this business's subscription. Replaces any discount it has. */
export async function applyDiscount(agencyId: string, _: FormState, form: FormData): Promise<FormState> {
  const owner = await requireOwner();
  return handleForm(() =>
    friendly(async () => {
      await needStripe();
      const agency = await liveAgency(agencyId);
      const code = await prisma.discountCode.findUnique({ where: { id: str(form, "discount") } });
      if (!code) throw new FormError("Choose a discount");
      const updated = await stripe<StripeSubscription>("POST", `subscriptions/${agency.stripeSubscriptionId}`, { coupon: code.stripeCouponId });
      await applySubscription(updated);
      await logActivity({ id: owner.id, agencyId }, "AGENCY", agencyId, "discount applied by Gigsaw", code.code);
      revalidatePath(`/owner/businesses/${agencyId}`);
      return { ok: `${code.code} applied: ${describeDiscount(code)}. It shows on their next bill.` };
    }),
  );
}

export async function removeDiscount(agencyId: string, _: FormState): Promise<FormState> {
  const owner = await requireOwner();
  return handleForm(() =>
    friendly(async () => {
      await needStripe();
      const agency = await liveAgency(agencyId);
      await stripe("DELETE", `subscriptions/${agency.stripeSubscriptionId}/discount`);
      await logActivity({ id: owner.id, agencyId }, "AGENCY", agencyId, "discount removed by Gigsaw");
      revalidatePath(`/owner/businesses/${agencyId}`);
      return { ok: "Discount removed. Their next bill is at the full price." };
    }),
  );
}

"use server";

import { redirect } from "next/navigation";
import { createSession, hashPassword } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { addDemoData } from "@/lib/demo";
import { FormError, handleForm, required, str, type FormState } from "@/lib/forms";
import { EXTRA_USER_YEARLY_MINOR, planByKey, PLANS, TRIAL_DAYS } from "@/lib/plans";

const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

/** A new business signs up from the website: its account, its first admin, and a free trial. */
export async function signUp(_: FormState, form: FormData): Promise<FormState> {
  const res = await handleForm(async () => {
    if (str(form, "company_site")) return; // a hidden field only bots fill in
    const name = required(form, "business", "Business name");
    const adminName = required(form, "name", "Your name");
    const email = required(form, "email", "Email").toLowerCase();
    if (!isEmail(email)) throw new FormError("Check your email address");
    const password = str(form, "password");
    if (password.length < 8) throw new FormError("Choose a password of at least 8 characters");
    if (await prisma.user.findUnique({ where: { email } })) throw new FormError("That email already has a Gigsaw login. Sign in instead.");
    if (str(form, "terms") !== "on") throw new FormError("Please agree to the terms to carry on");
    const plan = planByKey(str(form, "plan")) ?? PLANS[1];
    const interval = str(form, "interval") === "year" ? "year" : "month";
    const passwordHash = await hashPassword(password);

    const admin = await prisma.$transaction(async (tx) => {
      const agency = await tx.agency.create({
        data: {
          name,
          billingMode: "STRIPE",
          plan: plan.key,
          billingInterval: interval,
          trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 86_400_000),
          subscriptionStatus: "NONE",
          includedUsers: plan.includedUsers,
          extraUserYearlyMinor: EXTRA_USER_YEARLY_MINOR,
          billingEmail: email,
        },
      });
      await tx.settings.create({ data: { agencyId: agency.id, agencyName: name, agencyEmail: email } });
      return tx.user.create({ data: { email, name: adminName, role: "ADMIN", agencyId: agency.id, passwordHash, phone: str(form, "phone") } });
    });
    if (str(form, "demo") === "on") await addDemoData(prisma, { agencyId: admin.agencyId!, leadAgentId: admin.id });
    await prisma.activity.create({
      data: {
        userId: admin.id,
        agencyId: admin.agencyId,
        entity: "AGENCY",
        entityId: admin.agencyId!,
        action: "signed up",
        detail: `${plan.name}, ${interval}ly trial`,
      },
    });
    await createSession(admin.id);
  });
  if (res?.error) return res;
  redirect("/dashboard?welcome=1");
}

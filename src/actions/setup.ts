"use server";

import { redirect } from "next/navigation";
import { createSession, hashPassword } from "@/lib/auth";
import { logActivity, prisma } from "@/lib/db";
import { FormError, handleForm, required, type FormState } from "@/lib/forms";

/** First run only: create the agency and its first admin. Refused once any login exists. */
export async function setupAgency(_: FormState, form: FormData): Promise<FormState> {
  let userId = "";
  const res = await handleForm(async () => {
    const agencyName = required(form, "agencyName", "Agency name");
    const name = required(form, "name", "Your name");
    const email = required(form, "email", "Email").toLowerCase();
    const password = required(form, "password", "Password");
    if (password.length < 8) throw new FormError("Password must be at least 8 characters");
    const passwordHash = await hashPassword(password);

    userId = await prisma.$transaction(async (tx) => {
      if ((await tx.user.count()) > 0) throw new FormError("Gigsaw is already set up. Sign in instead.");
      await tx.settings.upsert({ where: { id: 1 }, update: { agencyName, agencyEmail: email }, create: { id: 1, agencyName, agencyEmail: email } });
      const user = await tx.user.create({ data: { email, name, role: "ADMIN", passwordHash } });
      return user.id;
    });
    await logActivity(userId, "SETTINGS", "1", "set up Gigsaw");
  });
  if (res?.error) return res;
  await createSession(userId);
  redirect("/dashboard");
}

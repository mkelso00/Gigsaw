"use server";

import { redirect } from "next/navigation";
import { createSession, hashPassword } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { FormError, handleForm, required, type FormState } from "@/lib/forms";

/** First run only: create the platform owner. Refused once any login exists. */
export async function setupOwner(_: FormState, form: FormData): Promise<FormState> {
  let userId = "";
  const res = await handleForm(async () => {
    const name = required(form, "name", "Your name");
    const email = required(form, "email", "Email").toLowerCase();
    const password = required(form, "password", "Password");
    if (password.length < 8) throw new FormError("Password must be at least 8 characters");
    const passwordHash = await hashPassword(password);
    userId = await prisma.$transaction(async (tx) => {
      if ((await tx.user.count()) > 0) throw new FormError("Gigsaw is already set up. Sign in instead.");
      const user = await tx.user.create({ data: { email, name, role: "ADMIN", isOwner: true, passwordHash } });
      return user.id;
    });
  });
  if (res?.error) return res;
  await createSession(userId);
  redirect("/owner");
}

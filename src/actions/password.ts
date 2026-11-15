"use server";

import { redirect } from "next/navigation";
import { createSession, hashPassword, homePath } from "@/lib/auth";
import { logActivity, prisma } from "@/lib/db";
import { FormError, handleForm, required, type FormState } from "@/lib/forms";
import { findUsableReset, sendResetLink } from "@/lib/reset";

const USED_UP = "This link has expired or has already been used. Ask for a new one.";
const SAME_ANSWER = "If that email has a Gigsaw login, a reset link is on its way. It works for one hour.";

/** Email a reset link. Gives the same answer whether or not the email exists. */
export async function requestPasswordReset(_: FormState, form: FormData): Promise<FormState> {
  return handleForm(async () => {
    const email = required(form, "email", "Email").toLowerCase();
    const user = await prisma.user.findUnique({ where: { email } });
    if (user) await sendResetLink(user);
    return { ok: SAME_ANSWER };
  });
}

export async function resetPassword(token: string, _: FormState, form: FormData): Promise<FormState> {
  let home = "/login";
  const res = await handleForm(async () => {
    const password = required(form, "password", "New password");
    if (password.length < 8) throw new FormError("Password must be at least 8 characters");
    if (password !== required(form, "confirm", "Confirm password")) throw new FormError("The two passwords don't match");
    const reset = await findUsableReset(token);
    if (!reset) throw new FormError(USED_UP);
    const passwordHash = await hashPassword(password);
    await prisma.$transaction(async (tx) => {
      // Take the link first, so of two submits at once only one sets a password.
      const took = await tx.passwordReset.updateMany({ where: { id: reset.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
      if (took.count !== 1) throw new FormError(USED_UP);
      await tx.user.update({ where: { id: reset.userId }, data: { passwordHash } });
      // Used up, along with any other links for this login; sign out everywhere.
      await tx.passwordReset.updateMany({ where: { userId: reset.userId, usedAt: null }, data: { usedAt: new Date() } });
      await tx.session.deleteMany({ where: { userId: reset.userId } });
    });
    // An act setting up the login they asked for at /start (it had no password until now).
    const u = reset.user;
    if (!u.passwordHash && u.role === "ARTIST" && (u.artistId || u.personId)) {
      await logActivity(u, u.artistId ? "ARTIST" : "PERSON", (u.artistId ?? u.personId)!, "set up their app login", u.email);
    }
    await createSession(reset.userId);
    home = homePath(reset.user);
  });
  if (res?.error) return res;
  redirect(home);
}

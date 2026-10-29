"use server";

import { redirect } from "next/navigation";
import { createSession, hashPassword, homePath } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { FormError, handleForm, required, type FormState } from "@/lib/forms";
import { appUrl, sendEmail } from "@/lib/messaging";
import { createResetToken, findUsableReset } from "@/lib/reset";

const SAME_ANSWER = "If that email has a Gigsaw login, a reset link is on its way. It works for one hour.";

/** Email a reset link. Gives the same answer whether or not the email exists. */
export async function requestPasswordReset(_: FormState, form: FormData): Promise<FormState> {
  return handleForm(async () => {
    const email = required(form, "email", "Email").toLowerCase();
    const user = await prisma.user.findUnique({ where: { email } });
    if (user) {
      const token = await createResetToken(user.id);
      if (token) {
        const link = `${appUrl()}/reset-password/${token}`;
        await sendEmail({
          kind: "PASSWORD_RESET",
          to: user.email,
          subject: "Reset your Gigsaw password",
          text: `Hi ${user.name.split(" ")[0]},\n\nSomeone asked to reset the password for your Gigsaw login. If that was you, choose a new password here:\n\n${link}\n\nThe link works once and expires in one hour. If you didn't ask for this, you can ignore this email and your password stays the same.`,
        });
      }
    }
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
    if (!reset) throw new FormError("This link has expired or has already been used. Ask for a new one.");
    await prisma.$transaction([
      prisma.user.update({ where: { id: reset.userId }, data: { passwordHash: await hashPassword(password) } }),
      // Used up, along with any other links for this login; sign out everywhere.
      prisma.passwordReset.updateMany({ where: { userId: reset.userId, usedAt: null }, data: { usedAt: new Date() } }),
      prisma.session.deleteMany({ where: { userId: reset.userId } }),
    ]);
    await createSession(reset.userId);
    home = homePath(reset.user);
  });
  if (res?.error) return res;
  redirect(home);
}

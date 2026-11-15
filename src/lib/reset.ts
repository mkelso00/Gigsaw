import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "./db";
import { appUrl, sendEmail } from "./messaging";

export const HOUR = 3_600_000;

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Make a single-use reset token, valid for an hour unless `ttlMs` says otherwise. Only its hash
 * is kept. Returns null if too many were asked for recently.
 */
export async function createResetToken(userId: string, ttlMs = HOUR) {
  const recent = await prisma.passwordReset.count({ where: { userId, createdAt: { gte: new Date(Date.now() - HOUR) } } });
  if (recent >= 3) return null;
  const token = randomBytes(32).toString("base64url");
  await prisma.passwordReset.create({ data: { userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + ttlMs) } });
  return token;
}

/** The reset record for a token, if it's still usable. */
export async function findUsableReset(token: string) {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const reset = await prisma.passwordReset.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!reset || reset.usedAt || reset.expiresAt < new Date()) return null;
  return reset;
}

/** Email a login a one-hour link to choose a new password. False if too many were asked for recently. */
export async function sendResetLink(user: { id: string; name: string; email: string }) {
  const token = await createResetToken(user.id);
  if (!token) return false;
  const link = `${appUrl()}/reset-password/${token}`;
  await sendEmail({
    kind: "PASSWORD_RESET",
    to: user.email,
    subject: "Reset your Gigsaw password",
    email: {
      preheader: "Choose a new password. The link works for one hour.",
      title: "Reset your password",
      intro: `Hi ${user.name.split(" ")[0]}, someone asked to reset the password for your Gigsaw login. If that was you, choose a new one below.`,
      cta: { label: "Choose a new password", url: link },
      outro: "The link works once and expires in one hour.",
      footnote: "Didn't ask for this? You can ignore this email and your password stays the same.",
    },
  });
  return true;
}

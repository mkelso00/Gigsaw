import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "./db";

const HOUR = 3_600_000;

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

/** Make a single-use reset token valid for one hour. Returns null if too many were asked for recently. */
export async function createResetToken(userId: string) {
  const recent = await prisma.passwordReset.count({ where: { userId, createdAt: { gte: new Date(Date.now() - HOUR) } } });
  if (recent >= 3) return null;
  const token = randomBytes(32).toString("base64url");
  await prisma.passwordReset.create({ data: { userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + HOUR) } });
  return token;
}

/** The reset record for a token, if it's still usable. */
export async function findUsableReset(token: string) {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const reset = await prisma.passwordReset.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!reset || reset.usedAt || reset.expiresAt < new Date()) return null;
  return reset;
}

"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { createSession, destroySession, homePath, verifyPassword } from "@/lib/auth";
import { clientIp } from "@/lib/client-ip";
import { str, type FormState } from "@/lib/forms";
import { LOGIN_WINDOW_MS, lockedMessage, lockedUntil, MAX_PER_EMAIL, MAX_PER_IP } from "@/lib/login-limit";

/** When sign-in opens again for this email or IP address, or null if it's open. */
async function loginLockedUntil(emailKey: string, ipKey: string) {
  const check = async (key: string, max: number) => {
    const since = new Date(Date.now() - LOGIN_WINDOW_MS);
    const rows = await prisma.loginAttempt.findMany({ where: { key, createdAt: { gt: since } }, orderBy: { createdAt: "desc" }, take: max });
    const times = rows.map((r) => r.createdAt);
    return lockedUntil(times, max);
  };
  const [byEmail, byIp] = await Promise.all([check(emailKey, MAX_PER_EMAIL), check(ipKey, MAX_PER_IP)]);
  if (!byEmail || !byIp) return byEmail ?? byIp;
  return byEmail > byIp ? byEmail : byIp;
}

// Old attempts are cleared out at most once a minute per server.
let lastPrune = 0;
async function pruneAttempts() {
  if (Date.now() - lastPrune < 60_000) return;
  lastPrune = Date.now();
  await prisma.loginAttempt.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - LOGIN_WINDOW_MS) } } });
}

export async function login(_: FormState, form: FormData): Promise<FormState> {
  const email = str(form, "email").toLowerCase();
  const password = str(form, "password");
  if (!email || !password) return { error: "Enter your email and password." };
  const emailKey = `email:${email.slice(0, 254)}`;
  const ipKey = `ip:${clientIp(await headers())}`;
  // Too many failures: refuse without checking the password, and don't count this one, so the
  // wait doesn't grow while someone keeps trying.
  const until = await loginLockedUntil(emailKey, ipKey);
  if (until) return { error: lockedMessage(until) };
  const user = await prisma.user.findUnique({ where: { email } });
  // Same message either way so we don't reveal which emails exist. A login made with Google or
  // Microsoft has no password until one is set.
  if (!user || !user.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
    await prisma.loginAttempt.createMany({ data: [{ key: emailKey }, { key: ipKey }] });
    await pruneAttempts();
    return { error: "That email and password don't match." };
  }
  await prisma.loginAttempt.deleteMany({ where: { key: emailKey } });
  await createSession(user.id);
  redirect(homePath(user));
}

export async function logout() {
  await destroySession();
  redirect("/login");
}

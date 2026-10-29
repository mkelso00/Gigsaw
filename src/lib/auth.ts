import "server-only";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { prisma } from "./db";
import type { Role } from "./constants";

export const SESSION_COOKIE = "gigsaw_session";
const SESSION_DAYS = 30;

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await prisma.session.create({ data: { token, userId, expiresAt } });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await prisma.session.deleteMany({ where: { token } });
  jar.delete(SESSION_COOKIE);
}

/** The signed-in user, or null. Cached per request. */
export const currentUser = cache(async () => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.session.findUnique({ where: { token }, include: { user: true } });
  if (!session || session.expiresAt < new Date()) return null;
  return session.user;
});

export type CurrentUser = NonNullable<Awaited<ReturnType<typeof currentUser>>>;

export async function requireUser(roles?: Role[]): Promise<CurrentUser> {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (roles && !roles.includes(user.role as Role)) {
    redirect(user.role === "ARTIST" ? "/app" : "/dashboard");
  }
  return user;
}

/** Agency staff only (admins and agents). */
export function requireStaff() {
  return requireUser(["ADMIN", "AGENT"]);
}

export function requireAdmin() {
  return requireUser(["ADMIN"]);
}

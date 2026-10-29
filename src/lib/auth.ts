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

/** The signed-in user (with their agency), or null. Cached per request. */
export const currentUser = cache(async () => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.session.findUnique({ where: { token }, include: { user: { include: { agency: true } } } });
  if (!session || session.expiresAt < new Date()) return null;
  return session.user;
});

export type CurrentUser = NonNullable<Awaited<ReturnType<typeof currentUser>>>;
/** A user who belongs to an agency. Every agency query must filter on `agencyId`. */
export type AgencyUser = CurrentUser & { agencyId: string };

/** Where a user lands after signing in. */
export function homePath(user: { role: string; agencyId: string | null; isOwner: boolean }) {
  if (!user.agencyId) return user.isOwner ? "/owner" : "/login";
  return user.role === "ARTIST" ? "/app" : "/dashboard";
}

/** Any signed-in user, including an owner who doesn't belong to an agency. */
export async function requireSignedIn(): Promise<CurrentUser> {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

/** A signed-in member of an active agency, optionally limited to some roles. */
export async function requireUser(roles?: Role[]): Promise<AgencyUser> {
  const user = await requireSignedIn();
  if (!user.agencyId || !user.agency) redirect(user.isOwner ? "/owner" : "/login");
  if (user.agency.status !== "ACTIVE") redirect("/suspended");
  if (roles && !roles.includes(user.role as Role)) redirect(homePath(user));
  return user as AgencyUser;
}

/** Agency staff only (admins and agents). */
export function requireStaff() {
  return requireUser(["ADMIN", "AGENT"]);
}

export function requireAdmin() {
  return requireUser(["ADMIN"]);
}

/** The platform owner: runs the Owner area, creates agencies and bills them. */
export async function requireOwner(): Promise<CurrentUser> {
  const user = await requireSignedIn();
  if (!user.isOwner) redirect(homePath(user));
  return user;
}

import "server-only";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { lockDecision } from "./billing-lock";
import { prisma } from "./db";
import { ShownFormError } from "./forms";
import type { Role } from "./constants";
import { env } from "@/server/env";

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
    secure: env().isProduction,
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

/** Sign this login out everywhere except here (e.g. after a password change). */
export async function endOtherSessions(userId: string) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value ?? "";
  await prisma.session.deleteMany({ where: { userId, token: { not: token } } });
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

type Access = {
  /**
   * Open even when the business's trial has ended or its subscription stopped: only for Plan and
   * its billing actions, Profile and the pages around them. See src/lib/billing-lock.ts.
   */
  allowLocked?: boolean;
};

/**
 * A signed-in member of an active agency, optionally limited to some roles. A business that has
 * to choose a plan first is sent to Plan from a page, and refused with a message from an action.
 */
export async function requireUser(roles?: Role[], access: Access = {}): Promise<AgencyUser> {
  const user = await requireSignedIn();
  if (!user.agencyId || !user.agency) redirect(user.isOwner ? "/owner" : "/login");
  if (user.agency.status !== "ACTIVE") redirect("/suspended");
  if (roles && !roles.includes(user.role as Role)) redirect(homePath(user));
  // Server actions are posted with a Next-Action header; pages and route handlers aren't.
  const inAction = !!(await headers()).get("next-action");
  const lock = lockDecision(user, { allowLocked: access.allowLocked, inAction });
  // A ShownFormError reaches the form as a message even when thrown before the action's own handleForm.
  if (lock.kind === "refuse") throw new ShownFormError(lock.message);
  if (lock.kind === "redirect") redirect(lock.to);
  return user as AgencyUser;
}

/** Agency staff only (admins and agents). */
export function requireStaff(access?: Access) {
  return requireUser(["ADMIN", "AGENT"], access);
}

export function requireAdmin(access?: Access) {
  return requireUser(["ADMIN"], access);
}

/** The platform owner: runs the Owner area, creates agencies and bills them. */
export async function requireOwner(): Promise<CurrentUser> {
  const user = await requireSignedIn();
  if (!user.isOwner) redirect(homePath(user));
  return user;
}

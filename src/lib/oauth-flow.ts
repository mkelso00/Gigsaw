import "server-only";
import { cookies } from "next/headers";
import { randomToken, readSigned, signValue, type Identity, type OAuthFlow, PROVIDERS, type ProviderKey } from "./oauth";
import { prisma } from "./db";

// The database and cookie side of signing in with Google or Microsoft. See src/lib/oauth.ts.

const FLOW_COOKIE = "gigsaw_oauth";
const SIGNUP_COOKIE = "gigsaw_oauth_signup";
const SIGNUP_MINUTES = 30;

let cachedKey: string | null = null;

/** The key that signs our short-lived OAuth cookies. Made once and kept in the database. */
async function cookieKey(): Promise<string> {
  if (cachedKey) return cachedKey;
  const stored = await prisma.appSecret.findUnique({ where: { key: "oauth_cookie" } });
  if (stored) return (cachedKey = stored.value);
  // Two servers starting at once could both get here: whichever saves first wins.
  await prisma.appSecret.createMany({ data: [{ key: "oauth_cookie", value: randomToken(48) }], skipDuplicates: true });
  return (cachedKey = (await prisma.appSecret.findUniqueOrThrow({ where: { key: "oauth_cookie" } })).value);
}

const cookieOptions = (maxAgeSeconds: number, path: string) => ({
  httpOnly: true,
  // Lax: sent when the provider redirects the browser back to us (a top-level GET).
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path,
  maxAge: maxAgeSeconds,
});

export async function saveFlow(flow: OAuthFlow) {
  const jar = await cookies();
  jar.set(FLOW_COOKIE, signValue(flow, await cookieKey()), cookieOptions(Math.ceil((flow.exp - Date.now()) / 1000), "/api/auth"));
}

/** The flow this browser started, if it's still valid. Used up on reading. */
export async function takeFlow(): Promise<OAuthFlow | null> {
  const jar = await cookies();
  const flow = readSigned<OAuthFlow>(jar.get(FLOW_COOKIE)?.value, await cookieKey());
  jar.set(FLOW_COOKIE, "", cookieOptions(0, "/api/auth"));
  return flow;
}

/** Someone who signed up with Google or Microsoft: who they are, kept while they fill in the rest. */
export type PendingSignup = { provider: ProviderKey; subject: string; email: string; name: string; exp: number };

export async function savePendingSignup(id: Identity) {
  const value: PendingSignup = { provider: id.provider, subject: id.subject, email: id.email, name: id.name, exp: Date.now() + SIGNUP_MINUTES * 60_000 };
  (await cookies()).set(SIGNUP_COOKIE, signValue(value, await cookieKey()), cookieOptions(SIGNUP_MINUTES * 60, "/"));
}

export async function pendingSignup(): Promise<PendingSignup | null> {
  return readSigned<PendingSignup>((await cookies()).get(SIGNUP_COOKIE)?.value, await cookieKey());
}

export async function clearPendingSignup() {
  (await cookies()).set(SIGNUP_COOKIE, "", cookieOptions(0, "/"));
}

/**
 * The Gigsaw login for a provider account: by its subject if it's been used before, otherwise by
 * its email (any case) when the provider has confirmed the email. A match by email is linked, so
 * next time it's found by subject.
 */
export async function findUserForIdentity(id: Identity) {
  const db = PROVIDERS[id.provider].db;
  const linked = await prisma.linkedAccount.findUnique({ where: { provider_subject: { provider: db, subject: id.subject } }, include: { user: true } });
  if (linked) {
    await prisma.linkedAccount.update({ where: { id: linked.id }, data: { lastUsedAt: new Date(), email: id.email || linked.email } });
    return { user: linked.user, problem: null };
  }
  if (!id.email) return { user: null, problem: "no_account" as const };
  if (!id.emailVerified) return { user: null, problem: "unverified" as const };
  const user = await userByEmail(id.email);
  if (!user) return { user: null, problem: "no_account" as const };
  // Someone can have two accounts at a provider with the same email (e.g. a personal and a work
  // Microsoft account). The confirmed email is enough to sign in; the first one stays the linked one.
  await prisma.linkedAccount.createMany({
    data: [{ userId: user.id, provider: db, subject: id.subject, email: id.email, lastUsedAt: new Date() }],
    skipDuplicates: true,
  });
  return { user, problem: null };
}

/** A login by email, ignoring case. Emails are saved in lower case, but older ones may not be. */
export async function userByEmail(email: string) {
  const lower = email.trim().toLowerCase();
  const exact = await prisma.user.findUnique({ where: { email: lower } });
  if (exact) return exact;
  const matches = await prisma.user.findMany({ where: { email: { equals: lower, mode: "insensitive" } }, take: 2 });
  return matches.length === 1 ? matches[0] : null;
}

/** Connect a provider account to someone already signed in (from Profile). */
export async function linkToUser(userId: string, id: Identity): Promise<"connected" | "taken"> {
  const db = PROVIDERS[id.provider].db;
  const other = await prisma.linkedAccount.findUnique({ where: { provider_subject: { provider: db, subject: id.subject } } });
  if (other && other.userId !== userId) return "taken";
  await prisma.linkedAccount.upsert({
    where: { userId_provider: { userId, provider: db } },
    create: { userId, provider: db, subject: id.subject, email: id.email, lastUsedAt: new Date() },
    update: { subject: id.subject, email: id.email, lastUsedAt: new Date() },
  });
  return "connected";
}

/** Every way this person can sign in: a password, and each connected provider. */
export async function signInMethods(user: { id: string; passwordHash: string }) {
  const linked = await prisma.linkedAccount.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });
  return { hasPassword: !!user.passwordHash, linked, count: (user.passwordHash ? 1 : 0) + linked.length };
}

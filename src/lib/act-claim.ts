import "server-only";
import { Prisma } from "@prisma/client";
import { prisma, logActivity } from "./db";
import { LOGIN_WINDOW_MS, lockedUntil } from "./login-limit";
import { appUrl, sendEmail } from "./messaging";
import { linkActLoginQuietly } from "./login-person";
import { userByEmail } from "./oauth-flow";
import { personName } from "./person-name";
import { createResetToken, HOUR, sendResetLink } from "./reset";

// "First time? Set up your login": an act types the email their agency already has for them and
// Gigsaw emails a link to set their own password, so nobody has to make passwords for acts.
//
// The email can be an act's (Artist.email) or a person's in an act (Person.email) with no login
// yet. The login is made straight away, without a password, linked to that act or person in that
// agency, and the link is an ordinary password reset token (only its hash is kept, it works once
// and lasts 24 hours). A login with no password can't be signed in to, so nothing is open until
// whoever reads that inbox sets one. An email that already has a login gets a normal reset link.
//
// Logins are unique by email across Gigsaw, so one email can only be one login. If it's on file
// with more than one agency, the login goes with the act first added to Gigsaw (the agency they've
// been with longest), and the email names the others so the act can ask them for a different email.
//
// The page gives the same answer whatever happens, and the work is done after the answer has gone
// (see actions/claim.ts), so neither the words nor the time taken say whether an email is on file.

export const CLAIM_HOURS = 24;

/** What the page always says, whether or not the email matched. */
export const CLAIM_ANSWER = `Thanks. If that email is on file with an agency on Gigsaw, we've sent a link to set your password. It works for ${CLAIM_HOURS} hours. Nothing there? Check your junk folder, or ask your agency which email they have for you.`;

// Requests allowed in the sign-in window (15 minutes), counted whether or not the email matched.
export const CLAIM_MAX_PER_EMAIL = 3;
export const CLAIM_MAX_PER_IP = 20;

const emailKey = (email: string) => `claim-email:${email.slice(0, 254)}`;
const ipKey = (ip: string) => `claim-ip:${ip}`;

/** When this email or address may ask again, or null if it can now. */
export async function claimLockedUntil(email: string, ip: string) {
  const since = new Date(Date.now() - LOGIN_WINDOW_MS);
  const check = async (key: string, max: number) => {
    const rows = await prisma.loginAttempt.findMany({ where: { key, createdAt: { gt: since } }, orderBy: { createdAt: "desc" }, take: max });
    return lockedUntil(
      rows.map((r) => r.createdAt),
      max,
    );
  };
  const times = (await Promise.all([check(emailKey(email), CLAIM_MAX_PER_EMAIL), check(ipKey(ip), CLAIM_MAX_PER_IP)])).filter((d): d is Date => !!d);
  return times.length ? new Date(Math.max(...times.map((d) => d.getTime()))) : null;
}

/** Count a request (old ones are cleared with the sign-in attempts, see actions/auth.ts). */
export async function recordClaimAttempt(email: string, ip: string) {
  await prisma.loginAttempt.createMany({ data: [{ key: emailKey(email) }, { key: ipKey(ip) }] });
}

export function claimLockedMessage(until: Date, now = new Date()) {
  const minutes = Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 60_000));
  return `Too many tries. Please wait ${minutes} minute${minutes === 1 ? "" : "s"} and try again.`;
}

type Target = { kind: "act" | "person"; id: string; name: string; agencyId: string };

/** Acts and people in acts with this email and no login, in active agencies, the earliest added first. */
async function claimTargets(email: string): Promise<Target[]> {
  const match = { email: { equals: email, mode: "insensitive" as const }, login: { is: null }, demo: false, agency: { status: "ACTIVE" } };
  const [acts, people] = await Promise.all([
    prisma.artist.findMany({ where: match, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, name: true, agencyId: true } }),
    // Only people who are in an act: a venue manager or a customer is a person too, but has no act app.
    prisma.person.findMany({
      where: { ...match, acts: { some: {} } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, firstName: true, surname: true, alias: true, agencyId: true },
    }),
  ]);
  return [
    ...acts.map((a) => ({ kind: "act" as const, id: a.id, name: a.name, agencyId: a.agencyId })),
    ...people.map((p) => ({ kind: "person" as const, id: p.id, name: personName(p), agencyId: p.agencyId })),
  ];
}

const isUniqueClash = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

export type ClaimResult = "claim" | "reset" | "none" | "limited";

/** Match the email and send the right link. What happened is only for tests and logs, never shown. */
export async function sendClaimLink(rawEmail: string): Promise<ClaimResult> {
  const email = rawEmail.trim().toLowerCase();
  const existing = await userByEmail(email);
  if (existing) return linkFor(existing);

  const targets = await claimTargets(email);
  const pick = targets[0];
  if (!pick) return "none";
  let user;
  try {
    user = await prisma.user.create({
      data: {
        email,
        name: pick.name,
        // No password until they set one from the link, so the login can't be used before then.
        passwordHash: "",
        role: "ARTIST",
        agencyId: pick.agencyId,
        ...(pick.kind === "act" ? { artistId: pick.id } : { personId: pick.id }),
      },
    });
  } catch (e) {
    // Asked twice at once, or the agency made a login for them just now: carry on with that one.
    if (!isUniqueClash(e)) throw e;
    const again = await userByEmail(email);
    return again ? linkFor(again) : "none";
  }
  if (pick.kind === "act") await linkActLoginQuietly(user.id);
  await logActivity(
    { id: user.id, agencyId: pick.agencyId },
    pick.kind === "act" ? "ARTIST" : "PERSON",
    pick.id,
    "asked for a link to set up their login",
    email,
  );
  const otherAgencies = [...new Set(targets.map((t) => t.agencyId).filter((id) => id !== pick.agencyId))];
  return linkFor(user, otherAgencies);
}

/** A set-up link for a login that has never had a password, otherwise an ordinary reset link. */
async function linkFor(
  user: { id: string; name: string; email: string; passwordHash: string; role: string; agencyId: string | null },
  otherAgencies: string[] = [],
) {
  if (user.passwordHash || user.role !== "ARTIST" || !user.agencyId) return (await sendResetLink(user)) ? "reset" : "limited";
  const token = await createResetToken(user.id, CLAIM_HOURS * HOUR);
  if (!token) return "limited";
  const names = async (ids: string[]) =>
    (await prisma.settings.findMany({ where: { agencyId: { in: ids } }, select: { agencyName: true, agency: { select: { name: true } } } })).map(
      (s) => s.agencyName || s.agency.name,
    );
  const settings = await prisma.settings.findUnique({
    where: { agencyId: user.agencyId },
    select: { agencyName: true, agencyEmail: true, agency: { select: { name: true } } },
  });
  const business = settings?.agencyName || settings?.agency.name || "Your agency";
  const others = otherAgencies.length ? await names(otherAgencies) : [];
  const link = `${appUrl()}/reset-password/${token}?claim=1`;
  await sendEmail({
    kind: "WELCOME",
    agencyId: user.agencyId,
    to: user.email,
    replyTo: settings?.agencyEmail,
    subject: `Set up your Gigsaw login for ${business}`,
    email: {
      brand: business,
      preheader: `Set your password, then add your bank details. The link works for ${CLAIM_HOURS} hours.`,
      title: "Set your password",
      intro: `Hi ${user.name.split(" ")[0]}, ${business} uses Gigsaw for your bookings and to pay you. Choose a password, then add your bank details and address. This is how you'll get paid from now on.`,
      cta: { label: "Set my password", url: link },
      rows: [
        ["Your login", user.email],
        ["Sign in at", `${appUrl()}/login`],
      ],
      outro: [
        `The link works once and lasts ${CLAIM_HOURS} hours. After that, go to ${appUrl()}/start and type your email again.`,
        others.length
          ? `Your email is also on file with ${others.join(" and ")}. A Gigsaw login belongs to one agency, so ask them to use a different email for you.`
          : "",
      ]
        .filter(Boolean)
        .join(" "),
      footnote: "Didn't ask for this? You can ignore this email. Nothing changes until a password is set.",
    },
  });
  return "claim";
}

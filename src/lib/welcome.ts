import "server-only";
import { randomBytes } from "node:crypto";
import { prisma } from "./db";
import { appUrl, sendEmail } from "./messaging";
import { configuredProviders, PROVIDERS } from "./oauth";
import { hashToken } from "./reset";

// The welcome email for a new login: the owner creating a business, or an admin adding someone
// to the team. It carries a link to set their own password (a reset token that lasts a week, so
// nobody has to send passwords around), and mentions Google or Microsoft sign-in when set up.

const WEEK = 7 * 24 * 3_600_000;

/** A one-time "set your password" link that works for a week. */
export async function welcomeLink(userId: string) {
  const token = randomBytes(32).toString("base64url");
  await prisma.passwordReset.create({ data: { userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + WEEK) } });
  return `${appUrl()}/reset-password/${token}?welcome=1`;
}

export async function sendWelcome(opts: {
  user: { id: string; name: string; email: string; agencyId: string | null };
  business: string;
  /** Who added them, for a team member. Left out when Gigsaw set up the business. */
  invitedBy?: string;
}) {
  const { user, business, invitedBy } = opts;
  const link = await welcomeLink(user.id);
  const first = user.name.split(" ")[0] || "there";
  const providers = configuredProviders().map((p) => PROVIDERS[p].label);
  return sendEmail({
    kind: "WELCOME",
    agencyId: user.agencyId ?? undefined,
    to: user.email,
    subject: invitedBy ? `${invitedBy} added you to ${business} on Gigsaw` : `Welcome to Gigsaw, ${business}`,
    email: {
      preheader: "Set your password and sign in. The link works for 7 days.",
      title: invitedBy ? `Join ${business} on Gigsaw` : "Welcome to Gigsaw",
      intro: invitedBy
        ? `Hi ${first}, ${invitedBy} has added you to ${business} on Gigsaw, where the team runs its bookings, acts, venues and arrivals. Set your password to get started.`
        : `Hi ${first}, your Gigsaw account for ${business} is ready. It's where you'll run your bookings, acts, venues, arrivals and money. Set your password to get started.`,
      cta: { label: "Set my password", url: link },
      rows: [
        ["Your login", user.email],
        ["Sign in at", `${appUrl()}/login`],
      ],
      outro: [
        "The link works once and lasts 7 days. After that, use Forgotten password on the sign-in page.",
        providers.length ? `You can also sign in with ${providers.join(" or ")} using this email address.` : "",
      ]
        .filter(Boolean)
        .join(" "),
      footnote: "Not expecting this? You can ignore this email.",
    },
  });
}

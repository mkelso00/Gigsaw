import "server-only";
import { redirect } from "next/navigation";
import { maskAccount, maskSortCode, needsDetails, type PayDetails } from "./act-details";
import { requireUser, type AgencyUser } from "./auth";
import { getSettings, prisma } from "./db";
import { appUrl, sendEmail } from "./messaging";
import { formatDateTime } from "./time";
import { needsCalendar } from "./act-calendar-step";

// Which acts a login fills in pay details for, and the gate that sends them to Your details
// until they have. See src/lib/act-details.ts for what the details are and who sees them.

export const PAY_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  bankAccountName: true,
  bankSortCode: true,
  bankAccountNumber: true,
  vatRegistered: true,
  vatNumber: true,
  address: true,
  niNumber: true,
  detailsCompletedAt: true,
} as const;

/**
 * The acts this login gives pay details for. An act's own login: that act. A person's login: the
 * acts they speak for, where the act's email is theirs or they're its only member. A drummer in a
 * five-piece isn't asked for the band's bank account or a National Insurance number.
 */
export async function payActsFor(user: { artistId: string | null; personId: string | null; agencyId: string; email: string }) {
  if (user.artistId) return prisma.artist.findMany({ where: { id: user.artistId, agencyId: user.agencyId }, select: PAY_SELECT });
  if (!user.personId) return [];
  const acts = await prisma.artist.findMany({
    where: { agencyId: user.agencyId, members: { some: { personId: user.personId } } },
    select: { ...PAY_SELECT, _count: { select: { members: true } } },
    orderBy: { name: "asc" },
  });
  const email = user.email.trim().toLowerCase();
  return acts.filter((a) => a.email.trim().toLowerCase() === email || a._count.members === 1);
}

/**
 * Tell the agency an act changed the bank account they're paid into. Changing someone's bank
 * details is a common fraud (a hijacked email or login, then the next payment goes elsewhere), so
 * the business email hears about it every time, with only the last digits of either account.
 * With no business email set, the admins are told instead.
 */
export async function notifyBankChange(opts: { agencyId: string; act: { id: string; name: string }; before: PayDetails; after: PayDetails; by: string }) {
  const { agencyId, act, before, after, by } = opts;
  const settings = await getSettings(agencyId);
  const to = settings.agencyEmail.trim()
    ? [settings.agencyEmail.trim()]
    : (await prisma.user.findMany({ where: { agencyId, role: "ADMIN" }, select: { email: true } })).map((u) => u.email);
  const account = (d: PayDetails) => `${maskSortCode(d.bankSortCode)}  ${maskAccount(d.bankAccountNumber)}`;
  for (const email of to) {
    await sendEmail({
      kind: "BANK_CHANGE",
      agencyId,
      to: email,
      subject: `${act.name} changed their bank details`,
      email: {
        preheader: "Check it with them before you next pay them.",
        title: "Bank details changed",
        intro: `${act.name} changed the bank account they're paid into, from their Gigsaw app. Before you next pay them, check the change with them on a phone number you already have. Changing bank details is a common trick by fraudsters.`,
        rows: [
          ["Act", act.name],
          ["Changed by", by],
          ["Old account", account(before)],
          ["New account", account(after)],
          ["When", formatDateTime(new Date(), settings.defaultTimezone)],
        ],
        cta: { label: "Open the act", url: `${appUrl()}/artists/${act.id}` },
        footnote: "For your security, full account numbers are never sent by email. Admins can see them on the act's page.",
      },
    });
  }
}

/**
 * The signed-in act, for every page of the act app except Your details and the calendar step: until the
 * act's pay details are in, they're sent there first, then to add their gigs to a calendar.
 */
export async function requireActApp(): Promise<AgencyUser> {
  const user = await requireUser(["ARTIST"]);
  if ((await payActsFor(user)).some(needsDetails)) redirect("/app/details");
  if (await needsCalendar(user.id)) redirect("/app/add-calendar");
  return user;
}

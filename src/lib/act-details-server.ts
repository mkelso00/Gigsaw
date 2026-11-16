import "server-only";
import { redirect } from "next/navigation";
import { maskAccount, maskSortCode, needsDetails, type PayDetails } from "./act-details";
import { requireUser, type AgencyUser } from "./auth";
import { getSettings, prisma } from "./db";
import { appUrl, sendEmail } from "./messaging";
import { formatDateTime } from "./time";
import { needsCalendar } from "./act-calendar-step";
import { payHoldersFor } from "./payee-server";

// The gate that sends an act's login to Your details until their pay details are in, and the notice to the
// agency when bank details change. Whose details a login fills in is in ./payee-server.ts (payHoldersFor);
// what the details are and who sees them is in ./act-details.ts.

/**
 * Tell the agency someone changed the bank account they're paid into. Changing someone's bank details
 * is a common fraud (a hijacked email or login, then the next payment goes elsewhere), so the business
 * email hears about it every time, with only the last digits of either account. With no business email
 * set, the admins are told instead.
 */
export async function notifyBankChange(opts: {
  agencyId: string;
  holder: { kind: "act" | "person"; id: string; name: string };
  before: PayDetails;
  after: PayDetails;
  by: string;
}) {
  const { agencyId, holder, before, after, by } = opts;
  const isPerson = holder.kind === "person";
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
      subject: `${holder.name} changed their bank details`,
      email: {
        preheader: "Check it with them before you next pay them.",
        title: "Bank details changed",
        intro: `${holder.name} changed the bank account they're paid into, from their Gigsaw app. Before you next pay them, check the change with them on a phone number you already have. Changing bank details is a common trick by fraudsters.`,
        rows: [
          [isPerson ? "Person" : "Act", holder.name],
          ["Changed by", by],
          ["Old account", account(before)],
          ["New account", account(after)],
          ["When", formatDateTime(new Date(), settings.defaultTimezone)],
        ],
        cta: { label: isPerson ? "Open their page" : "Open the act", url: `${appUrl()}${isPerson ? `/people/${holder.id}` : `/artists/${holder.id}`}` },
        footnote: `For your security, full account numbers are never sent by email. Admins can see them on ${isPerson ? "their" : "the act's"} page.`,
      },
    });
  }
}

/** True when this login still has to fill in pay details: a person their own, never the whole band's. */
export async function needsPayDetails(user: { artistId: string | null; personId: string | null; agencyId: string }) {
  return (await payHoldersFor(user)).some(needsDetails);
}

/**
 * The signed-in act, for every page of the act app except Your details and the calendar step: until the
 * login's pay details are in, they're sent there first, then to add their gigs to a calendar.
 */
export async function requireActApp(): Promise<AgencyUser> {
  const user = await requireUser(["ARTIST"]);
  if (await needsPayDetails(user)) redirect("/app/details");
  if (await needsCalendar(user.id)) redirect("/app/add-calendar");
  return user;
}

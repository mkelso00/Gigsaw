import "server-only";
import { prisma } from "./db";
import { readEnquiryConfig } from "./enquiries";
import { alertDef, resolveRecipients, routeFor, type AlertContext, type TeamAlert, type TeamPerson, type TeamRecipients } from "./team-alert-routing";

export type { AlertContext, TeamAlert, TeamRecipients } from "./team-alert-routing";
export { bookingContext, typeContext } from "./team-alert-routing";

const personSelect = { id: true, email: true, name: true, phone: true, notifyPrefs: true } as const;

/**
 * Who on the team hears about something: the email addresses, and the logins to send phone notifications and texts
 * to. Follows Settings, Notifications, "Where team alerts go" for this alert and context (weddings and events, or
 * venue gigs), each person's own switches in their profile, and the business email when there's no lead agent.
 * `agent` is the booking's, event's or proposal's lead agent (a login id), for the alerts about one booking.
 * Shared inboxes only ever get email.
 */
export async function teamRecipients(
  agencyId: string,
  alert: TeamAlert,
  { context = "GIGS", agent = null }: { context?: AlertContext; agent?: string | null } = {},
): Promise<TeamRecipients> {
  const s = await prisma.settings.findUnique({
    where: { agencyId },
    select: { agencyEmail: true, alertEmail: true, accountsEmail: true, eventsEmail: true, gigsEmail: true, alertRouting: true, enquiryForm: true },
  });
  const a = alertDef(alert);
  const ctx = a.contexts[0] === "ALL" ? "ALL" : (a.contexts as readonly string[]).includes(context) ? context : a.contexts[0];
  const route = routeFor(s?.alertRouting, alert, ctx);
  if (route === "NOBODY") return { emails: [], names: {}, push: [], text: [] };
  const agencyEmail = s?.agencyEmail.trim() ?? "";
  const businessEmail = agencyEmail || s?.alertEmail.trim() || "";

  let people: TeamPerson[] = [];
  let inbox = "";
  let fallback = "";
  if (a.people === "AGENT") {
    inbox = (ctx === "EVENTS" ? s?.eventsEmail : s?.gigsEmail) ?? "";
    // A late act has always gone to the agent and the on-call contact (Settings, Arrivals), never the business email.
    fallback = alert === "LATE" ? "" : agencyEmail;
    const person = agent ? await prisma.user.findFirst({ where: { id: agent, agencyId }, select: personSelect }) : null;
    people = person ? [person] : [];
  } else if (a.people === "ENQUIRY") {
    // The people chosen in Settings, Enquiry form (nobody when it says the business email).
    inbox = businessEmail;
    fallback = businessEmail;
    const notify = readEnquiryConfig(s?.enquiryForm).notify;
    const staff = { agencyId, role: { in: ["ADMIN", "AGENT"] } };
    if (notify !== "BUSINESS") {
      people = await prisma.user.findMany({
        where: notify === "ADMINS" ? { ...staff, role: "ADMIN" } : notify === "TEAM" ? staff : { ...staff, id: notify.slice(5) },
        select: personSelect,
      });
    }
  } else {
    inbox = (a.inbox === "ACCOUNTS" ? s?.accountsEmail : s?.agencyEmail) ?? "";
    people = await prisma.user.findMany({ where: { agencyId, role: "ADMIN", demo: false }, select: personSelect });
  }
  return resolveRecipients({ alert, route, inbox, people, fallback });
}

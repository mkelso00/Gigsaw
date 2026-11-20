import "server-only";
import { missingDetails } from "./act-details";
import { actFeeMinor, paidOutMinor } from "./act-invoice-rules";
import { ON_STATUSES } from "./constants";
import { prisma } from "./db";
import { messageFor } from "./message-templates";
import { appUrl, sendEmail, sendPush } from "./messaging";
import { actLoginFillsIn, legalName, payeeOf, type PayAct } from "./payee";
import { loadPayActs } from "./payee-server";
import { claimReminder, claimedReminders } from "./reminders";
import { weekStartOf, weekdayOf } from "./rota";
import { agreementState, type AgreementState } from "./self-billing";
import { localDateKey, localTime } from "./time";

// Chasing acts for their pay details, and for the self-billing agreement (src/lib/self-billing.ts).
//
// Once a week, on the first weekday minute in office hours (so Monday from 9am, the business's time), everyone an
// act's invoices go to (its payee: src/lib/payee.ts) whose bank details or address are missing, or who has no current
// self-billing agreement, gets an email and a phone notification with a link to Your details in the app. Only payees
// with a gig to be paid for: one coming up, or one in the last year the act is still owed for. A payee with no gigs is
// never chased, and a band with nobody chosen to get its invoices isn't either (staff have to choose first).
//
// Each payee hears once a week however many acts they're paid for (claimReminder, kind PAY_DETAILS, keyed by the
// Monday of the week). Staff can send one straight away for one act from Pay acts (Remind now). Never mentions money.

const DAY = 86_400_000;
export const CHASE_KIND = "PAY_DETAILS";
const NOW_KIND = "PAY_DETAILS_NOW";

/** Office hours for the chase: weekdays, 9am to 5pm in the business's time zone. */
export function inChaseHours(now: Date, timeZone: string) {
  const t = localTime(now, timeZone);
  return weekdayOf(localDateKey(now, timeZone)) <= 5 && t >= "09:00" && t < "17:00";
}

/** Someone to chase: an act's payee, with what's missing and where to reach them. */
export type ChaseTarget = {
  /** "person:<id>" or "act:<id>", the Reminder's recipient. */
  key: string;
  kind: "person" | "act";
  id: string;
  name: string;
  firstName: string;
  /** What's missing from their details, in words ("bank details", "address", "VAT number"). Empty when they're in. */
  missing: string[];
  agreement: AgreementState;
  acts: string[];
  emails: string[];
  userIds: string[];
};

/** What still needs doing, or null when nothing does. */
function needs(h: PayAct | PayAct["members"][number], now: Date) {
  const missing = missingDetails(h);
  if (h.vatRegistered && !h.vatNumber.trim()) missing.push("VAT number");
  // A completion date is needed too: details typed in but not finished count as missing.
  if (!missing.length && !h.detailsCompletedAt) missing.push("pay details");
  const agreement = agreementState(h.selfBillingAgreedAt, now);
  return missing.length || agreement !== "current" ? { missing, agreement } : null;
}

/** The payees of these acts who need chasing, one per person or act, with their acts and how to reach them. */
export async function chaseTargets(agencyId: string, actIds: string[], now = new Date()): Promise<ChaseTarget[]> {
  const acts = await loadPayActs(agencyId, actIds);
  const out = new Map<string, ChaseTarget>();
  for (const act of acts.values()) {
    const payee = payeeOf(act);
    if (!payee) continue;
    const holder = payee.kind === "person" ? payee.person : act;
    const n = needs(holder, now);
    if (!n) continue;
    const key = payee.kind === "person" ? `person:${payee.person.id}` : `act:${act.id}`;
    const t =
      out.get(key) ??
      (payee.kind === "person"
        ? {
            key,
            kind: "person" as const,
            id: payee.person.id,
            name: legalName(payee.person),
            firstName: payee.person.firstName || payee.person.alias || legalName(payee.person),
            ...n,
            acts: [],
            emails: [payee.person.email],
            userIds: [],
          }
        : { key, kind: "act" as const, id: act.id, name: act.name, firstName: act.name, ...n, acts: [], emails: [act.email], userIds: [] });
    t.acts.push(act.name);
    // A solo act's own login fills in its only person's details (actLoginFillsIn), so it's told too.
    const fills = actLoginFillsIn(act);
    if (payee.kind === "act" || (fills?.kind === "person" && fills.person.id === t.id)) t.emails.push(act.email);
    out.set(key, t);
  }
  const targets = [...out.values()];
  if (!targets.length) return [];
  const personIds = targets.filter((t) => t.kind === "person").map((t) => t.id);
  const logins = await prisma.user.findMany({
    where: { agencyId, OR: [{ personId: { in: personIds } }, { artistId: { in: [...acts.keys()] } }] },
    select: { id: true, personId: true, artistId: true },
  });
  for (const t of targets) {
    const actIdsOf = [...acts.values()].filter((a) => {
      if (t.kind === "act") return a.id === t.id;
      const fills = actLoginFillsIn(a);
      return fills?.kind === "person" && fills.person.id === t.id;
    });
    t.userIds = logins
      .filter((u) => (t.kind === "person" && u.personId === t.id) || (u.artistId && actIdsOf.some((a) => a.id === u.artistId)))
      .map((u) => u.id);
    t.emails = [...new Set(t.emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
    t.acts = [...new Set(t.acts)].sort();
  }
  return targets;
}

/** Acts with a gig to be paid for: confirmed, coming up or in the last year, with some of the act's fee still unpaid. */
export async function actsWithGigsToPay(agencyId: string, now = new Date()) {
  const gigs = await prisma.booking.findMany({
    where: {
      agencyId,
      demo: false,
      status: { in: ON_STATUSES },
      artistId: { not: null },
      artist: { demo: false },
      setStart: { gte: new Date(now.getTime() - 365 * DAY) },
    },
    select: {
      artistId: true,
      dealType: true,
      feeMinor: true,
      artistFeeMinor: true,
      commissionPct: true,
      vatPct: true,
      bookingFeeMinor: true,
      payments: { select: { direction: true, amountMinor: true } },
    },
  });
  return [...new Set(gigs.filter((b) => actFeeMinor(b) > paidOutMinor(b.payments)).map((b) => b.artistId!))];
}

type Business = { agencyId: string; name: string; email: string; templates: unknown };

/** Sends the reminder to one payee: email to each address, and a phone notification to each login. */
async function sendChase(t: ChaseTarget, biz: Business) {
  const detailsNeeded = t.missing.length > 0;
  const vars = { first_name: t.firstName, act: t.acts.join(", "), business: biz.name };
  const tpl = messageFor(biz.templates, detailsNeeded ? "PAY_DETAILS" : "SELF_BILLING", vars);
  if (!tpl.on) return false;
  const forActs = t.kind === "person" && t.acts.length ? ` for ${t.acts.join(", ")}` : "";
  const subject = tpl.subject ?? (detailsNeeded ? `Add your bank and address so ${biz.name} can pay you` : `Please confirm self-billing with ${biz.name}`);
  const intro =
    tpl.intro ??
    (detailsNeeded
      ? `Hi ${t.firstName}, ${biz.name} needs your ${t.missing.join(" and ")} to pay you for your gigs${forActs}. It takes a minute in the app, and you only do it once.`
      : t.agreement === "expired"
        ? `Hi ${t.firstName}, ${biz.name} makes out your invoices for you (self-billing). HMRC asks for your agreement to that, renewed once a year, and it's been a year since you agreed. Please read it again and tick to agree in the app. It takes a moment.`
        : `Hi ${t.firstName}, ${biz.name} makes out your invoices for you (self-billing). HMRC asks for your agreement to that. Please read it and tick to agree in the app. It takes a moment.`);
  const url = "/app/details";
  const rows: [string, string][] = [
    ...(detailsNeeded ? [["Still needed", t.missing.join(", ")] as [string, string]] : []),
    ...(t.agreement !== "current" ? [["Self-billing", t.agreement === "expired" ? "Agree again, once a year" : "Tick to agree"] as [string, string]] : []),
  ];
  let reached = 0;
  for (const userId of t.userIds) {
    reached += await sendPush({
      kind: "PAY_DETAILS",
      agencyId: biz.agencyId,
      userId,
      payload: { title: subject, body: detailsNeeded ? "Add them in the app so you can be paid." : "Tick to agree in the app.", url, tag: "pay-details" },
      ttlSeconds: (3 * DAY) / 1000,
    });
  }
  let emailed = 0;
  for (const to of t.emails) {
    const r = await sendEmail({
      kind: "PAY_DETAILS",
      agencyId: biz.agencyId,
      to,
      replyTo: biz.email || null,
      subject,
      email: {
        brand: biz.name,
        preheader: detailsNeeded ? "It takes a minute in the app." : "It takes a moment in the app.",
        title: subject,
        intro,
        rows,
        cta: { label: detailsNeeded ? "Add my details" : "Agree in the app", url: `${appUrl()}${url}` },
        outro: `Only you and ${biz.name}'s admins can see your bank details. Questions? Just reply to this email.`,
      },
    });
    if (r !== "SKIPPED") emailed++;
  }
  return reached + emailed > 0;
}

async function businessOf(agencyId: string): Promise<Business | null> {
  const a = await prisma.agency.findUnique({ where: { id: agencyId }, select: { name: true, settings: true } });
  if (!a) return null;
  return { agencyId, name: a.settings?.agencyName || a.name, email: a.settings?.agencyEmail ?? "", templates: a.settings?.messageTemplates ?? {} };
}

/** The scheduler's job, every minute: the weekly chase, from Monday 9am. Safe to run as often as you like. */
export async function runPayDetailsChase(now = new Date(), opts: { agencyIds?: string[] } = {}) {
  const agencies = await prisma.agency.findMany({
    where: { status: "ACTIVE", ...(opts.agencyIds ? { id: { in: opts.agencyIds } } : {}) },
    select: { id: true, settings: { select: { defaultTimezone: true } } },
  });
  let chased = 0;
  for (const agency of agencies) {
    const tz = agency.settings?.defaultTimezone ?? "Europe/London";
    if (!inChaseHours(now, tz)) continue;
    const week = weekStartOf(localDateKey(now, tz));
    // Most minutes everyone due this week has had it already: one cheap check before looking anyone up.
    if (await prisma.reminder.findFirst({ where: { kind: "PAY_DETAILS_WEEK", recipient: `agency:${agency.id}`, key: week }, select: { id: true } })) continue;
    const targets = await chaseTargets(agency.id, await actsWithGigsToPay(agency.id, now), now);
    const sent = await claimedReminders(
      [CHASE_KIND],
      targets.map((t) => t.key),
      [week],
    );
    const biz = targets.length ? await businessOf(agency.id) : null;
    for (const t of targets) {
      if (!biz || sent.has(`${CHASE_KIND}|${t.key}|${week}`) || !(await claimReminder(CHASE_KIND, t.key, week))) continue;
      if (await sendChase(t, biz)) chased++;
    }
    // Done for this business this week. Someone whose details go missing later in the week is chased next Monday.
    await claimReminder("PAY_DETAILS_WEEK", `agency:${agency.id}`, week);
  }
  return { chased };
}

/**
 * "Remind now" on Pay acts: chases one act's payee straight away, whatever the day. At most once a day each, so a
 * double press doesn't send two; it also counts as this week's reminder.
 */
export async function remindPayeeNow(agencyId: string, artistId: string, now = new Date()): Promise<{ ok: string } | { error: string }> {
  const act = await prisma.artist.findFirst({ where: { id: artistId, agencyId }, select: { id: true, name: true } });
  if (!act) return { error: "Act not found" };
  const [t] = await chaseTargets(agencyId, [artistId], now);
  if (!t) return { error: `${act.name}'s details and self-billing agreement are all in, or nobody is chosen to get the band's invoices yet.` };
  if (!t.emails.length && !t.userIds.length) return { error: `There's no email address or app login for ${t.name} to send it to.` };
  const biz = await businessOf(agencyId);
  if (!biz) return { error: "Business not found" };
  const tz = (await prisma.settings.findUnique({ where: { agencyId }, select: { defaultTimezone: true } }))?.defaultTimezone ?? "Europe/London";
  const today = localDateKey(now, tz);
  if (!(await claimReminder(NOW_KIND, t.key, today))) return { error: `${t.name} has already been reminded today.` };
  await claimReminder(CHASE_KIND, t.key, weekStartOf(today));
  if (!(await sendChase(t, biz))) return { error: "That reminder is switched off in Settings, Notifications." };
  return { ok: `Reminder sent to ${t.name}.` };
}

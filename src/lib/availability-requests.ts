import "server-only";
import { randomBytes } from "node:crypto";
import { canAnswer, formatRange, requestTimes, type ReplyAnswer } from "./availability";
import { prisma } from "./db";
import { messageFor } from "./message-templates";
import { appUrl, sendEmail, sendPush, sendSms } from "./messaging";
import { formatMoney } from "./money";
import { recipientsForActs } from "./people";
import { localDateKey } from "./time";

// "Are you free?" requests. Staff pick a date and several acts; each act (or each of its
// members) gets a message with a private link (/f/…, no login) to answer Yes or No, and the
// question also shows at the top of their app. Acts see the date, times, place, note and their
// own fee, never what the venue or customer pays.

export const newReplyToken = () => randomBytes(18).toString("base64url");

/** Where the request is for, as the act sees it: "The Crown, York", "Wedding near York" or "". */
export function requestPlace(r: { place: string; venue: { name: string; city: string } | null }) {
  return r.venue ? `${r.venue.name}${r.venue.city ? `, ${r.venue.city}` : ""}` : r.place;
}

/** Today in the request's time zone, for whether it can still be answered. */
export const requestToday = (r: { timezone: string }) => localDateKey(new Date(), r.timezone);

/**
 * Ask the acts on a request who haven't answered yet (or only those replies given). Each person
 * gets one message per act. Returns how many people were contacted.
 */
export async function sendAvailability(requestId: string, replyIds?: string[]) {
  const req = await prisma.availabilityRequest.findUnique({
    where: { id: requestId },
    include: {
      agency: { include: { settings: true } },
      venue: { select: { name: true, city: true } },
      replies: {
        where: { answer: null, ...(replyIds ? { id: { in: replyIds } } : {}) },
        include: { artist: { select: { id: true, name: true, demo: true } } },
      },
    },
  });
  if (!req || !canAnswer(req, requestToday(req)) || !req.replies.length) return 0;
  const live = req.replies.filter((r) => !r.artist.demo); // demo data never sends anything
  if (!live.length) return 0;
  await prisma.availabilityReply.updateMany({ where: { id: { in: live.map((r) => r.id) } }, data: { sentAt: new Date() } });
  const staff = req.createdById ? await prisma.user.findUnique({ where: { id: req.createdById }, select: { name: true, email: true } }) : null;
  const settings = req.agency.settings;
  const agencyName = settings?.agencyName || req.agency.name;
  const date = formatRange(req.date, req.date);
  const times = requestTimes(req);
  const place = requestPlace(req);
  const recipients = await recipientsForActs(live.map((r) => r.artistId));
  const contacted = new Set<string>();
  for (const reply of live) {
    const link = `${appUrl()}/f/${reply.token}`;
    for (const r of recipients.get(reply.artistId) ?? []) {
      const t = messageFor(settings?.messageTemplates, "AVAILABILITY", {
        first_name: r.firstName,
        act: reply.artist.name,
        venue: place || "a gig",
        date,
        time: req.startTime || req.arriveTime,
        business: agencyName,
      });
      if (!t.on) continue;
      contacted.add(r.key);
      const title = `Are you free on ${date}?`;
      const base = { kind: "AVAILABILITY" as const, agencyId: req.agencyId };
      const reached = r.userId
        ? await sendPush({ ...base, userId: r.userId, payload: { title, body: "Tap to answer Yes or No.", url: `/f/${reply.token}`, tag: `free-${reply.id}` } })
        : 0;
      for (const to of r.emails) {
        await sendEmail({
          ...base,
          to,
          replyTo: staff?.email || settings?.agencyEmail,
          subject: t.subject ?? title,
          email: {
            brand: agencyName,
            preheader: "Tap Yes or No",
            title,
            intro:
              t.intro ??
              `Hi ${r.firstName}, ${agencyName} is looking for an act on ${date}. Are ${r.isMember ? `${reply.artist.name}` : "you"} free? Just tap Yes or No.`,
            rows: [
              ["Date", date],
              ...(times ? [["Times", times] as [string, string]] : []),
              ...(place ? [["Where", place] as [string, string]] : []),
              ...(r.isMember ? [["Act", reply.artist.name] as [string, string]] : []),
              ...(req.costMinor ? [["Fee", formatMoney(req.costMinor, req.currency)] as [string, string]] : []),
              ...(req.note ? [["Note", req.note] as [string, string]] : []),
            ],
            cta: { label: "Answer Yes or No", url: link },
            outro: `Questions? Reply to this email to reach ${staff?.name ?? agencyName}.`,
          },
        });
      }
      if (!reached && r.phone) {
        await sendSms({
          ...base,
          to: r.phone,
          text: t.text ? `${t.text} ${link}` : `${agencyName}: are you free on ${date}? Tap to answer yes or no: ${link}`,
        });
      }
    }
  }
  return contacted.size;
}

/**
 * Record an act's answer. They can change it until the date has passed or the request is
 * closed. Returns false if it can't be answered any more.
 */
export async function answerAvailability(replyId: string, answer: ReplyAnswer, note: string) {
  const reply = await prisma.availabilityReply.findUnique({
    where: { id: replyId },
    include: { request: true, artist: { select: { name: true } } },
  });
  if (!reply || !canAnswer(reply.request, requestToday(reply.request))) return false;
  await prisma.availabilityReply.update({ where: { id: reply.id }, data: { answer, note: note.trim().slice(0, 500), answeredAt: new Date() } });
  await prisma.activity.create({
    data: {
      agencyId: reply.request.agencyId,
      entity: "ARTIST",
      entityId: reply.artistId,
      action: answer === "YES" ? "said they're free" : "said they're not free",
      detail: formatRange(reply.request.date, reply.request.date),
    },
  });
  return true;
}

import "server-only";
import { prisma } from "./db";
import { normalisePhone, renderEmail, type EmailContent } from "./message-format";
import { pushTo, type PushPayload } from "./push";

// Sends emails (Resend) and texts (Twilio) when their keys are set in the environment,
// and records every message in the Message table either way. With no provider set up,
// messages are kept as NOT_SENT so they can still be read in the Outbox.
//
//   Email: RESEND_API_KEY, MAIL_FROM (e.g. "Gigsaw <alerts@yourdomain.com>")
//   Texts: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM (e.g. +447700900000)

export type MessageKind = "PASSWORD_RESET" | "OVERDUE_ALERT" | "CLIENT_ARRIVAL" | "BOOKING_CHANGE" | "REMINDER" | "TEST";

type Base = {
  kind: MessageKind;
  agencyId?: string | null;
  bookingId?: string | null;
};

export function emailConfigured() {
  return !!(process.env.RESEND_API_KEY && process.env.MAIL_FROM);
}

export function smsConfigured() {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM);
}

/** The public address of this site, for links in emails and texts. */
export function appUrl() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  return `http://localhost:${process.env.PORT ?? 3000}`;
}

async function post(url: string, init: RequestInit) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 300)}`);
  } finally {
    clearTimeout(t);
  }
}

async function record(
  m: Base & {
    channel: "EMAIL" | "SMS" | "PUSH";
    to: string;
    subject?: string;
    body: string;
  },
  send: (() => Promise<void>) | null,
  provider: string,
) {
  let status = "NOT_SENT";
  let error = "";
  if (send) {
    try {
      await send();
      status = "SENT";
    } catch (e) {
      status = "FAILED";
      error = e instanceof Error ? e.message : String(e);
    }
  }
  await prisma.message.create({
    data: {
      agencyId: m.agencyId ?? null,
      bookingId: m.bookingId ?? null,
      kind: m.kind,
      channel: m.channel,
      to: m.to,
      subject: m.subject ?? "",
      body: m.body,
      status,
      provider: send ? provider : "",
      error,
    },
  });
  return status;
}

const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

/**
 * Send a branded email. `replyTo` should be a real person or inbox (e.g. the agency's email),
 * so replies don't go to the no-reply sending address.
 */
export async function sendEmail(
  m: Base & {
    to: string;
    subject: string;
    email: EmailContent;
    replyTo?: string | null;
  },
) {
  const to = m.to.trim();
  if (!isEmail(to)) return "SKIPPED";
  const { html, text } = renderEmail(m.email);
  const replyTo = m.replyTo?.trim();
  const send = emailConfigured()
    ? () =>
        post("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: process.env.MAIL_FROM,
            to: [to],
            subject: m.subject,
            text,
            html,
            ...(replyTo && isEmail(replyTo) ? { reply_to: replyTo } : {}),
          }),
        })
    : null;
  return record({ ...m, channel: "EMAIL", to, body: text }, send, "resend");
}

export async function sendSms(m: Base & { to: string; text: string }) {
  const to = normalisePhone(m.to);
  if (!to) return "SKIPPED";
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const send = smsConfigured()
    ? () =>
        post(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            To: to,
            From: process.env.TWILIO_FROM!,
            Body: m.text,
          }).toString(),
        })
    : null;
  return record({ ...m, channel: "SMS", to, body: m.text }, send, "twilio");
}

/**
 * Send a phone notification to every device where this login has turned them on.
 * Each device is logged in the Outbox. Devices that have since turned notifications off are
 * forgotten. Returns how many devices it reached.
 */
export async function sendPush(m: Base & { userId: string; payload: PushPayload; ttlSeconds?: number }) {
  const subs = await prisma.pushSubscription.findMany({
    where: { userId: m.userId },
  });
  let reached = 0;
  for (const sub of subs) {
    let gone = false;
    const status = await record(
      {
        ...m,
        channel: "PUSH",
        to: sub.device || "Phone",
        subject: m.payload.title,
        body: m.payload.body,
      },
      async () => {
        gone = (await pushTo(sub, m.payload, m.ttlSeconds)) === "gone";
        if (gone) throw new Error("This device has turned notifications off. It has been removed.");
      },
      "web-push",
    );
    if (gone) await prisma.pushSubscription.deleteMany({ where: { id: sub.id } });
    if (status === "SENT") reached++;
  }
  return reached;
}

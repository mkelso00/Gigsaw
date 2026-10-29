import "server-only";
import webpush from "web-push";
import { prisma } from "./db";

// Phone notifications (web push). The keys that sign them (VAPID) come from the
// VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY variables if set, otherwise Gigsaw makes a pair
// once and keeps it in the database. Changing the keys means every phone has to turn
// notifications on again, so they're never replaced automatically.

type Keys = { publicKey: string; privateKey: string };
let cached: Keys | null = null;

export async function vapidKeys(): Promise<Keys> {
  if (cached) return cached;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    cached = {
      publicKey: process.env.VAPID_PUBLIC_KEY,
      privateKey: process.env.VAPID_PRIVATE_KEY,
    };
    return cached;
  }
  const stored = await prisma.appSecret.findUnique({ where: { key: "vapid" } });
  if (stored) return (cached = JSON.parse(stored.value) as Keys);
  const fresh = webpush.generateVAPIDKeys();
  // Two servers starting at once could both get here: whichever saves first wins.
  await prisma.appSecret.createMany({
    data: [{ key: "vapid", value: JSON.stringify(fresh) }],
    skipDuplicates: true,
  });
  const saved = await prisma.appSecret.findUniqueOrThrow({
    where: { key: "vapid" },
  });
  return (cached = JSON.parse(saved.value) as Keys);
}

function subject() {
  const from = process.env.MAIL_FROM?.match(/[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+/)?.[0];
  return `mailto:${from ?? "alerts@send.gigsaw.live"}`;
}

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
};

/**
 * Send one notification to a subscription. Returns "gone" when the phone has turned
 * notifications off or the app was removed (the subscription should be deleted).
 */
export async function pushTo(sub: { endpoint: string; p256dh: string; auth: string }, payload: PushPayload, ttlSeconds = 12 * 3600): Promise<"sent" | "gone"> {
  const keys = await vapidKeys();
  try {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload), {
      vapidDetails: {
        subject: subject(),
        publicKey: keys.publicKey,
        privateKey: keys.privateKey,
      },
      TTL: ttlSeconds,
      timeout: 10_000,
    });
    return "sent";
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) return "gone";
    throw new Error(`${status ?? ""} ${(e as { body?: string }).body ?? (e instanceof Error ? e.message : String(e))}`.trim().slice(0, 300));
  }
}

"use server";

import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { sendPush } from "@/lib/messaging";

type Sub = { endpoint: string; keys?: { p256dh?: string; auth?: string } };

/** Remember this phone so reminders can be sent to it. */
export async function savePushSubscription(sub: Sub, device: string) {
  const user = await requireUser();
  const endpoint = String(sub?.endpoint ?? "");
  const p256dh = String(sub?.keys?.p256dh ?? "");
  const auth = String(sub?.keys?.auth ?? "");
  if (!/^https:\/\//.test(endpoint) || !p256dh || !auth) return { ok: false };
  const data = { userId: user.id, p256dh, auth, device: device.slice(0, 60) };
  await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: { endpoint, ...data },
    update: data,
  });
  return { ok: true };
}

export async function removePushSubscription(endpoint: string) {
  const user = await requireUser();
  await prisma.pushSubscription.deleteMany({
    where: { endpoint, userId: user.id },
  });
}

export async function sendTestPush() {
  const user = await requireUser();
  const act = user.role === "ARTIST";
  const reached = await sendPush({
    kind: "TEST",
    agencyId: user.agencyId,
    userId: user.id,
    payload: {
      title: "Notifications are on",
      body: act ? "This is how Gigsaw will remind you about your bookings." : "This is how Gigsaw will tell you about new enquiries.",
      url: act ? "/app" : "/enquiries",
      tag: "test",
    },
    ttlSeconds: 600,
  });
  return { reached };
}

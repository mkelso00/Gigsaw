"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { answerOffer } from "@/lib/offers";
import { actIdsFor } from "@/lib/people";

// Answering gig offers: from the private link in the offer message (no login), or from the
// artist app. The link's token is the only key, so it must match an open offer.

async function byToken(token: string) {
  if (!token || token.length < 20) return null;
  return prisma.booking.findUnique({ where: { offerToken: token }, select: { id: true, artistId: true, agencyId: true } });
}

export async function answerByToken(token: string, answer: "ACCEPTED" | "DECLINED") {
  const b = await byToken(token);
  if (!b) return { ok: false, message: "This link isn't valid." };
  const done = await answerOffer(b.id, answer);
  revalidatePath(`/o/${token}`);
  return done
    ? { ok: true, message: answer === "ACCEPTED" ? "Accepted. The booking is confirmed." : "Declined. We've let the agency know." }
    : { ok: false, message: "This offer isn't open any more." };
}

/** Accept every open offer for the same act as this link. */
export async function acceptAllByToken(token: string) {
  const b = await byToken(token);
  if (!b?.artistId) return { ok: false, message: "This link isn't valid." };
  const open = await prisma.booking.findMany({
    where: { agencyId: b.agencyId, artistId: b.artistId, status: "AWAITING", offerResponse: null },
    select: { id: true },
  });
  let n = 0;
  for (const o of open) if (await answerOffer(o.id, "ACCEPTED")) n++;
  revalidatePath(`/o/${token}`);
  return { ok: true, message: `Accepted ${n} booking${n === 1 ? "" : "s"}.` };
}

/** From the artist app: only gigs for acts this login belongs to. */
export async function answerInApp(bookingId: string, answer: "ACCEPTED" | "DECLINED") {
  const user = await requireUser(["ARTIST"]);
  const b = await prisma.booking.findFirst({ where: { id: bookingId, agencyId: user.agencyId }, select: { artistId: true } });
  if (!b?.artistId || !(await actIdsFor(user)).includes(b.artistId)) return;
  await answerOffer(bookingId, answer);
  revalidatePath("/app");
}

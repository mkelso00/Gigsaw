"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { offerIsBound, offerState, openOffersWhere } from "@/lib/offer-links";
import { answerOffer } from "@/lib/offers";
import { actIdsFor } from "@/lib/people";

// Answering gig offers: from the private link in the offer message (no login), or from the
// artist app. The link's token is the only key, so it must match an open offer for the act it
// was sent to.

const NOT_OPEN = { ok: false, message: "This offer isn't open any more." };

async function byToken(token: string) {
  if (!token || token.length < 20) return null;
  return prisma.booking.findUnique({
    where: { offerToken: token },
    select: { id: true, artistId: true, offeredArtistId: true, agencyId: true, status: true, offerResponse: true, setStart: true },
  });
}

export async function answerByToken(token: string, answer: "ACCEPTED" | "DECLINED") {
  const b = await byToken(token);
  if (!b || offerState(b) !== "OPEN") return NOT_OPEN;
  const done = await answerOffer(b.id, answer, { artistId: b.artistId!, token });
  revalidatePath(`/o/${token}`);
  return done ? { ok: true, message: answer === "ACCEPTED" ? "Accepted. The booking is confirmed." : "Declined. We've let the agency know." } : NOT_OPEN;
}

/** Accept every open offer for the act this link was sent to. */
export async function acceptAllByToken(token: string) {
  const b = await byToken(token);
  if (!b || !offerIsBound(b)) return NOT_OPEN;
  const open = await prisma.booking.findMany({ where: openOffersWhere(b.agencyId, b.artistId), select: { id: true } });
  let n = 0;
  for (const o of open) if (await answerOffer(o.id, "ACCEPTED", { artistId: b.artistId })) n++;
  revalidatePath(`/o/${token}`);
  return { ok: true, message: `Accepted ${n} booking${n === 1 ? "" : "s"}.` };
}

/** From the artist app: only gigs for acts this login belongs to. */
export async function answerInApp(bookingId: string, answer: "ACCEPTED" | "DECLINED") {
  const user = await requireUser(["ARTIST"]);
  const b = await prisma.booking.findFirst({ where: { id: bookingId, agencyId: user.agencyId }, select: { artistId: true } });
  if (!b?.artistId || !(await actIdsFor(user)).includes(b.artistId)) return;
  await answerOffer(bookingId, answer, { artistId: b.artistId });
  revalidatePath("/app");
}

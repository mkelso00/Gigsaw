// The rules for offer links, kept apart from the database so they can be tested. A link is bound
// to the act it was sent to (offeredArtistId): it only works while that act is still on the
// booking, so an old link never shows or accepts an offer that has moved to another act.

type Bound = { artistId: string | null; offeredArtistId: string | null };
type Offer = Bound & { status: string; offerResponse: string | null; setStart: Date };

/** Is the booking's offer still for the act it was sent to? */
export function offerIsBound(b: Bound): b is Bound & { artistId: string; offeredArtistId: string } {
  return !!b.artistId && b.offeredArtistId === b.artistId;
}

export type OfferState = "OPEN" | "ACCEPTED" | "DECLINED" | "CANCELLED" | "PASSED" | "WITHDRAWN";

/** Where an offer stands, as its link sees it. Only an OPEN offer can be answered. */
export function offerState(b: Offer, now = new Date()): OfferState {
  if (!offerIsBound(b)) return "WITHDRAWN";
  if (b.status === "CANCELLED") return "CANCELLED";
  if (b.offerResponse === "ACCEPTED" || ["HOLD", "CONFIRMED", "SETTLED"].includes(b.status)) return "ACCEPTED";
  if (b.offerResponse === "DECLINED") return "DECLINED";
  if (b.status !== "AWAITING") return "WITHDRAWN";
  if (b.setStart < now) return "PASSED";
  return "OPEN";
}

/** The act's open offers in one business, for the offer page and "Accept all". */
export function openOffersWhere(agencyId: string, artistId: string, now = new Date()) {
  return { agencyId, artistId, offeredArtistId: artistId, status: "AWAITING", offerResponse: null, offerToken: { not: null }, setStart: { gte: now } };
}

/**
 * The condition for recording an answer: still awaiting confirmation, not answered yet, and still
 * for the act that was asked (and, from a link, still that link). Used with updateMany, so of two
 * taps at once only one changes the row.
 */
export function answerClaimWhere(bookingId: string, expect: { artistId: string; token?: string }) {
  return {
    id: bookingId,
    status: "AWAITING",
    offerResponse: null,
    artistId: expect.artistId,
    offeredArtistId: expect.artistId,
    ...(expect.token ? { offerToken: expect.token } : {}),
  };
}

const noOffer = { offerToken: null, offeredArtistId: null };

/**
 * What to clear on a booking when it changes: a different act (or none) gets rid of the old
 * act's link and answer; cancelling gets rid of the link. A new link is made when the offer is
 * sent again.
 */
export function offerResetFor(before: { artistId: string | null; status?: string }, after: { artistId?: string | null; status?: string }) {
  if (after.artistId !== undefined && after.artistId !== before.artistId) return { ...noOffer, offeredAt: null, offerResponse: null, respondedAt: null };
  if (after.status === "CANCELLED" && before.status !== "CANCELLED") return noOffer;
  return {};
}

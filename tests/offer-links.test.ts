import { describe, expect, it } from "vitest";
import { answerClaimWhere, offerIsBound, offerResetFor, offerState, openOffersWhere } from "@/lib/offer-links";

const now = new Date("2026-11-04T12:00:00Z");
const offer = (over: Partial<Parameters<typeof offerState>[0]> = {}) => ({
  artistId: "actA",
  offeredArtistId: "actA",
  status: "AWAITING",
  offerResponse: null,
  setStart: new Date("2026-11-10T20:00:00Z"),
  ...over,
});

describe("offerIsBound", () => {
  it("holds only while the booking's act is the act the offer went to", () => {
    expect(offerIsBound({ artistId: "actA", offeredArtistId: "actA" })).toBe(true);
    expect(offerIsBound({ artistId: "actB", offeredArtistId: "actA" })).toBe(false);
    expect(offerIsBound({ artistId: null, offeredArtistId: "actA" })).toBe(false);
    expect(offerIsBound({ artistId: "actA", offeredArtistId: null })).toBe(false);
    expect(offerIsBound({ artistId: null, offeredArtistId: null })).toBe(false);
  });
});

describe("offerState", () => {
  it("is open while awaiting an answer from the act it was sent to", () => {
    expect(offerState(offer(), now)).toBe("OPEN");
  });

  it("is withdrawn for the old act once the booking has moved to another act", () => {
    // The P0: act A's old link must not show or answer act B's offer.
    expect(offerState(offer({ artistId: "actB" }), now)).toBe("WITHDRAWN");
    expect(offerState(offer({ artistId: null }), now)).toBe("WITHDRAWN");
    // Even if B has since accepted, A's link learns nothing about it.
    expect(offerState(offer({ artistId: "actB", status: "CONFIRMED", offerResponse: "ACCEPTED" }), now)).toBe("WITHDRAWN");
  });

  it("is closed once answered", () => {
    expect(offerState(offer({ offerResponse: "ACCEPTED", status: "CONFIRMED" }), now)).toBe("ACCEPTED");
    expect(offerState(offer({ offerResponse: "DECLINED" }), now)).toBe("DECLINED");
    // Confirmed by the agent without the act answering.
    expect(offerState(offer({ status: "CONFIRMED" }), now)).toBe("ACCEPTED");
  });

  it("is closed when cancelled, taken back to Pending, or past", () => {
    expect(offerState(offer({ status: "CANCELLED" }), now)).toBe("CANCELLED");
    expect(offerState(offer({ status: "CANCELLED", offerResponse: "ACCEPTED" }), now)).toBe("CANCELLED");
    expect(offerState(offer({ status: "PENDING" }), now)).toBe("WITHDRAWN");
    expect(offerState(offer({ setStart: new Date("2026-11-04T11:59:00Z") }), now)).toBe("PASSED");
  });
});

describe("answerClaimWhere", () => {
  it("only matches an unanswered offer for the expected act", () => {
    expect(answerClaimWhere("b1", { artistId: "actA" })).toEqual({
      id: "b1",
      status: "AWAITING",
      offerResponse: null,
      artistId: "actA",
      offeredArtistId: "actA",
    });
  });

  it("also pins the link's token when answering from a link", () => {
    expect(answerClaimWhere("b1", { artistId: "actA", token: "t".repeat(24) })).toMatchObject({ offerToken: "t".repeat(24), offeredArtistId: "actA" });
  });
});

describe("openOffersWhere", () => {
  it("lists only offers bound to this act, unanswered and still to come", () => {
    expect(openOffersWhere("ag1", "actA", now)).toEqual({
      agencyId: "ag1",
      artistId: "actA",
      offeredArtistId: "actA",
      status: "AWAITING",
      offerResponse: null,
      offerToken: { not: null },
      setStart: { gte: now },
    });
  });
});

describe("offerResetFor", () => {
  const before = { artistId: "actA", status: "AWAITING" };
  const cleared = { offerToken: null, offeredArtistId: null, offeredAt: null, offerResponse: null, respondedAt: null };

  it("clears the old act's link and answer when the act changes or is removed", () => {
    expect(offerResetFor(before, { artistId: "actB" })).toEqual(cleared);
    expect(offerResetFor(before, { artistId: null })).toEqual(cleared);
    expect(offerResetFor({ artistId: null }, { artistId: "actA" })).toEqual(cleared);
  });

  it("clears the link when the booking is cancelled", () => {
    expect(offerResetFor(before, { artistId: "actA", status: "CANCELLED" })).toEqual({ offerToken: null, offeredArtistId: null });
    expect(offerResetFor(before, { status: "CANCELLED" })).toEqual({ offerToken: null, offeredArtistId: null });
  });

  it("leaves the link alone for other edits", () => {
    expect(offerResetFor(before, { artistId: "actA", status: "AWAITING" })).toEqual({});
    expect(offerResetFor(before, { status: "CONFIRMED" })).toEqual({});
    expect(offerResetFor({ artistId: "actA", status: "CANCELLED" }, { status: "CANCELLED" })).toEqual({});
    expect(offerResetFor(before, {})).toEqual({});
  });
});

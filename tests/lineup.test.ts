import { describe, expect, it } from "vitest";
import { onGig } from "@/lib/lineup";

describe("who's on a gig", () => {
  const gig = {
    artistId: "band",
    lineup: [
      { personId: "sally", change: "OUT" },
      { personId: "dana", change: "IN" },
    ],
  };
  it("goes by the act, less anyone off, plus stand-ins", () => {
    expect(onGig(gig, ["band"], "gary")).toBe(true);
    expect(onGig(gig, ["band"], "sally")).toBe(false);
    expect(onGig(gig, [], "dana")).toBe(true);
    expect(onGig(gig, [], "someone")).toBe(false);
    // An act's own login (no person) just goes by its acts.
    expect(onGig(gig, ["band"], null)).toBe(true);
  });
});

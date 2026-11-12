import { describe, expect, it } from "vitest";
import { dealBreakdown } from "@/lib/money";
import {
  answerProblem,
  canAnswer,
  canEdit,
  canNewVersion,
  canResend,
  canSend,
  canWithdraw,
  draftMoney,
  effectiveStatus,
  eventKindFor,
  lineDeal,
  looksLikeProposalToken,
  nextProposalNumber,
  parseProposalLines,
  proposalRef,
  proposalTotals,
  spreadDeposit,
  statusLabel,
  tokenExpiry,
  tokenOpens,
} from "@/lib/proposals";

const today = "2026-11-04";
const q = (status: string, more: Partial<{ supersededById: string | null; validUntil: string | null }> = {}) => ({
  status,
  supersededById: null,
  validUntil: "2026-11-18",
  ...more,
});

describe("proposal totals", () => {
  const lines = [
    { saleMinor: 45000, costMinor: 30000, vatPct: 20 }, // ceremony singer
    { saleMinor: 180000, costMinor: 140000, vatPct: 20 }, // evening band
    { saleMinor: 30000, costMinor: null, vatPct: 0 }, // DJ, fee not agreed yet
  ];

  it("adds the lines up with dealBreakdown, booking fee on the first line only", () => {
    const t = proposalTotals(lines, 5000);
    expect(t.saleMinor).toBe(255000);
    expect(t.bookingFeeMinor).toBe(5000);
    // VAT on the first line includes its booking fee: (45000 + 5000) * 20% + 180000 * 20%.
    expect(t.vatMinor).toBe(10000 + 36000);
    expect(t.totalMinor).toBe(255000 + 5000 + 46000);
    expect(t.costMinor).toBe(170000);
    // What the agency makes: sale less cost, plus the booking fee.
    expect(t.agencyMinor).toBe(255000 - 170000 + 5000);
    expect(t.costMissing).toBe(true);
    // Exactly what the bookings will say once it's accepted.
    const asBookings = lines.map((l, i) => dealBreakdown(lineDeal(l, i === 0 ? 5000 : 0)));
    expect(t.totalMinor).toBe(asBookings.reduce((s, d) => s + d.totalDueMinor, 0));
    expect(t.lines[1].bookingFeeMinor).toBe(0);
  });

  it("works with nothing on it yet", () => {
    expect(proposalTotals([], 5000)).toMatchObject({ saleMinor: 0, totalMinor: 5000, agencyMinor: 5000, costMissing: false });
    expect(proposalTotals([{ saleMinor: 10000, costMinor: 8000, vatPct: 0 }], 0)).toMatchObject({ totalMinor: 10000, agencyMinor: 2000, costMissing: false });
  });

  it("reads the editor's typing safely for live totals", () => {
    expect(draftMoney({ sale: "1,250.50", cost: "", vatPct: "20" }, "GBP")).toEqual({ saleMinor: 125050, costMinor: null, vatPct: 20 });
    expect(draftMoney({ sale: "abc", cost: "-5", vatPct: "500" }, "GBP")).toEqual({ saleMinor: 0, costMinor: 0, vatPct: 0 });
  });

  it("shares the deposit across the bookings in line order", () => {
    expect(spreadDeposit(50000, [30000, 100000])).toEqual([30000, 20000]);
    expect(spreadDeposit(10000, [30000, 100000])).toEqual([10000, 0]);
    // More than everything costs: the rest goes on the last.
    expect(spreadDeposit(200000, [30000, 100000])).toEqual([30000, 170000]);
    expect(spreadDeposit(0, [30000])).toEqual([0]);
    expect(spreadDeposit(5000, [])).toEqual([]);
  });
});

describe("proposal statuses", () => {
  it("expires a sent proposal after its valid-until date without anything having to run", () => {
    expect(effectiveStatus(q("SENT"), today)).toBe("SENT");
    expect(effectiveStatus(q("VIEWED", { validUntil: "2026-11-04" }), today)).toBe("VIEWED"); // the last day still counts
    expect(effectiveStatus(q("VIEWED", { validUntil: "2026-11-03" }), today)).toBe("EXPIRED");
    expect(effectiveStatus(q("SENT", { validUntil: null }), today)).toBe("SENT");
    // Answered proposals stay answered.
    expect(effectiveStatus(q("ACCEPTED", { validUntil: "2026-01-01" }), today)).toBe("ACCEPTED");
    expect(effectiveStatus(q("NONSENSE"), today)).toBe("DRAFT");
  });

  it("only lets the customer answer a live, current version", () => {
    expect(canAnswer(q("SENT"), today)).toBe(true);
    expect(canAnswer(q("VIEWED"), today)).toBe(true);
    for (const s of ["DRAFT", "ACCEPTED", "DECLINED", "WITHDRAWN", "EXPIRED"]) expect(canAnswer(q(s), today)).toBe(false);
    expect(canAnswer(q("SENT", { validUntil: "2026-11-01" }), today)).toBe(false);
    expect(canAnswer(q("SENT", { supersededById: "newer" }), today)).toBe(false);
  });

  it("tells the customer why they can't answer", () => {
    expect(answerProblem(q("SENT"), today)).toBeNull();
    expect(answerProblem(q("SENT", { supersededById: "newer" }), today)).toMatch(/updated/);
    expect(answerProblem(q("SENT", { validUntil: "2026-10-01" }), today)).toMatch(/expired/);
    expect(answerProblem(q("WITHDRAWN"), today)).toMatch(/withdrawn/);
    expect(answerProblem(q("ACCEPTED"), today)).toMatch(/accepted/);
    expect(answerProblem(q("DECLINED"), today)).toMatch(/declined/);
  });

  it("edits drafts in place and changes sent proposals by a new version", () => {
    expect(canEdit(q("DRAFT"))).toBe(true);
    expect(canSend(q("DRAFT"))).toBe(true);
    expect(canEdit(q("SENT"))).toBe(false);
    expect(canNewVersion(q("DRAFT"))).toBe(false);
    for (const s of ["SENT", "VIEWED", "DECLINED", "EXPIRED", "WITHDRAWN"]) expect(canNewVersion(q(s))).toBe(true);
    // Accepted: the bookings exist, change those. Replaced: change the newer one.
    expect(canNewVersion(q("ACCEPTED"))).toBe(false);
    expect(canNewVersion(q("SENT", { supersededById: "newer" }))).toBe(false);
  });

  it("resends and withdraws only proposals that are out with the customer", () => {
    expect(canResend(q("VIEWED"), today)).toBe(true);
    expect(canResend(q("VIEWED", { validUntil: "2026-10-01" }), today)).toBe(false);
    expect(canWithdraw(q("SENT"))).toBe(true);
    expect(canWithdraw(q("EXPIRED"))).toBe(true);
    expect(canWithdraw(q("ACCEPTED"))).toBe(false);
    expect(canWithdraw(q("DRAFT"))).toBe(false);
    expect(canWithdraw(q("SENT", { supersededById: "newer" }))).toBe(false);
  });

  it("labels replaced versions as updated", () => {
    expect(statusLabel(q("VIEWED"), today)).toBe("Opened");
    expect(statusLabel(q("VIEWED", { supersededById: "newer" }), today)).toBe("Updated");
    expect(statusLabel(q("SENT", { validUntil: "2026-10-01" }), today)).toBe("Expired");
  });

  it("numbers proposals and their versions", () => {
    expect(nextProposalNumber(null)).toBe("Q-0001");
    expect(nextProposalNumber(41)).toBe("Q-0042");
    expect(proposalRef({ number: "Q-0042", version: 1 })).toBe("Q-0042");
    expect(proposalRef({ number: "Q-0042", version: 3 })).toBe("Q-0042 v3");
    expect(eventKindFor("WEDDING")).toBe("WEDDING");
    expect(eventKindFor("GIG")).toBe("OTHER");
  });
});

describe("the customer's link", () => {
  it("only looks up strong random tokens", () => {
    expect(looksLikeProposalToken("a".repeat(32))).toBe(true);
    expect(looksLikeProposalToken("Ab-_".repeat(8))).toBe(true);
    expect(looksLikeProposalToken("short")).toBe(false);
    expect(looksLikeProposalToken("a".repeat(31) + "/")).toBe(false);
    expect(looksLikeProposalToken(undefined)).toBe(false);
  });

  it("is bound to its own version and stops opening after it runs out", () => {
    const token = "t".repeat(32);
    const live = { token, tokenExpiresAt: new Date("2027-12-01T00:00:00Z") };
    const now = new Date("2026-11-04T12:00:00Z");
    expect(tokenOpens(live, token, now)).toBe(true);
    expect(tokenOpens(live, "u".repeat(32), now)).toBe(false);
    expect(tokenOpens({ token: null, tokenExpiresAt: null }, token, now)).toBe(false);
    expect(tokenOpens(live, token, new Date("2027-12-02T00:00:00Z"))).toBe(false);
  });

  it("runs out well after the event (or the valid-until date, if later)", () => {
    expect(tokenExpiry(["2027-06-12", "2027-06-11"], "2026-11-18").toISOString()).toBe("2027-09-10T23:59:59.000Z");
    expect(tokenExpiry(["2026-11-10"], "2026-12-01").toISOString()).toBe("2027-03-01T23:59:59.000Z");
  });
});

describe("checking the editor's lines", () => {
  const own = { artistIds: new Set(["act1"]), venueIds: new Set(["ven1"]) };
  const good = {
    artistId: "act1",
    description: "Evening band",
    date: "2027-06-12",
    arriveTime: "18:00",
    startTime: "19:30",
    endTime: "23:30",
    venueId: "",
    place: "Marquee at Home Farm",
    sale: "1,800",
    cost: "1400.00",
    vatPct: "20",
  };
  const parse = (lines: unknown[]) => parseProposalLines(JSON.stringify(lines), "GBP", own);

  it("turns what was typed into minor units", () => {
    expect(parse([good])).toEqual([
      {
        artistId: "act1",
        description: "Evening band",
        date: "2027-06-12",
        arriveTime: "18:00",
        startTime: "19:30",
        endTime: "23:30",
        venueId: null,
        place: "Marquee at Home Farm",
        saleMinor: 180000,
        costMinor: 140000,
        vatPct: 20,
      },
    ]);
  });

  it("keeps only the agency's own acts and venues", () => {
    const [l] = parse([{ ...good, artistId: "someone-elses", venueId: "ven1" }]);
    expect(l.artistId).toBeNull(); // act to be confirmed
    expect(l.venueId).toBe("ven1");
    expect(l.place).toBe("");
    expect(parse([{ ...good, venueId: "not-ours" }])[0]).toMatchObject({ venueId: null, place: "Marquee at Home Farm" });
  });

  it("leaves the act's fee empty when it isn't known", () => {
    expect(parse([{ ...good, cost: "" }])[0].costMinor).toBeNull();
  });

  it("explains what's wrong, naming the line", () => {
    expect(() => parse([good, { ...good, startTime: "" }])).toThrow("start time on line 2");
    expect(() => parse([{ ...good, date: "12/06/2027" }])).toThrow("Choose the date");
    expect(() => parse([{ ...good, sale: "lots" }])).toThrow("price");
    expect(() => parse([{ ...good, cost: "-5" }])).toThrow("negative");
    expect(() => parse([{ ...good, vatPct: "120" }])).toThrow("VAT");
    expect(() => parse(Array(31).fill(good))).toThrow("up to 30");
    expect(() => parseProposalLines("{nope", "GBP", own)).toThrow("couldn't be read");
  });
});

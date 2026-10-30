import { describe, expect, it } from "vitest";
import { buildChecklist, type ChecklistBooking } from "@/lib/checklist";
import {
  asContractDoc,
  bookingContractDoc,
  canonicalJson,
  checkSignature,
  checkSignerName,
  clientIp,
  contractChanges,
  contractHash,
  contractState,
  contractStatusLabel,
  currentContract,
  eventContractDoc,
  type ContractBooking,
  type ContractEvent,
} from "@/lib/contract-doc";

const settings = { agencyName: "Northern Lights", agencyAddress: "1 High St", agencyEmail: "hi@nl.test", contractTerms: "Cancel 30 days ahead." };

const booking: ContractBooking = {
  reference: "GS-0042",
  eventType: "WEDDING",
  eventName: "Hannah and Sam",
  timezone: "Europe/London",
  arriveBy: new Date("2026-06-13T17:00:00Z"),
  soundcheckAt: null,
  setStart: new Date("2026-06-13T19:00:00Z"),
  setEnd: new Date("2026-06-13T22:00:00Z"),
  currency: "GBP",
  dealType: "BUY_SELL",
  feeMinor: 150000,
  artistFeeMinor: 90000,
  commissionPct: 15,
  vatPct: 20,
  bookingFeeMinor: 10000,
  depositMinor: 50000,
  depositDueDate: new Date("2026-03-01T12:00:00Z"),
  dealNotes: "",
  radiusKm: null,
  radiusDays: null,
  hospitality: "",
  dayContact: "Jo 07700 900000",
  artist: { name: "Ellie Rose" },
  venue: { name: "The Barn", address: "Farm Lane", city: "York", country: "UK" },
  promoter: { name: "Hannah Smith", company: "Private client", address: "2 Low St" },
};

const rowsOf = (doc: ReturnType<typeof bookingContractDoc>) => Object.fromEntries(doc.sections.flatMap((s) => s.rows));

describe("booking contract", () => {
  it("shows what the client pays and never what the act is paid", () => {
    const doc = bookingContractDoc(booking, settings);
    const rows = rowsOf(doc);
    expect(doc.client).toBe("Hannah Smith");
    expect(rows.Fee).toBe("£1,500.00");
    expect(rows["Booking fee"]).toBe("£100.00");
    expect(rows["Total payable"]).toBe("£1,920.00");
    expect(rows.Balance).toBe("£1,420.00");
    expect(rows.Act).toBe("Ellie Rose");
    expect(JSON.stringify(doc)).not.toContain("900.00");
    expect(doc.sections.at(-1)).toMatchObject({ heading: "Terms", text: "Cancel 30 days ahead.", key: false });
  });
  it("leaves out empty rows and the terms section when there are no terms", () => {
    const doc = bookingContractDoc({ ...booking, bookingFeeMinor: 0, depositMinor: 0 }, { ...settings, contractTerms: " " });
    const rows = rowsOf(doc);
    expect(rows["Booking fee"]).toBeUndefined();
    expect(rows.Deposit).toBeUndefined();
    expect(rows.Soundcheck).toBeUndefined();
    expect(doc.sections.map((s) => s.heading)).toEqual(["Engagement", "Fee", "Hospitality and production"]);
  });
});

describe("event contract", () => {
  const gig = (name: string | null, sale: number, cost: number, status = "CONFIRMED") => ({
    ...booking,
    status,
    feeMinor: sale,
    artistFeeMinor: cost,
    bookingFeeMinor: 0,
    depositMinor: 0,
    artist: name ? { name } : null,
  });
  const event: ContractEvent = {
    name: "Hannah and Sam's wedding",
    type: "WEDDING",
    date: "2026-06-13",
    venueText: "",
    venue: booking.venue,
    customer: booking.promoter,
    reference: "GS-0042",
    bookings: [gig("Ceremony Strings", 60000, 40000), gig("The Band", 200000, 150000), gig("DJ Max", 50000, 30000, "CANCELLED"), gig(null, 1, 1, "ENQUIRY")],
  };
  it("covers every act in one contract, leaving out cancelled gigs and enquiries", () => {
    const doc = eventContractDoc(event, settings);
    expect(doc.acts).toBe("Ceremony Strings and The Band");
    expect(doc.plural).toBe(true);
    const perf = doc.sections.find((s) => s.heading === "Performances")!;
    expect(perf.rows.map(([k]) => k)).toEqual(["Ceremony Strings", "The Band"]);
    const fee = Object.fromEntries(doc.sections.find((s) => s.heading === "Fee")!.rows);
    expect(fee["The Band"]).toBe("£2,000.00");
    expect(fee["Total payable"]).toBe("£3,120.00");
    const later = eventContractDoc({ ...event, bookings: [event.bookings[0], { ...event.bookings[1], feeMinor: 210000 }] }, settings);
    expect(contractChanges(doc, later)).toEqual(["The Band (fee)", "VAT", "Total payable"]);
    // Never the acts' own fees.
    expect(JSON.stringify(doc)).not.toMatch(/1,500\.00|400\.00/);
  });
});

describe("hash and changes", () => {
  it("gives the same hash for the same contract, after a trip through the database", () => {
    const doc = bookingContractDoc(booking, settings);
    const stored = asContractDoc(JSON.parse(JSON.stringify(doc)))!;
    expect(contractHash(stored)).toBe(contractHash(doc));
    expect(contractHash(doc)).toMatch(/^[0-9a-f]{64}$/);
    expect(canonicalJson({ b: 1, a: [2, { d: undefined, c: "x" }] })).toBe('{"a":[2,{"c":"x"}],"b":1}');
    expect(contractHash(bookingContractDoc({ ...booking, feeMinor: 150001 }, settings))).not.toBe(contractHash(doc));
  });
  it("lists the details that changed since signing, ignoring the agency's standard terms", () => {
    const signed = bookingContractDoc(booking, settings);
    expect(contractChanges(signed, bookingContractDoc(booking, { ...settings, contractTerms: "New terms" }))).toEqual([]);
    const later = bookingContractDoc({ ...booking, feeMinor: 160000, setStart: new Date("2026-06-13T19:30:00Z") }, settings);
    expect(contractChanges(signed, later)).toEqual(["Performance", "Fee", "VAT", "Total payable", "Balance"]);
    expect(contractChanges(signed, bookingContractDoc({ ...booking, artist: { name: "Jo Drummond" } }, settings))).toEqual(["Act"]);
  });
});

describe("status", () => {
  const base = { sentAt: new Date("2026-11-01T10:00:00Z"), viewedAt: null, signedAt: null, signedName: "" };
  it("reads Not sent, Sent, Viewed and Signed", () => {
    expect(contractStatusLabel(null, "Europe/London")).toBe("Not sent");
    expect(contractStatusLabel({ ...base, status: "SENT" }, "Europe/London")).toBe("Sent Sun, 1 Nov 2026");
    expect(contractState({ ...base, status: "SENT", viewedAt: new Date() })).toBe("VIEWED");
    expect(contractStatusLabel({ ...base, status: "SIGNED", signedAt: new Date("2026-11-03T10:00:00Z"), signedName: "Hannah Smith" }, "Europe/London")).toBe(
      "Signed by Hannah Smith, Tue, 3 Nov 2026",
    );
    expect(contractState({ ...base, status: "CANCELLED" })).toBe("NONE");
  });
  it("counts the latest contract that wasn't cancelled", () => {
    const old = { ...base, id: "a", status: "SIGNED" };
    const newer = { ...base, id: "b", status: "CANCELLED", sentAt: new Date("2026-11-05T10:00:00Z") };
    expect(currentContract([newer, old])?.id).toBe("a");
    expect(currentContract([{ ...newer, status: "SENT" }, old])?.id).toBe("b");
    expect(currentContract([])).toBeNull();
  });
});

describe("what the signer sends", () => {
  // A real 1x1 PNG, padded out so it's a believable size.
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200)]).toString("base64");
  it("accepts a PNG data URL and nothing else", () => {
    expect(checkSignature(`data:image/png;base64,${png}`)).toBeTruthy();
    expect(checkSignature("data:image/png;base64,AAAA")).toBeNull();
    expect(checkSignature(`data:image/svg+xml;base64,${png}`)).toBeNull();
    expect(checkSignature(`data:image/png;base64,${Buffer.alloc(300).toString("base64")}`)).toBeNull();
    expect(checkSignature("")).toBeNull();
  });
  it("needs a real typed name", () => {
    expect(checkSignerName("  Hannah   Smith ")).toBe("Hannah Smith");
    expect(checkSignerName("x")).toBeNull();
    expect(checkSignerName("12345")).toBeNull();
    expect(checkSignerName("Zoë Ó")).toBe("Zoë Ó");
  });
  it("takes the client's address from the proxy headers", () => {
    const h = (m: Record<string, string>) => (k: string) => m[k] ?? null;
    expect(clientIp(h({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }))).toBe("203.0.113.9");
    expect(clientIp(h({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientIp(h({}))).toBe("");
  });
});

describe("checklist", () => {
  const b: ChecklistBooking = {
    id: "b1",
    reference: "GS-0001",
    status: "CONFIRMED",
    artistId: "a1",
    timezone: "Europe/London",
    arriveBy: new Date("2026-11-05T19:00:00Z"),
    setStart: new Date("2026-11-05T20:00:00Z"),
    setEnd: null,
    venue: { name: "The Barn", latitude: 1, longitude: 1 },
    promoterId: "p1",
    eventType: "WEDDING",
    feeMinor: 100000,
    dealType: "STANDARD_COMMISSION",
    artistFeeMinor: null,
    depositMinor: 0,
    depositDueDate: null,
    radiusKm: null,
    radiusDays: null,
    travel: "Train",
    dayContact: "Sam",
  };
  const item = (over: Partial<ChecklistBooking>) =>
    buildChecklist({ ...b, ...over }, [], 0, new Date("2026-11-01")).find((i) => i.label.startsWith("Contract"));
  it("warns when a confirmed booking's contract isn't signed", () => {
    expect(item({ contract: { state: "NONE", changed: false } })).toMatchObject({ level: "warning", label: "Contract not signed" });
    expect(item({ contract: { state: "VIEWED", changed: false } })?.detail).toContain("opened");
    expect(item({ contract: { state: "SIGNED", changed: false } })).toMatchObject({ level: "ok", label: "Contract signed" });
    expect(item({ contract: { state: "SIGNED", changed: true } })).toMatchObject({ level: "warning", label: "Contract changed since signing" });
  });
  it("doesn't chase unconfirmed bookings, bar gigs with no contract sent, or callers that don't check", () => {
    expect(item({ status: "PENDING", contract: { state: "NONE", changed: false } })).toBeUndefined();
    expect(item({ eventType: "GIG", contract: { state: "NONE", changed: false } })).toBeUndefined();
    expect(item({ eventType: "GIG", contract: { state: "SENT", changed: false } })?.level).toBe("warning");
    expect(item({})).toBeUndefined();
  });
});

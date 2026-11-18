import { describe, expect, it } from "vitest";
import {
  eventTypesFrom,
  eventTypesLabel,
  pickContract,
  reasonLabel,
  resolveContract,
  shadowedEventTypes,
  sortTemplates,
  STARTER_CONTRACTS,
  termsText,
  usageLines,
} from "@/lib/contract-templates";

// Which contract type a proposal, booking or wedding uses: the one chosen, then the client's own, then the
// first whose event types include the event's type, then the default, then none.

const t = (id: string, eventTypes: string[] = [], isDefault = false, sort = 0) => ({
  id,
  name: `${id} contract`,
  terms: `${id} terms`,
  eventTypes,
  isDefault,
  sort,
});
const wedding = t("wedding", ["WEDDING"], false, 0);
const corporate = t("corporate", ["CORPORATE"], false, 1);
const small = t("small", ["PRIVATE_PARTY", "OTHER"], false, 2);
const standard = t("standard", [], true, 3);
const all = [wedding, corporate, small, standard];

describe("pickContract", () => {
  it("uses the one chosen first, whatever the client or event type", () => {
    expect(pickContract(all, { chosenId: "small", clientTemplateId: "corporate", eventType: "WEDDING" })).toBe(small);
    expect(resolveContract(all, { chosenId: "small" })).toEqual({ template: small, reason: "chosen" });
  });

  it("then the client's own contract, over the event type (Sony gets the Corporate contract at their wedding party)", () => {
    expect(resolveContract(all, { clientTemplateId: "corporate", eventType: "WEDDING" })).toEqual({ template: corporate, reason: "client" });
  });

  it("then the first type whose event types include the event's type", () => {
    expect(resolveContract(all, { eventType: "CORPORATE" })).toEqual({ template: corporate, reason: "eventType" });
    expect(pickContract(all, { eventType: "OTHER" })).toBe(small);
    // Two types claiming weddings: the first in the list wins, whatever order they come in.
    const second = t("second-wedding", ["WEDDING"], false, 5);
    expect(pickContract([second, ...all], { eventType: "WEDDING" })).toBe(wedding);
  });

  it("then the default, and none when there's no default", () => {
    expect(resolveContract(all, { eventType: "GIG" })).toEqual({ template: standard, reason: "default" });
    expect(pickContract(all, {})).toBe(standard);
    expect(pickContract([wedding, corporate], { eventType: "GIG" })).toBeNull();
    expect(pickContract([], { chosenId: "wedding", eventType: "WEDDING" })).toBeNull();
  });

  it("skips a chosen or client contract that has since been deleted", () => {
    expect(resolveContract(all, { chosenId: "gone", clientTemplateId: "also-gone", eventType: "CORPORATE" })).toEqual({
      template: corporate,
      reason: "eventType",
    });
    expect(pickContract(all, { chosenId: null, clientTemplateId: "gone" })).toBe(standard);
  });
});

describe("contract type helpers", () => {
  it("lists types by their sort order, keeping ties in the order given", () => {
    expect(sortTemplates([standard, small, wedding, corporate]).map((x) => x.id)).toEqual(["wedding", "corporate", "small", "standard"]);
    expect(sortTemplates([t("b", [], false, 1), t("a", [], false, 1)]).map((x) => x.id)).toEqual(["b", "a"]);
  });

  it("keeps typed wording with plain line breaks", () => {
    expect(termsText("  1. Deposit.\r\n2. Balance.\r3. Rider.\n ")).toBe("1. Deposit.\n2. Balance.\n3. Rider.");
  });

  it("keeps only known event types, in the usual order", () => {
    expect(eventTypesFrom(["OTHER", "WEDDING", "NONSENSE", "WEDDING"])).toEqual(["WEDDING", "OTHER"]);
    expect(eventTypesLabel(["CORPORATE", "WEDDING"])).toBe("Wedding, Corporate event");
  });

  it("flags event types a later type can't win", () => {
    expect(shadowedEventTypes([...all, t("party-2", ["PRIVATE_PARTY", "GIG"], false, 9)])).toEqual({ "party-2": ["PRIVATE_PARTY"] });
    expect(shadowedEventTypes(all)).toEqual({});
  });

  it("says why a contract was picked, and what still uses one", () => {
    expect(reasonLabel("eventType", "CORPORATE")).toBe("used for corporate event");
    expect(reasonLabel("client")).toBe("the client's own contract");
    expect(usageLines({ drafts: 0, sent: 0, bookings: 0, events: 0, clients: [] })).toEqual([]);
    const lines = usageLines({ drafts: 2, sent: 1, bookings: 1, events: 0, clients: ["Sony", "Rekom", "Levy UK", "Compass Group"] });
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatch(/^2 draft proposals/);
    expect(lines[1]).toBe("1 proposal went out with it. The customer's copy stays as it was sent.");
    expect(lines[2]).toMatch(/^1 booking chose it/);
    expect(lines[3]).toBe("4 clients have it as their own contract (Sony, Rekom, Levy UK and 1 more).");
  });

  it("starts the demo with one default and a type each for weddings, corporate and small events", () => {
    expect(STARTER_CONTRACTS.filter((c) => c.isDefault)).toHaveLength(1);
    const starters = STARTER_CONTRACTS.map((c, sort) => ({ ...c, id: c.name, sort }));
    expect(pickContract(starters, { eventType: "WEDDING" })?.name).toBe("Wedding contract");
    expect(pickContract(starters, { eventType: "CORPORATE" })?.name).toBe("Corporate contract");
    expect(pickContract(starters, { eventType: "PRIVATE_PARTY" })?.name).toBe("Musician hire, small events");
    expect(pickContract(starters, { eventType: "GIG" })?.name).toBe("Standard contract");
    // House style: no em dashes in the wording.
    expect(STARTER_CONTRACTS.map((c) => c.terms + c.name).join("")).not.toContain("—");
  });
});

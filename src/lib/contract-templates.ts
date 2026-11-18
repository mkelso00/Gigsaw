// Contract types: the business's saved contracts, e.g. "Wedding contract", "Corporate contract" and
// "Musician hire, small events". Which one a proposal, booking or wedding uses is decided here, in one
// place. Pure: no database, safe to unit test (the server side is contract-templates-server.ts).
//
// Proposals copy the wording into quote.terms and signed contracts keep their own copy
// (Contract.content), so changing or deleting a type never changes what a customer has agreed to.

import { EVENT_TYPES, eventTypeLabel } from "./constants";

export type ContractTemplateLike = { id: string; name: string; terms: string; eventTypes: string[]; isDefault: boolean; sort: number };

/** Why a contract was picked: chosen for this one, the client's own, by the event type, or the default. */
export type ContractReason = "chosen" | "client" | "eventType" | "default";

export type ContractPick = {
  /** The type chosen for this proposal, booking or event, if any. */
  chosenId?: string | null;
  /** The client's own contract (Contact.contractTemplateId), e.g. Sony's Corporate contract. */
  clientTemplateId?: string | null;
  /** The event's type (EVENT_TYPES), e.g. "CORPORATE". */
  eventType?: string | null;
};

/** Contract wording as typed: a text box sends its lines with \r\n, kept as plain \n so copies match the original. */
export const termsText = (s: string) => s.replace(/\r\n?/g, "\n").trim();

/** The types in the order they're listed, which is also the order "by event type" looks through them. */
export function sortTemplates<T extends Pick<ContractTemplateLike, "sort">>(templates: T[]): T[] {
  return templates
    .map((t, i) => ({ t, i }))
    .sort((a, b) => a.t.sort - b.t.sort || a.i - b.i)
    .map(({ t }) => t);
}

/**
 * The contract to use, and why: the one chosen, then the client's own, then the first whose event types
 * include the event's type, then the default. Null when the business has no contract types (or none fits
 * and there's no default). A chosen or client contract that has since been deleted is skipped.
 */
export function resolveContract<T extends ContractTemplateLike>(templates: T[], by: ContractPick): { template: T; reason: ContractReason } | null {
  const list = sortTemplates(templates);
  const byId = (id: string | null | undefined) => (id ? list.find((t) => t.id === id) : undefined);
  const chosen = byId(by.chosenId);
  if (chosen) return { template: chosen, reason: "chosen" };
  const client = byId(by.clientTemplateId);
  if (client) return { template: client, reason: "client" };
  const type = by.eventType ? list.find((t) => t.eventTypes.includes(by.eventType!)) : undefined;
  if (type) return { template: type, reason: "eventType" };
  const fallback = list.find((t) => t.isDefault);
  return fallback ? { template: fallback, reason: "default" } : null;
}

/** The contract to use (see resolveContract), or null for none. */
export function pickContract<T extends ContractTemplateLike>(templates: T[], by: ContractPick): T | null {
  return resolveContract(templates, by)?.template ?? null;
}

/** "the client's contract", "for corporate events", "the default": why a contract was picked, for a hint. */
export function reasonLabel(reason: ContractReason, eventType?: string | null): string {
  switch (reason) {
    case "chosen":
      return "chosen for this one";
    case "client":
      return "the client's own contract";
    case "eventType":
      return `used for ${eventType ? eventTypeLabel(eventType).toLowerCase() : "this type of event"}`;
    case "default":
      return "the default";
  }
}

/** The event types ticked on a contract type's form, in the usual order, unknown ones dropped. */
export function eventTypesFrom(values: string[]): string[] {
  const picked = new Set(values);
  return EVENT_TYPES.filter((t) => picked.has(t));
}

/** "Wedding, Corporate event" for a type's event types, or "" for none. */
export function eventTypesLabel(types: string[]): string {
  return eventTypesFrom(types).map(eventTypeLabel).join(", ");
}

/**
 * Event types claimed by more than one contract type: only the first in the list is used for them,
 * so the later ones are worth a warning. Keyed by template id, e.g. { b: ["WEDDING"] }.
 */
export function shadowedEventTypes<T extends ContractTemplateLike>(templates: T[]): Record<string, string[]> {
  const seen = new Set<string>();
  const out: Record<string, string[]> = {};
  for (const t of sortTemplates(templates)) {
    const lost = t.eventTypes.filter((e) => seen.has(e));
    if (lost.length) out[t.id] = lost;
    for (const e of t.eventTypes) seen.add(e);
  }
  return out;
}

/** What a contract type is still used by, said plainly for the delete check, e.g. ["2 draft proposals…", "1 client has it…"]. */
export function usageLines(u: { drafts: number; sent: number; bookings: number; events: number; clients: string[] }): string[] {
  const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  const out: string[] = [];
  if (u.drafts) out.push(`${n(u.drafts, "draft proposal", "draft proposals")} picked it. They keep the wording already in them.`);
  if (u.sent) out.push(`${n(u.sent, "proposal", "proposals")} went out with it. The customer's copy stays as it was sent.`);
  if (u.bookings) out.push(`${n(u.bookings, "booking", "bookings")} chose it. They go back to the client's contract, the event type's or the default.`);
  if (u.events)
    out.push(`${n(u.events, "wedding or event", "weddings and events")} chose it. They go back to the customer's contract, the event type's or the default.`);
  if (u.clients.length) {
    const names = u.clients.slice(0, 3).join(", ") + (u.clients.length > 3 ? ` and ${u.clients.length - 3} more` : "");
    out.push(`${n(u.clients.length, "client has", "clients have")} it as their own contract (${names}).`);
  }
  return out;
}

/**
 * Starter contract types for the demo data and the local seed: short, generic wording to show how types work.
 * A business replaces it with its own in Settings, Contracts and invoices.
 */
export const STARTER_CONTRACTS: { name: string; eventTypes: string[]; isDefault: boolean; terms: string }[] = [
  {
    name: "Wedding contract",
    eventTypes: ["WEDDING"],
    isDefault: false,
    terms: [
      "1. Your date is secured once this contract is signed and the deposit is paid. The deposit is non-refundable.",
      "2. The balance is due 4 weeks before the wedding.",
      "3. Please give the acts somewhere safe to set up, a power supply near the performance area, and a hot meal and soft drinks on the day.",
      "4. If an act can't perform through illness or emergency, we will find a replacement of the same standard or refund what you have paid for that act.",
      "5. If you cancel, money already paid is kept. Cancelling within 8 weeks of the wedding means the full fee is due.",
    ].join("\n"),
  },
  {
    name: "Corporate contract",
    eventTypes: ["CORPORATE"],
    isDefault: false,
    terms: [
      "1. The fee is invoiced to the Client and payable within 30 days of the event, unless a deposit is shown above.",
      "2. The Client provides safe access, parking or loading for equipment, a suitable performance area and a power supply.",
      "3. The Client is responsible for any venue rules, licences and noise limits, and tells us about them in advance.",
      "4. If the act can't perform through illness or emergency, we will offer a replacement of the same standard or refund the fee.",
      "5. Cancellation by the Client within 30 days of the event means the full fee is payable.",
    ].join("\n"),
  },
  {
    name: "Musician hire, small events",
    eventTypes: ["PRIVATE_PARTY", "OTHER"],
    isDefault: false,
    terms: [
      "1. The booking is confirmed once this contract is signed and any deposit is paid.",
      "2. The balance is due on or before the day of the event.",
      "3. Please provide a power supply and enough space for the act to perform safely.",
      "4. Cancellation within 14 days of the event means the full fee is payable.",
    ].join("\n"),
  },
  {
    name: "Standard contract",
    eventTypes: [],
    isDefault: true,
    terms: [
      "1. The Promoter provides the hospitality and technical requirements in the act's rider.",
      "2. Cancellation by the Promoter within 30 days of the engagement means the full fee is payable.",
      "3. The balance is payable in cleared funds no later than the night of the performance.",
    ].join("\n"),
  },
];

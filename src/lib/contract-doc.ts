// The client contract as plain data, so the printed copy, the signing page and the signed copy
// all show exactly the same thing, and so what the client saw can be hashed and kept.
// Pure: no database, safe to unit test.
//
// Privacy: this is the contract between the agency and the client. It shows what the client
// pays (fees, booking fee, VAT, deposit) and never what the act is paid.

import { createHash } from "node:crypto";
import { DEAL_TYPE_LABELS, eventTypeLabel, type DealType } from "./constants";
import { dealBreakdown, formatMoney, type DealInput } from "./money";
import { formatDate, localTime, zoneLabel } from "./time";

export type ContractRow = [label: string, value: string];
export type ContractSection = {
  heading: string;
  rows: ContractRow[];
  /** Free text under the heading, e.g. the agency's terms. */
  text?: string;
  /** False for sections that aren't about this booking (the agency's standard terms), so editing them doesn't count as a change. */
  key?: boolean;
};
export type ContractDoc = {
  version: 1;
  title: string;
  reference: string;
  agency: { name: string; address: string; email: string };
  /** Who the contract is with, e.g. "Jo Bloggs of Acme Ltd". */
  client: string;
  /** The act or acts the agency is acting for. */
  acts: string;
  plural: boolean;
  sections: ContractSection[];
};

type AgencyInfo = { agencyName: string; agencyAddress: string; agencyEmail: string; contractTerms: string };
type Party = { name: string; company: string; address: string } | null;
type VenueInfo = { name: string; address: string; city: string; country: string } | null;

const rows = (list: ContractRow[]) => list.filter(([, v]) => v !== "");
const clientName = (c: Party) => (c ? `${c.name}${c.company && c.company !== "Private client" ? ` of ${c.company}` : ""}` : "the Client");
const venueLine = (v: VenueInfo, text = "") => (v ? [v.name, v.address, v.city, v.country].filter(Boolean).join(", ") : text || "To be confirmed");
const header = (s: AgencyInfo) => ({ name: s.agencyName, address: s.agencyAddress, email: s.agencyEmail });
const terms = (s: AgencyInfo): ContractSection[] => (s.contractTerms.trim() ? [{ heading: "Terms", rows: [], text: s.contractTerms.trim(), key: false }] : []);

export type ContractBooking = DealInput & {
  reference: string;
  eventType: string;
  eventName: string;
  timezone: string;
  arriveBy: Date;
  soundcheckAt: Date | null;
  setStart: Date;
  setEnd: Date | null;
  currency: string;
  depositMinor: number;
  depositDueDate: Date | null;
  dealNotes: string;
  radiusKm: number | null;
  radiusDays: number | null;
  hospitality: string;
  dayContact: string;
  artist: { name: string } | null;
  venue: VenueInfo;
  promoter: Party;
};

/** The contract for one booking. */
export function bookingContractDoc(b: ContractBooking, s: AgencyInfo): ContractDoc {
  const tz = b.timezone;
  const d = dealBreakdown(b);
  const money = (m: number) => formatMoney(m, b.currency);
  const act = b.artist?.name ?? "Act to be confirmed";
  return {
    version: 1,
    title: "Performance contract",
    reference: b.reference,
    agency: header(s),
    client: clientName(b.promoter),
    acts: act,
    plural: false,
    sections: [
      {
        heading: "Engagement",
        rows: rows([
          ["Act", act],
          ["Type of engagement", eventTypeLabel(b.eventType)],
          ["Event", b.eventName],
          ["Venue", venueLine(b.venue)],
          ["Date", formatDate(b.arriveBy, tz)],
          ["Arrival / load-in", `${localTime(b.arriveBy, tz)} ${zoneLabel(b.arriveBy, tz)}`],
          ["Soundcheck", b.soundcheckAt ? localTime(b.soundcheckAt, tz) : ""],
          ["Performance", `${localTime(b.setStart, tz)}${b.setEnd ? ` to ${localTime(b.setEnd, tz)}` : ""}`],
          ["Client address", b.promoter?.address ?? ""],
        ]),
      },
      {
        heading: "Fee",
        rows: rows([
          ["Deal", b.dealType === "BUY_SELL" ? "" : (DEAL_TYPE_LABELS[b.dealType as DealType] ?? b.dealType)],
          ["Fee", money(d.grossMinor)],
          ["Booking fee", d.bookingFeeMinor ? money(d.bookingFeeMinor) : ""],
          ["VAT", d.vatMinor ? `${money(d.vatMinor)} (${b.vatPct}%)` : ""],
          ["Total payable", money(d.totalDueMinor)],
          ["Deposit", b.depositMinor ? `${money(b.depositMinor)}${b.depositDueDate ? `, due by ${formatDate(b.depositDueDate, tz)}` : ""}` : ""],
          ["Balance", b.depositMinor ? money(d.totalDueMinor - b.depositMinor) : ""],
          ["Deal terms", b.dealNotes],
          [
            "Radius clause",
            b.radiusKm !== null
              ? `The Client agrees the Act may not perform within ${b.radiusKm} km for ${b.radiusDays} days either side of the engagement without consent.`
              : "",
          ],
        ]),
      },
      {
        heading: "Hospitality and production",
        rows: rows([
          ["Hospitality", b.hospitality || "As per the Act's rider."],
          ["Day of show contact", b.dayContact],
        ]),
      },
      ...terms(s),
    ],
  };
}

export type ContractEventGig = DealInput & {
  status: string;
  timezone: string;
  arriveBy: Date;
  setStart: Date;
  setEnd: Date | null;
  currency: string;
  depositMinor: number;
  depositDueDate: Date | null;
  artist: { name: string } | null;
};

export type ContractEvent = {
  name: string;
  type: string;
  date: string;
  venueText: string;
  venue: VenueInfo;
  customer: Party;
  bookings: ContractEventGig[];
  /** Shown as the contract's reference, e.g. the first booking's. */
  reference: string;
};

/** Gigs that belong on an event's contract: not cancelled, and past the enquiry stage. */
export const contractGigs = <T extends { status: string }>(gigs: T[]) => gigs.filter((g) => g.status !== "CANCELLED" && g.status !== "ENQUIRY");

/** One contract for a wedding or event, covering every act the customer has booked. */
export function eventContractDoc(e: ContractEvent, s: AgencyInfo): ContractDoc {
  const gigs = contractGigs(e.bookings);
  const currency = gigs[0]?.currency ?? "GBP";
  const money = (m: number) => formatMoney(m, currency);
  const day = formatDate(new Date(`${e.date}T12:00:00Z`), "UTC");
  const names = gigs.map((g) => g.artist?.name ?? "Act to be confirmed");
  let sale = 0;
  let fees = 0;
  let vat = 0;
  let deposit = 0;
  let depositDue: Date | null = null;
  const feeRows: ContractRow[] = [];
  for (const g of gigs) {
    const d = dealBreakdown(g);
    sale += d.grossMinor;
    fees += d.bookingFeeMinor;
    vat += d.vatMinor;
    deposit += g.depositMinor;
    if (g.depositMinor && g.depositDueDate && (!depositDue || g.depositDueDate < depositDue)) depositDue = g.depositDueDate;
    feeRows.push([g.artist?.name ?? "Act to be confirmed", money(d.grossMinor)]);
  }
  const total = sale + fees + vat;
  return {
    version: 1,
    title: "Performance contract",
    reference: e.reference,
    agency: header(s),
    client: clientName(e.customer),
    acts: names.length ? listOf(names) : "the acts named below",
    plural: names.length !== 1,
    sections: [
      {
        heading: "Engagement",
        rows: rows([
          ["Event", e.name],
          ["Type of engagement", eventTypeLabel(e.type)],
          ["Venue", venueLine(e.venue, e.venueText)],
          ["Date", day],
          ["Client address", e.customer?.address ?? ""],
        ]),
      },
      {
        heading: "Performances",
        rows: gigs.map((g, i) => [
          names[i],
          `${localTime(g.setStart, g.timezone)}${g.setEnd ? ` to ${localTime(g.setEnd, g.timezone)}` : ""} (arrival ${localTime(g.arriveBy, g.timezone)} ${zoneLabel(g.arriveBy, g.timezone)})`,
        ]),
      },
      {
        heading: "Fee",
        rows: rows([
          ...feeRows,
          ["Booking fee", fees ? money(fees) : ""],
          ["VAT", vat ? money(vat) : ""],
          ["Total payable", money(total)],
          ["Deposit", deposit ? `${money(deposit)}${depositDue ? `, due by ${formatDate(depositDue, "UTC")}` : ""}` : ""],
          ["Balance", deposit ? money(total - deposit) : ""],
        ]),
      },
      {
        heading: "Hospitality and production",
        rows: [["Hospitality", names.length === 1 ? "As per the Act's rider." : "As per each Act's rider."]],
      },
      ...terms(s),
    ],
  };
}

function listOf(names: string[]) {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** JSON with object keys in a fixed order, so the same contract always gives the same hash. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** SHA-256 of the contract's content, as hex. */
export function contractHash(doc: ContractDoc): string {
  return createHash("sha256").update(canonicalJson(doc)).digest("hex");
}

/**
 * What has changed in a contract since it was signed: the labels of the details that differ,
 * e.g. ["Date", "Fee"]. The agency's own header and standard terms are left out, so editing
 * those in Settings doesn't flag every signed contract.
 */
export function contractChanges(signed: ContractDoc, current: ContractDoc): string[] {
  const out: string[] = [];
  const add = (label: string) => {
    if (!out.includes(label)) out.push(label);
  };
  if (signed.client !== current.client) add("Client");
  if (signed.acts !== current.acts) add(current.plural || signed.plural ? "Acts" : "Act");
  const keyed = (doc: ContractDoc) => doc.sections.filter((s) => s.key !== false);
  const before = new Map(keyed(signed).map((s) => [s.heading, s]));
  const after = new Map(keyed(current).map((s) => [s.heading, s]));
  for (const heading of new Set([...before.keys(), ...after.keys()])) {
    const a = before.get(heading);
    const b = after.get(heading);
    if (!a || !b) {
      add(heading);
      continue;
    }
    if ((a.text ?? "") !== (b.text ?? "")) add(heading);
    // Rows are compared by position within their label, so two acts with the same name still line up.
    const count = (rs: ContractRow[]) => {
      const seen = new Map<string, string[]>();
      for (const [k, v] of rs) seen.set(k, [...(seen.get(k) ?? []), v]);
      return seen;
    };
    const ra = count(a.rows);
    const rb = count(b.rows);
    // An act's name labels a row in more than one section (times and fee), so say which.
    const shared = (label: string) => current.sections.filter((s) => s.rows.some(([k]) => k === label)).length > 1;
    for (const label of new Set([...ra.keys(), ...rb.keys()])) {
      const va = ra.get(label) ?? [];
      const vb = rb.get(label) ?? [];
      if (va.length !== vb.length || va.some((v, i) => v !== vb[i])) add(shared(label) ? `${label} (${heading.toLowerCase()})` : label);
    }
  }
  return out;
}

/** Read a stored snapshot back, or null if it isn't one. */
export function asContractDoc(json: unknown): ContractDoc | null {
  const d = json as ContractDoc | null;
  return d && typeof d === "object" && d.version === 1 && Array.isArray(d.sections) ? d : null;
}

// Status, as shown to the agency.

export type ContractLike = { status: string; sentAt: Date; viewedAt: Date | null; signedAt: Date | null; signedName: string; cancelledAt?: Date | null };
export type ContractState = "NONE" | "SENT" | "VIEWED" | "SIGNED";

/** The contract that counts: the most recent one sent that hasn't been cancelled. */
export function currentContract<T extends ContractLike>(list: T[]): T | null {
  return [...list].filter((c) => c.status !== "CANCELLED").sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime())[0] ?? null;
}

export function contractState(c: ContractLike | null): ContractState {
  if (!c || c.status === "CANCELLED") return "NONE";
  if (c.status === "SIGNED") return "SIGNED";
  return c.viewedAt ? "VIEWED" : "SENT";
}

/** "Not sent", "Sent 3 Nov", "Viewed 4 Nov" or "Signed by Jo Bloggs, 5 Nov". */
export function contractStatusLabel(c: ContractLike | null, timeZone: string): string {
  const day = (d: Date) => formatDate(d, timeZone);
  switch (contractState(c)) {
    case "NONE":
      return "Not sent";
    case "SENT":
      return `Sent ${day(c!.sentAt)}`;
    case "VIEWED":
      return `Viewed ${day(c!.viewedAt!)}`;
    case "SIGNED":
      return `Signed by ${c!.signedName}, ${day(c!.signedAt!)}`;
  }
}

// Checking what the signer sends.

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
export const MAX_SIGNATURE_BYTES = 300_000;

/** A drawn signature as a PNG data URL, checked. Returns null if it isn't a sensible PNG. */
export function checkSignature(dataUrl: string): string | null {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!m) return null;
  const bytes = Buffer.from(m[1], "base64");
  if (bytes.length < 100 || bytes.length > MAX_SIGNATURE_BYTES) return null;
  if (!PNG_MAGIC.every((b, i) => bytes[i] === b)) return null;
  return dataUrl;
}

/** A typed full name: at least two letters, trimmed, at most 120 characters. */
export function checkSignerName(raw: string): string | null {
  const name = raw.replace(/\s+/g, " ").trim();
  if (name.length > 120 || (name.match(/\p{L}/gu)?.length ?? 0) < 2) return null;
  return name;
}

/** The visitor's address from proxy headers (the first entry is the client). */
export function clientIp(get: (name: string) => string | null): string {
  const fwd = get("x-forwarded-for")?.split(",")[0]?.trim();
  return (fwd || get("x-real-ip")?.trim() || "").slice(0, 100);
}

/** The agency's own signature for the foot of a contract, from its settings. */
export function agencySignatureOf(settings: { signatureImage: string; signatureName: string; signatureRole: string } | null | undefined) {
  return settings ? { image: settings.signatureImage, name: settings.signatureName, role: settings.signatureRole } : null;
}

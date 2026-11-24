// Who a booking's client-facing messages go to: the client's lead contact, not the owners.
//
// Suave Agency, after Overture: "there's a lead person on the booking, because the owners of the bars don't want
// notifications about all the nitty gritty. That gets sorted by the people who deal with the bookings."
//
// In order, the first that applies:
//  1. The booking's own lead contact (Booking.clientContactId), whoever the booking is for.
//  2. For a venue gig: the venue's lead contact (Venue.leadContactId), then the paying company's (Contact.leadContactId).
//  3. The payer's own email and phone (Booking.promoter), as before. A wedding couple or private customer (a booking in a
//     wedding or event, of a customer's event type, or paid by a private customer) always lands here unless step 1 names
//     someone, so they keep hearing exactly as they did.
//  A company that has turned off "Send day-to-day emails to this company's own email" (Contact.notifyOwner) is never
//  sent day-to-day messages (arrival notes, confirmations) at its own email: with no lead contact they aren't sent at
//  all. Business documents (invoices, statements, PO requests, contracts, payment links) still go to the company's
//  email, with a hint for staff, because someone has to get them and the company's email is where accounts expect them.
//
// No database or server code here, so the booking form can show who it will be as the venue and payer are picked.

import { personName } from "./person-name";
import { CUSTOMER_EVENT_TYPES } from "./team-alert-routing";

export type LeadPerson = { id: string; firstName: string; surname: string; alias?: string | null; email: string; phone: string };

export type ClientPayer = {
  name: string;
  company?: string;
  email: string;
  phone: string;
  type: string;
  notifyOwner?: boolean;
  leadContact?: LeadPerson | null;
};

/** What the resolver needs to know about a booking (or a monthly bill made of bookings). */
export type ClientParty = {
  eventId?: string | null;
  eventType?: string | null;
  clientContact?: LeadPerson | null;
  venue?: { name: string; leadContact?: LeadPerson | null } | null;
  promoter?: ClientPayer | null;
};

/**
 * DAY_TO_DAY: arrival notes and "confirmed" emails, which a company can ask not to get at its own email.
 * DOCUMENT: invoices, statements, PO requests, contracts and payment links, which always reach someone with an email.
 */
export type ClientPurpose = "DAY_TO_DAY" | "DOCUMENT";

/** BOOKING, VENUE, COMPANY: a lead contact. CUSTOMER: the wedding couple or private customer. PAYER: the company's own email. */
export type ClientSource = "BOOKING" | "VENUE" | "COMPANY" | "CUSTOMER" | "PAYER" | "NONE";

export type ClientRecipient = {
  source: ClientSource;
  /** The lead contact's Person id, when it's one. */
  personId: string | null;
  name: string;
  firstName: string;
  email: string;
  phone: string;
  /** Plain words for staff: who it is and why, e.g. "Jo Bloggs, The Swan's lead contact". */
  label: string;
  /** Something staff should know, e.g. nothing will be sent, or it's going to the company's own email. Empty when all's well. */
  hint: string;
};

/** A wedding couple's or private customer's booking: their messages stay theirs unless the booking names someone else. */
export function isCustomerBooking(b: Pick<ClientParty, "eventId" | "eventType" | "promoter">) {
  return !!b.eventId || CUSTOMER_EVENT_TYPES.includes(b.eventType ?? "") || b.promoter?.type === "CLIENT";
}

const first = (name: string) => name.trim().split(/\s+/)[0] ?? "";
const clean = (s: string | null | undefined) => (s ?? "").trim();
const payerName = (p: ClientPayer) => clean(p.company) || clean(p.name);

function fromPerson(p: LeadPerson, source: "BOOKING" | "VENUE" | "COMPANY", whose: string): ClientRecipient {
  const name = personName(p);
  const email = clean(p.email);
  const phone = clean(p.phone);
  return {
    source,
    personId: p.id,
    name,
    firstName: clean(p.firstName) || first(name),
    email,
    phone,
    label: source === "BOOKING" ? `${name}, chosen for this booking` : `${name}, ${whose}'s lead contact`,
    hint: email || phone ? "" : `${name} has no email or phone number yet, so nothing can be sent to them. Add them on their page.`,
  };
}

const NOBODY: ClientRecipient = { source: "NONE", personId: null, name: "", firstName: "", email: "", phone: "", label: "Nobody yet", hint: "" };

/**
 * Who a booking's client-facing message goes to (see the top of this file). `email` and `phone` are what to use; either
 * can be empty, and both are empty when nothing should be sent.
 */
export function clientRecipient(b: ClientParty, purpose: ClientPurpose = "DAY_TO_DAY"): ClientRecipient {
  const customer = isCustomerBooking(b);
  const venueName = clean(b.venue?.name) || "The venue";
  const payer = b.promoter ?? null;
  type Lead = [LeadPerson | null | undefined, "BOOKING" | "VENUE" | "COMPANY", string];
  const leads: Lead[] = [[b.clientContact, "BOOKING", ""]];
  if (!customer) {
    leads.push([b.venue?.leadContact, "VENUE", venueName], [payer?.leadContact, "COMPANY", payer ? payerName(payer) : ""]);
  }
  // Day to day, the first lead contact set is who hears (by text only, or not at all, if that's all they have): the
  // owners asked not to be bothered. A document needs an email, so it goes to the first lead contact who has one.
  for (const [p, source, whose] of leads) {
    if (!p) continue;
    if (purpose === "DOCUMENT" && !clean(p.email)) continue;
    return fromPerson(p, source, whose);
  }
  if (!payer) return NOBODY;

  const name = clean(payer.name);
  const own = {
    personId: null,
    name,
    firstName: first(name),
    email: clean(payer.email),
    phone: clean(payer.phone),
  };
  if (customer) return { ...own, source: "CUSTOMER", label: `${name}, the customer`, hint: "" };
  const company = payerName(payer);
  const leadWithoutEmail = leads.some(([p]) => p && !clean(p.email));
  if (payer.notifyOwner === false) {
    if (purpose === "DAY_TO_DAY") {
      return {
        ...NOBODY,
        label: "Nobody",
        hint: `${company} has asked not to get day-to-day emails at its own email, and there's no lead contact, so nothing is sent. Choose a lead contact to keep them posted.`,
      };
    }
    return {
      ...own,
      source: "PAYER",
      label: `${company}'s own email`,
      hint: own.email
        ? `Goes to ${company}'s own email: invoices and PO requests still go to the company when there's no lead contact${leadWithoutEmail ? " with an email" : ""}.`
        : "",
    };
  }
  return {
    ...own,
    source: "PAYER",
    label: `${company}, who pays`,
    hint: purpose === "DOCUMENT" && leadWithoutEmail ? `The lead contact has no email, so this goes to ${company}'s own email.` : "",
  };
}

/** The booking form's "Someone new" choice for the client's lead contact: the person is added when the booking is saved. */
export const NEW_CONTACT = "new";

/** The Prisma include that gives a booking everything clientRecipient needs. */
export const leadPersonSelect = { id: true, firstName: true, surname: true, alias: true, email: true, phone: true } as const;
export const clientPartyInclude = {
  clientContact: { select: leadPersonSelect },
  venue: { include: { leadContact: { select: leadPersonSelect } } },
  promoter: { include: { leadContact: { select: leadPersonSelect } } },
} as const;

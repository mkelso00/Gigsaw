// Who an act's money goes to, kept pure (no database) so it's unit tested in tests/payee.test.ts. The
// database side is in ./payee-server.ts.
//
// Pay details (bank, address, VAT, NI number) belong to people, not acts: a band can have four people
// in it, and each fills in their own from their own login. A band's self-billing invoices are made out
// to one of them, its lead ("Invoices go to"), chosen by staff. So the payee of an act's invoice is:
//
//  1. the act's lead person, or the only person when the act has just one (no choosing needed);
//  2. otherwise the act itself, from the act's own details, when it has nobody on file (a solo act that
//     signs in with the act's own login), or while details from before people had their own are still
//     on the act and haven't been moved to a person (so nobody's pay stops while staff sort it out);
//  3. otherwise nobody yet: staff need to choose who the band's invoices go to.
//
// The act's people are its members plus the people in the acts it's built from (Wonderlust's are
// Graham and Jo, from Graham McKee Solo and Jo Drummond Solo).

import type { PayDetails } from "./act-details";

export type PayHolderFields = PayDetails & { vatRegistered: boolean; vatNumber: string; phone: string; detailsCompletedAt: Date | null };

export type PayPerson = PayHolderFields & { id: string; firstName: string; surname: string; alias: string; email: string };

export type PayAct = PayHolderFields & {
  id: string;
  name: string;
  email: string;
  leadPersonId: string | null;
  /** The act's own members. */
  members: PayPerson[];
  /** The people in the acts it's built from (not its own members). */
  partPeople: PayPerson[];
};

export type Payee = { kind: "person"; person: PayPerson } | { kind: "act" };

/** The name on an invoice: a person's real name (not their stage name), as their bank account would have it. */
export function legalName(p: { firstName: string; surname: string }) {
  return `${p.firstName} ${p.surname}`.trim();
}

/** True when there's a bank account on file (filled in, or part way). */
export function hasBank(d: { bankAccountName: string; bankSortCode: string; bankAccountNumber: string }) {
  return !!(d.bankAccountName.trim() || d.bankSortCode.trim() || d.bankAccountNumber.trim());
}

/** True when any pay detail is on file at all. */
export function hasAnyPayDetails(d: PayDetails & { vatNumber: string; detailsCompletedAt: Date | null }) {
  return hasBank(d) || !!(d.address.trim() || d.niNumber.trim() || d.vatNumber.trim() || d.detailsCompletedAt);
}

/** Everyone in the act, its own members first, each once. */
export function peopleOf(act: Pick<PayAct, "members" | "partPeople">) {
  const seen = new Set<string>();
  return [...act.members, ...act.partPeople].filter((p) => !seen.has(p.id) && !!seen.add(p.id));
}

/** The person the act's invoices go to: the chosen lead (only while they're still in the act), else the only person. */
export function leadOf(act: Pick<PayAct, "members" | "partPeople" | "leadPersonId">): PayPerson | null {
  const people = peopleOf(act);
  return people.find((p) => p.id === act.leadPersonId) ?? (people.length === 1 ? people[0] : null);
}

/** True for a band of two or more people with nobody chosen to get its invoices: "Choose who the band's invoices go to". */
export function needsLead(act: Pick<PayAct, "members" | "partPeople" | "leadPersonId">) {
  return peopleOf(act).length > 1 && !leadOf(act);
}

/** Who the act's invoices are made out to and paid to (see the top of this file). Null: staff must choose. */
export function payeeOf(act: PayAct): Payee | null {
  const lead = leadOf(act);
  const actHas = hasBank(act);
  // The act's own details from before win only until the lead has some of their own.
  if (lead && (hasBank(lead) || !actHas)) return { kind: "person", person: lead };
  if (actHas || peopleOf(act).length === 0) return { kind: "act" };
  return null;
}

/** The payee's name and details, for an invoice (see act-invoice-rules.ts). */
export function payeeDetails(act: PayAct, payee: Payee) {
  const from = payee.kind === "person" ? payee.person : act;
  return {
    personId: payee.kind === "person" ? payee.person.id : null,
    name: payee.kind === "person" ? legalName(payee.person) : act.name,
    address: from.address,
    vatRegistered: from.vatRegistered,
    vatNumber: from.vatNumber,
    bankAccountName: from.bankAccountName,
    bankSortCode: from.bankSortCode,
    bankAccountNumber: from.bankAccountNumber,
    detailsCompletedAt: from.detailsCompletedAt,
  };
}

/**
 * Whose details an act's own login fills in (User.artistId): the act's only member when it has exactly one
 * (the details are that person's), nobody when a band's lead gives their own, otherwise the act's own.
 */
export function actLoginFillsIn(act: PayAct): { kind: "person"; person: PayPerson } | { kind: "act" } | null {
  const people = peopleOf(act);
  if (act.members.length === 1 && people.length === 1) return { kind: "person", person: act.members[0] };
  if (leadOf(act)) return null;
  return { kind: "act" };
}

// ---- Moving details from before onto people (the 20261214000000_person_pay_details migration) ----
//
// The migration's SQL follows these rules exactly; tests/person-pay-details-db.test.ts runs the SQL and
// checks it against movePlan. An act's details move to a person only when it's clear whose they are:
// the act's only member, or else the one member whose email is the act's email. Never when that person's
// address is a different one, or when two acts' details would land on the same person. Otherwise they stay
// on the act (still paid from them, see payeeOf) and the act's page asks staff to sort them out.

export type MoveCandidate = { id: string; email: string; address: string; hasDetails: boolean; members: { id: string; email: string; address: string }[] };

const sameEmail = (a: string, b: string) => !!a.trim() && a.trim().toLowerCase() === b.trim().toLowerCase();
/** Addresses compared the way people type them: case, spacing and line breaks don't matter. */
export const sameAddress = (a: string, b: string) =>
  a
    .toLowerCase()
    .replace(/[\s,]+/g, " ")
    .trim() ===
  b
    .toLowerCase()
    .replace(/[\s,]+/g, " ")
    .trim();

/** The person this act's details belong to, or null when it isn't clear. */
export function moveTarget(act: MoveCandidate): { personId: string; byEmail: boolean } | null {
  if (!act.hasDetails) return null;
  const byEmail = act.members.length !== 1;
  const matches = byEmail ? act.members.filter((m) => sameEmail(m.email, act.email)) : act.members;
  if (matches.length !== 1) return null;
  const p = matches[0];
  if (act.address.trim() && p.address.trim() && !sameAddress(act.address, p.address)) return null;
  return { personId: p.id, byEmail };
}

/**
 * Which acts' details move to which person: act id to { personId, setLead }. `setLead` is for a band whose
 * details were the matching member's: they become its lead, so its invoices carry on going to them.
 */
export function movePlan(acts: MoveCandidate[]) {
  const targets = acts.flatMap((a) => {
    const t = moveTarget(a);
    return t ? [{ actId: a.id, ...t }] : [];
  });
  const count = new Map<string, number>();
  for (const t of targets) count.set(t.personId, (count.get(t.personId) ?? 0) + 1);
  return new Map(targets.filter((t) => count.get(t.personId) === 1).map((t) => [t.actId, { personId: t.personId, setLead: t.byEmail }]));
}

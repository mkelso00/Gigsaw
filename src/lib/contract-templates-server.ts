import "server-only";
import { pickContract, sortTemplates, type ContractPick } from "./contract-templates";
import { prisma } from "./db";

// Contract types, server side: loading a business's types, checking a type picked on a form is its
// own, and adding, changing and deleting them (Settings, Contracts and invoices). Which type a
// proposal, booking or event uses is decided by the pure resolver in contract-templates.ts.

export const MAX_CONTRACT_TYPES = 30;

/** A business's contract types, in the order they're listed. */
export async function contractTemplatesFor(agencyId: string) {
  return sortTemplates(await prisma.contractTemplate.findMany({ where: { agencyId }, orderBy: [{ sort: "asc" }, { createdAt: "asc" }] }));
}

export type ContractTemplateRow = Awaited<ReturnType<typeof contractTemplatesFor>>[number];

/** The contract to use for a business's proposal, booking or event (see pickContract). */
export async function contractFor(agencyId: string, by: ContractPick) {
  return pickContract(await contractTemplatesFor(agencyId), by);
}

/** A contract type id from a form, if it's one of this business's; null for "none" or anything else. */
export async function ownContractTemplateId(agencyId: string, raw: string | null | undefined): Promise<string | null> {
  const id = (raw ?? "").trim();
  if (!id) return null;
  const t = await prisma.contractTemplate.findFirst({ where: { id, agencyId }, select: { id: true } });
  return t?.id ?? null;
}

/**
 * Add a contract type at the end of the list. The first one a business adds is its default, so there's
 * always exactly one default while it has any.
 */
export async function addContractTemplate(agencyId: string, data: { name?: string; terms?: string; eventTypes?: string[]; isDefault?: boolean } = {}) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.contractTemplate.findMany({ where: { agencyId }, select: { sort: true, isDefault: true } });
    if (existing.length >= MAX_CONTRACT_TYPES) throw new ContractTemplateError(`You can keep up to ${MAX_CONTRACT_TYPES} contract types.`);
    const isDefault = data.isDefault || !existing.some((t) => t.isDefault);
    if (isDefault) await tx.contractTemplate.updateMany({ where: { agencyId, isDefault: true }, data: { isDefault: false } });
    return tx.contractTemplate.create({
      data: {
        agencyId,
        name: data.name?.trim() || (existing.length ? "New contract type" : "Standard contract"),
        terms: data.terms ?? "",
        eventTypes: data.eventTypes ?? [],
        isDefault,
        sort: existing.reduce((m, t) => Math.max(m, t.sort + 1), 0),
      },
    });
  });
}

export class ContractTemplateError extends Error {}

/**
 * Save a contract type's name, wording and event types. Ticking "Default for everything else" makes it
 * the default (and the old one not); the default can't be unticked, only moved to another type.
 */
export async function updateContractTemplate(agencyId: string, id: string, data: { name: string; terms: string; eventTypes: string[]; makeDefault: boolean }) {
  const name = data.name.trim().slice(0, 80);
  if (!name) throw new ContractTemplateError("Give the contract a name, like Wedding contract");
  return prisma.$transaction(async (tx) => {
    const t = await tx.contractTemplate.findFirst({ where: { id, agencyId } });
    if (!t) throw new ContractTemplateError("That contract type has been deleted. Reload the page.");
    if (data.makeDefault && !t.isDefault) await tx.contractTemplate.updateMany({ where: { agencyId, isDefault: true }, data: { isDefault: false } });
    return tx.contractTemplate.update({
      where: { id },
      data: { name, terms: data.terms.slice(0, 20000), eventTypes: data.eventTypes, isDefault: t.isDefault || data.makeDefault },
    });
  });
}

/** What still names a contract type: draft and sent proposals, bookings, weddings and events, and clients. */
export async function contractTemplateUsage(agencyId: string, id: string) {
  const [drafts, sent, bookings, events, clients] = await Promise.all([
    prisma.quote.count({ where: { agencyId, contractTemplateId: id, status: "DRAFT", supersededById: null } }),
    prisma.quote.count({ where: { agencyId, contractTemplateId: id, status: { not: "DRAFT" } } }),
    prisma.booking.count({ where: { agencyId, contractTemplateId: id, archivedAt: undefined } }),
    prisma.event.count({ where: { agencyId, contractTemplateId: id } }),
    prisma.contact.findMany({ where: { agencyId, contractTemplateId: id }, select: { name: true, company: true }, orderBy: { name: "asc" }, take: 50 }),
  ]);
  return {
    drafts,
    sent,
    bookings,
    events,
    clients: clients.map((c) => (c.company && c.company !== "Private client" ? c.company : c.name)),
  };
}

/**
 * Delete a contract type. Whatever named it falls back to the next rule (the client's, the event type's,
 * the default); proposals already sent and contracts already signed keep their own copy of the wording.
 * Deleting the default makes the first type left the default.
 */
export async function deleteContractTemplate(agencyId: string, id: string) {
  return prisma.$transaction(async (tx) => {
    const t = await tx.contractTemplate.findFirst({ where: { id, agencyId } });
    if (!t) return null;
    await tx.contractTemplate.delete({ where: { id: t.id } });
    if (t.isDefault) {
      const next = await tx.contractTemplate.findFirst({ where: { agencyId }, orderBy: [{ sort: "asc" }, { createdAt: "asc" }] });
      if (next) await tx.contractTemplate.update({ where: { id: next.id }, data: { isDefault: true } });
    }
    return t;
  });
}

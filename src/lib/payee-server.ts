import "server-only";
import { prisma } from "./db";
import { actTree } from "./people";
import { actLoginFillsIn, payeeDetails, payeeOf, type PayAct, type PayPerson } from "./payee";
import { personName } from "./person-name";

// Loading acts with their people's pay details, to work out who their invoices go to and whose details a
// login fills in. The rules themselves are in ./payee.ts.

export const PERSON_PAY_SELECT = {
  id: true,
  firstName: true,
  surname: true,
  alias: true,
  email: true,
  phone: true,
  address: true,
  bankAccountName: true,
  bankSortCode: true,
  bankAccountNumber: true,
  vatRegistered: true,
  vatNumber: true,
  niNumber: true,
  detailsCompletedAt: true,
  selfBillingAgreedAt: true,
  selfBillingAgreedText: true,
} as const;

export const ACT_PAY_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  address: true,
  bankAccountName: true,
  bankSortCode: true,
  bankAccountNumber: true,
  vatRegistered: true,
  vatNumber: true,
  niNumber: true,
  detailsCompletedAt: true,
  selfBillingAgreedAt: true,
  selfBillingAgreedText: true,
  leadPersonId: true,
} as const;

/** prisma, or the client inside a transaction (only reads are made here). Everything goes through it: a read on
 * prisma itself in the middle of a transaction needs a second connection, and with a few at once the pool runs out. */
type Db = Pick<typeof prisma, "artist" | "actLink">;

/** These acts (in one agency) with everyone's pay details, by id. Acts in another agency are left out. */
export async function loadPayActs(agencyId: string, actIds: string[], db: Db = prisma): Promise<Map<string, PayAct>> {
  const ids = [...new Set(actIds)];
  const out = new Map<string, PayAct>();
  if (!ids.length) return out;
  const tree = await actTree(agencyId, db);
  const parts = new Map(ids.map((id) => [id, [...tree.withParts([id])].filter((x) => x !== id)]));
  const all = [...new Set([...ids, ...[...parts.values()].flat()])];
  const rows = await db.artist.findMany({
    where: { id: { in: all }, agencyId },
    select: { ...ACT_PAY_SELECT, members: { select: { person: { select: PERSON_PAY_SELECT } }, orderBy: { person: { firstName: "asc" } } } },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const members = (id: string): PayPerson[] => byId.get(id)?.members.map((m) => m.person) ?? [];
  for (const id of ids) {
    const a = byId.get(id);
    if (!a) continue;
    const { members: _m, ...act } = a;
    out.set(id, { ...act, members: members(id), partPeople: (parts.get(id) ?? []).flatMap(members) });
  }
  return out;
}

/** Who this act's invoices go to, with their details, or null while staff haven't chosen (see payeeOf). */
export function payeeFor(act: PayAct) {
  const payee = payeeOf(act);
  return payee ? payeeDetails(act, payee) : null;
}

export type PayHolder = (PayPerson & { kind: "person"; name: string }) | (Omit<PayAct, "members" | "partPeople" | "leadPersonId"> & { kind: "act" });

/**
 * Whose pay details this login fills in. A person's login: their own (when they're in an act). An act's own
 * login: its only person's when it has exactly one, nobody's when a band's lead gives their own, otherwise
 * the act's own (see actLoginFillsIn).
 */
export async function payHoldersFor(user: { artistId: string | null; personId: string | null; agencyId: string }): Promise<PayHolder[]> {
  if (user.personId) {
    const p = await prisma.person.findFirst({ where: { id: user.personId, agencyId: user.agencyId, acts: { some: {} } }, select: PERSON_PAY_SELECT });
    return p ? [{ ...p, kind: "person", name: personName(p) }] : [];
  }
  if (!user.artistId) return [];
  const act = (await loadPayActs(user.agencyId, [user.artistId])).get(user.artistId);
  if (!act) return [];
  const fills = actLoginFillsIn(act);
  if (!fills) return [];
  if (fills.kind === "person") return [{ ...fills.person, kind: "person", name: personName(fills.person) }];
  const { members: _m, partPeople: _p, leadPersonId: _l, ...own } = act;
  return [{ ...own, kind: "act" }];
}

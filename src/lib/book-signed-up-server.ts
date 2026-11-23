import "server-only";
import { prisma, getSettings, logActivities } from "./db";
import { FormError, type FormState } from "./forms";
import { actTree } from "./people";
import { personName } from "./person-name";
import { bookAnywayTitle, bookingRefusal, canBookAct, pickerNote, type BookCheck, type BookableAct, type SignupPerson } from "./book-signed-up";

// The database side of "Only book acts who've signed up to Gigsaw" (the rules are in ./book-signed-up.ts).
//
// Every way an act is put on a booking asks signupGate first: creating or editing a booking (when the act
// changes), quick booking and the venue schedule, copying a booking with its act, adding an act to a wedding or
// event, booking someone who said they're free, and sending a proposal that names acts. Bookings already made are
// left alone, and a booking with no act yet (Pending) is always fine.

/** Who's booking: admins may book an act that hasn't signed up (after a "Book anyway"), anyone else is refused. */
export type GateUser = { id: string; agencyId: string; role: string };

export type BlockedAct = { id: string; name: string; why: string; who: string };

/** prisma, or a transaction's client (reads only). */
type Db = Pick<typeof prisma, "artist" | "actLink">;

type LoginWithEmail = { passwordHash: string; email: string } | null;
/** An act as canBookAct reads it, with the emails its sign-up link can go to. */
export type LoadedAct = Omit<BookableAct, "login" | "people"> & {
  id: string;
  email: string;
  login: LoginWithEmail;
  people: (Omit<SignupPerson, "login"> & { email: string; login: LoginWithEmail })[];
};

/** These acts (or every act in the business, with null) with their logins and people, for canBookAct. */
export async function loadBookableActs(agencyId: string, actIds: string[] | null, db: Db = prisma): Promise<Map<string, LoadedAct>> {
  const out = new Map<string, LoadedAct>();
  const ids = actIds ? [...new Set(actIds)] : null;
  if (ids && !ids.length) return out;
  const tree = await actTree(agencyId, db);
  const login = { select: { passwordHash: true, email: true } };
  const select = {
    id: true,
    name: true,
    email: true,
    leadPersonId: true,
    bookBeforeSignupAt: true,
    login,
    members: {
      select: { person: { select: { id: true, firstName: true, surname: true, alias: true, email: true, login } } },
      orderBy: { person: { firstName: "asc" as const } },
    },
  };
  const wanted = ids ?? (await db.artist.findMany({ where: { agencyId }, select: { id: true } })).map((a) => a.id);
  const parts = new Map(wanted.map((id) => [id, [...tree.withParts([id])].filter((x) => x !== id)]));
  const all = [...new Set([...wanted, ...[...parts.values()].flat()])];
  const rows = await db.artist.findMany({ where: { id: { in: all }, agencyId }, select });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const peopleOf = (id: string): LoadedAct["people"] =>
    byId.get(id)?.members.map((m) => ({ id: m.person.id, name: personName(m.person), email: m.person.email, login: m.person.login })) ?? [];
  for (const id of wanted) {
    const a = byId.get(id);
    if (!a) continue;
    const seen = new Set<string>();
    const people = [...peopleOf(id), ...(parts.get(id) ?? []).flatMap(peopleOf)].filter((p) => !seen.has(p.id) && !!seen.add(p.id));
    out.set(id, { id, name: a.name, email: a.email, login: a.login, leadPersonId: a.leadPersonId, bookBeforeSignupAt: a.bookBeforeSignupAt, people });
  }
  return out;
}

/**
 * Where an act's sign-up link goes ("Send sign-up link" on its page): for a band, the person its invoices go to;
 * otherwise the act's login made earlier without a password, else its own email, else its one person's. The link
 * is the same one "First time? Set up your login" sends (src/lib/act-claim.ts).
 */
export function signupLinkTo(act: LoadedAct): { email: string; name: string } | { error: string } {
  const people = act.people;
  if (people.length >= 2) {
    const lead = people.find((p) => p.id === act.leadPersonId);
    if (!lead) {
      if (act.login?.email) return { email: act.login.email, name: act.name };
      return { error: `Choose who ${act.name}'s invoices go to first (Pay details, on this page). Their sign-up link goes to them.` };
    }
    const email = lead.login?.email || lead.email;
    return email.trim() ? { email, name: lead.name } : { error: `Add ${lead.name}'s email first (People, on this page), then send their sign-up link.` };
  }
  const one = people[0];
  const options = [
    { email: act.login?.email ?? "", name: act.name },
    { email: one?.login?.email ?? "", name: one?.name ?? "" },
    { email: act.email, name: act.name },
    { email: one?.email ?? "", name: one?.name ?? "" },
  ];
  return options.find((o) => o.email.trim()) ?? { error: `Add ${act.name}'s email first (Edit), then send their sign-up link.` };
}

/** Whether the business only books acts who've signed up (Settings, General). */
export async function bookOnlySignedUp(agencyId: string) {
  return (await getSettings(agencyId)).bookOnlySignedUp;
}

/** Of these acts, the ones that can't be booked yet. None while the business's switch is off. */
export async function blockedActs(agencyId: string, actIds: (string | null | undefined)[]): Promise<BlockedAct[]> {
  const ids = [...new Set(actIds.filter((id): id is string => !!id))];
  if (!ids.length || !(await bookOnlySignedUp(agencyId))) return [];
  const acts = await loadBookableActs(agencyId, ids);
  return [...acts.values()].flatMap((a) => {
    const c = canBookAct(a);
    return c.ok ? [] : [{ id: a.id, name: a.name, why: c.why, who: c.who }];
  });
}

/** An admin's "Book anyway" box for these acts. */
export function bookAnywayBox(blocked: BlockedAct[]): NonNullable<FormState> {
  const names = blocked.map((b) => b.name);
  return {
    confirm: {
      title: bookAnywayTitle(names),
      items: [
        ...blocked.map((b) => (blocked.length > 1 ? `${b.name}: ${b.why}` : b.why)),
        `To stop this question, approve them to be booked before signing up, on their page (${names.map((n) => `Acts → ${n}`).join(", ")}).`,
      ],
      button: "Book anyway",
    },
  };
}

/**
 * Before acts are put on bookings: nothing to say (all signed up, approved, the switch is off, or no act), a
 * "Book anyway" box for an admin (`hold`), or, for anyone else, a FormError with the reason. `anyway` is the
 * admin having pressed "Book anyway" (confirmed(form)); the acts booked that way come back in `overridden`.
 */
export async function signupGate(
  user: GateUser,
  actIds: (string | null | undefined)[],
  anyway: boolean,
): Promise<{ hold: NonNullable<FormState> | null; overridden: BlockedAct[] }> {
  const blocked = await blockedActs(user.agencyId, actIds);
  if (!blocked.length) return { hold: null, overridden: [] };
  if (user.role !== "ADMIN") throw new FormError(blocked.map((b) => bookingRefusal(b.name)).join(" "));
  if (anyway) return { hold: null, overridden: blocked };
  return { hold: bookAnywayBox(blocked), overridden: [] };
}

/** Note on each booking that an admin booked an act before it signed up. */
export async function logBookedAnyway(user: GateUser, bookingIds: string[], overridden: BlockedAct[]) {
  if (!overridden.length || !bookingIds.length) return;
  const detail = overridden.map((b) => b.name).join(", ");
  await logActivities(
    user,
    "BOOKING",
    bookingIds.map((id) => ({ entityId: id, action: "booked before the act signed up to Gigsaw", detail })),
  );
}

/**
 * One "are you sure?" box from two: the sign-up one first, then the double booking one. A single "Book anyway"
 * answers both, as both read confirmed(form).
 */
export function mergeHolds(first: FormState | null, second: FormState | null): FormState | null {
  if (!first?.confirm) return second;
  if (!second?.confirm) return first;
  return { confirm: { ...first.confirm, items: [...first.confirm.items, ...second.confirm.items] } };
}

/** Each act's check, by id, for every act in the business, or an empty map while the switch is off. */
export async function bookChecks(agencyId: string): Promise<Map<string, BookCheck>> {
  if (!(await bookOnlySignedUp(agencyId))) return new Map();
  const acts = await loadBookableActs(agencyId, null);
  return new Map([...acts].map(([id, a]) => [id, canBookAct(a)]));
}

/** "Not signed up" or "Approved" beside acts in the pickers, by act id (nothing for acts who've signed up). */
export async function pickerNotes(agencyId: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const [id, c] of await bookChecks(agencyId)) {
    const note = pickerNote(c);
    if (note) out.set(id, note);
  }
  return out;
}

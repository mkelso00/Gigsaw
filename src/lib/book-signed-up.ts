// "Only book acts who've signed up to Gigsaw" (Settings, General: Settings.bookOnlySignedUp). Kept pure (no
// database) so it's unit tested in tests/book-signed-up.test.ts; the database side, and how each way of booking
// an act uses it, is in ./book-signed-up-server.ts.
//
// Signed up means the person the act's money goes to (its payee, src/lib/payee.ts) has made a password:
//  - a solo act: its own login, or the login of the one person in it (act-signup.ts counts it the same way);
//  - a band (two or more people, its own or from the acts it's built from): its lead, the person its invoices go
//    to. The other members can follow ("2 of 4 signed up" on the act's page), they don't stop a booking. A band
//    with nobody chosen to get its invoices counts as signed up only if the band's own login is.
//
// An admin can approve an act to be booked before it signs up (Artist.bookBeforeSignupAt, on the act's page), or
// book one anyway, one booking at a time. Anyone else is refused (refusal below).

type Login = { passwordHash: string } | null;

export type SignupPerson = { id: string; name: string; login: Login };

export type BookableAct = {
  name: string;
  /** The act's own login. */
  login: Login;
  leadPersonId: string | null;
  /** When an admin approved it to be booked before signing up. */
  bookBeforeSignupAt: Date | null;
  /** Everyone in the act, its own members first, then the people in the acts it's built from, each once. */
  people: SignupPerson[];
};

export type BookCheck = { ok: true; approved: boolean } | { ok: false; why: string; who: string };

const signedUp = (l: Login) => !!l?.passwordHash;

/**
 * Whether the act can be booked while the business only books acts who've signed up. `approved` is true when
 * it can only because an admin approved it (an approved act that has since signed up is just signed up).
 */
export function canBookAct(act: BookableAct): BookCheck {
  const check = signupCheck(act);
  return !check.ok && act.bookBeforeSignupAt ? { ok: true, approved: true } : check;
}

function signupCheck(act: BookableAct): BookCheck {
  const people = act.people;
  if (people.length >= 2) {
    const lead = people.find((p) => p.id === act.leadPersonId);
    if (lead) {
      if (signedUp(lead.login)) return { ok: true, approved: false };
      return {
        ok: false,
        who: lead.name,
        why: `${lead.name}, who the band's invoices go to, hasn't made their Gigsaw login yet${lead.login ? " (their sign-up link has been sent)" : ""}.`,
      };
    }
    if (signedUp(act.login)) return { ok: true, approved: false };
    return {
      ok: false,
      who: act.name,
      why: "Nobody in the band has been chosen to get its invoices, so nobody has signed up for it. Choose who the invoices go to, then send them their sign-up link.",
    };
  }
  const one = people[0];
  if (signedUp(act.login) || (one && signedUp(one.login))) return { ok: true, approved: false };
  const sent = !!act.login || !!one?.login;
  return {
    ok: false,
    who: one?.name ?? act.name,
    why: sent ? "Their sign-up link has been sent, but they haven't made a password yet." : "They don't have a Gigsaw login yet.",
  };
}

/** What staff who aren't admins see when they try to book an act that hasn't signed up. */
export function bookingRefusal(actName: string) {
  return `${actName} hasn't signed up to Gigsaw yet, so they can't be booked. Send them their sign-up link (Acts → ${actName}), or ask an admin to approve them.`;
}

/** "Ellie Rose", "Ellie Rose and Wonderlust", "A, B and C". */
export function nameList(names: string[]) {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** The title of an admin's "Book anyway" box: "<Act> hasn't signed up to Gigsaw yet". */
export function bookAnywayTitle(actNames: string[]) {
  return `${nameList(actNames)} ${actNames.length === 1 ? "hasn't" : "haven't"} signed up to Gigsaw yet`;
}

/** The note beside an act in the pickers, or none for an act who has signed up (or when the rule is off). */
export function pickerNote(check: BookCheck | undefined): string | undefined {
  if (!check) return undefined;
  if (!check.ok) return "Not signed up";
  return check.approved ? "Approved" : undefined;
}

/** A picker option's detail with the note added, e.g. "Jazz · Not signed up". */
export function withNote(detail: string | undefined | null, note: string | undefined) {
  return [detail, note].filter(Boolean).join(" · ") || undefined;
}

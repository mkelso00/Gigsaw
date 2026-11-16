// Has an act signed up to the act app yet? One answer for the act's page and the Acts list, so staff
// can see who still needs chasing while everyone is being moved onto Gigsaw.
//
// A login made by "First time? Set up your login" has no password until the act opens the emailed
// link and chooses one (src/lib/act-claim.ts), so a login without a password is "Link sent", not signed up.
//
// A band with two or more people on file counts its people, each of whom signs up with their own login
// and adds their own pay details: "2 of 4 signed up". It's signed up once they all are.

type Login = { passwordHash: string } | null;

export type SignupStatus = "SIGNED_UP" | "PARTLY" | "LINK_SENT" | "NOT_YET";

/** One login: signed up (has a password), link sent (made, no password yet), or none. */
export function loginStatus(login: Login): SignupStatus {
  return !login ? "NOT_YET" : login.passwordHash ? "SIGNED_UP" : "LINK_SENT";
}

type SignupAct = { login: Login; members?: { person: { login: Login } }[] };

/** How many of a band's people have signed up, or null for an act with fewer than two people. */
export function bandSignups(a: SignupAct): { done: number; of: number } | null {
  const people = a.members ?? [];
  if (people.length < 2) return null;
  return { done: people.filter((m) => !!m.person.login?.passwordHash).length, of: people.length };
}

/**
 * A solo act: its own login, or, for a one-person act, its member's login (people can sign up with their
 * own email). A band: its people, one by one (see bandSignups).
 */
export function signupStatus(a: SignupAct): SignupStatus {
  const band = bandSignups(a);
  if (band) {
    if (band.done === band.of) return "SIGNED_UP";
    if (band.done > 0) return "PARTLY";
    return a.members!.some((m) => m.person.login) ? "LINK_SENT" : "NOT_YET";
  }
  const logins = [a.login, ...(a.members?.length === 1 ? [a.members[0].person.login] : [])].filter((l): l is { passwordHash: string } => !!l);
  if (logins.some((l) => !!l.passwordHash)) return "SIGNED_UP";
  return logins.length ? "LINK_SENT" : "NOT_YET";
}

export const SIGNUP_LABEL: Record<SignupStatus, string> = {
  SIGNED_UP: "Signed up",
  PARTLY: "Partly signed up",
  LINK_SENT: "Link sent",
  NOT_YET: "Not signed up",
};

/** The badge's words: "Signed up", or for a band "2 of 4 signed up". */
export function signupLabel(a: SignupAct) {
  const band = bandSignups(a);
  return band ? `${band.done} of ${band.of} signed up` : SIGNUP_LABEL[signupStatus(a)];
}

export const SIGNUP_BADGE: Record<SignupStatus, string> = {
  SIGNED_UP: "bg-emerald-50 text-emerald-800",
  PARTLY: "bg-teal-50 text-teal-800",
  LINK_SENT: "bg-sky-50 text-sky-800",
  NOT_YET: "bg-ink-100 text-ink-600",
};

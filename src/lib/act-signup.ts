// Has an act signed up to the act app yet? One answer for the act's page and the Acts list, so staff
// can see who still needs chasing while everyone is being moved onto Gigsaw.
//
// A login made by "First time? Set up your login" has no password until the act opens the emailed
// link and chooses one (src/lib/act-claim.ts), so a login without a password is "Link sent", not signed up.

type Login = { passwordHash: string } | null;

export type SignupStatus = "SIGNED_UP" | "LINK_SENT" | "NOT_YET";

/**
 * The act's own login, or, for a one-person act, its member's login (people can sign up with their
 * own email). In a band, one member signing up isn't the band signing up.
 */
export function signupStatus(a: { login: Login; members?: { person: { login: Login } }[] }): SignupStatus {
  const logins = [a.login, ...(a.members?.length === 1 ? [a.members[0].person.login] : [])].filter((l): l is { passwordHash: string } => !!l);
  if (logins.some((l) => !!l.passwordHash)) return "SIGNED_UP";
  return logins.length ? "LINK_SENT" : "NOT_YET";
}

export const SIGNUP_LABEL: Record<SignupStatus, string> = { SIGNED_UP: "Signed up", LINK_SENT: "Link sent", NOT_YET: "Not signed up" };

export const SIGNUP_BADGE: Record<SignupStatus, string> = {
  SIGNED_UP: "bg-emerald-50 text-emerald-800",
  LINK_SENT: "bg-sky-50 text-sky-800",
  NOT_YET: "bg-ink-100 text-ink-600",
};

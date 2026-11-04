// Limits on password guessing at sign-in (the counting itself lives in actions/auth.ts).
// Failed attempts are counted per email and per IP address over a sliding window. Once a limit
// is reached, sign-in with that email (or from that address) is refused, without checking the
// password, until the oldest counted failure is older than the window.

export const LOGIN_WINDOW_MS = 15 * 60_000;
/** Failed attempts allowed for one email in the window. */
export const MAX_PER_EMAIL = 10;
/** Failed attempts allowed from one IP address in the window, across every email. */
export const MAX_PER_IP = 30;

/**
 * When sign-in opens again, given the times of recent failures, or null if it's open now.
 * Only the most recent `max` failures matter, so callers need fetch no more than that.
 */
export function lockedUntil(failures: Date[], max: number, now = new Date(), windowMs = LOGIN_WINDOW_MS): Date | null {
  const since = now.getTime() - windowMs;
  const recent = failures
    .map((d) => d.getTime())
    .filter((t) => t > since)
    .sort((a, b) => b - a);
  if (recent.length < max) return null;
  // Open again once the max-th most recent failure falls out of the window.
  return new Date(recent[max - 1] + windowMs);
}

/** What to tell someone who has hit the limit. */
export function lockedMessage(until: Date, now = new Date()) {
  const minutes = Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 60_000));
  return `Too many attempts to sign in. Please wait ${minutes} minute${minutes === 1 ? "" : "s"} and try again, or reset your password.`;
}

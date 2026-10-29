// Alerts sent to internal users, which each person can turn off for themselves in their profile.

export const STAFF_ALERTS = [
  { key: "LATE", label: "An act is late", hint: "When a gig's call time passes with no check-in.", channels: ["email", "text"] },
  { key: "DECLINED", label: "An act turns down a gig", hint: "So you can find someone else.", channels: ["email", "text"] },
  { key: "ACCEPTED", label: "An act accepts a gig", hint: "The gig is confirmed straight away.", channels: ["email"] },
  { key: "PLANNER", label: "A customer fills in their planner", hint: "Weddings and events: the running order and details are in.", channels: ["email"] },
] as const;

export type StaffAlert = (typeof STAFF_ALERTS)[number]["key"];
export type Channel = "email" | "text";
type Prefs = Partial<Record<string, Partial<Record<Channel, boolean>>>>;

/** Whether this person wants this alert by this channel. Everything is on unless turned off. */
export function wants(prefs: unknown, key: StaffAlert, channel: Channel): boolean {
  const p = (prefs && typeof prefs === "object" ? prefs : {}) as Prefs;
  return p[key]?.[channel] !== false;
}

/** Read the profile form's switches into a prefs object. */
export function prefsFromForm(form: FormData): Prefs {
  const out: Prefs = {};
  for (const a of STAFF_ALERTS) {
    out[a.key] = {};
    for (const c of a.channels) out[a.key]![c] = form.get(`${a.key}:${c}`) === "on";
  }
  return out;
}

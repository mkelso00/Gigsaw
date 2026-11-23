// Where team alerts go: the lead agent, a shared inbox, both or nobody, chosen for each alert and each kind of work
// (weddings and events, or venue gigs) in Settings, Notifications. Stored in Settings.alertRouting.
//
// This file has no database or server code, so the settings page and the unit tests can use it. The server side,
// which loads the business's settings and its people, is teamRecipients() in src/lib/team-alerts.ts.

import { wants, type StaffAlert } from "./notify-prefs";

export type AlertContext = "EVENTS" | "GIGS";
/** A row's columns: weddings and events, venue gigs, or one cell for alerts that aren't about one booking. */
export type RouteContext = AlertContext | "ALL";
export type Route = "AGENT" | "INBOX" | "BOTH" | "NOBODY";
export const ROUTES: readonly Route[] = ["AGENT", "INBOX", "BOTH", "NOBODY"];

export const CONTEXT_LABELS: Record<AlertContext, string> = { EVENTS: "Weddings and events", GIGS: "Venue gigs" };

/** Who the "people" choice means for an alert. */
type People = "AGENT" | "ENQUIRY" | "ADMINS";
/** Which address the "shared inbox" choice means. */
type Inbox = "CONTEXT" | "BUSINESS" | "ACCOUNTS";

export const TEAM_ALERTS = [
  { key: "ACCEPTED", label: "An act accepts a gig", contexts: ["EVENTS", "GIGS"], pref: "ACCEPTED", people: "AGENT", inbox: "CONTEXT" },
  { key: "DECLINED", label: "An act turns down a gig", contexts: ["EVENTS", "GIGS"], pref: "DECLINED", people: "AGENT", inbox: "CONTEXT" },
  { key: "LATE", label: "An act is late", contexts: ["EVENTS", "GIGS"], pref: "LATE", people: "AGENT", inbox: "CONTEXT" },
  { key: "SIGNED", label: "A customer signs", contexts: ["EVENTS", "GIGS"], pref: "SIGNED", people: "AGENT", inbox: "CONTEXT" },
  { key: "QUOTE", label: "A proposal is accepted or declined", contexts: ["EVENTS", "GIGS"], pref: "QUOTE", people: "AGENT", inbox: "CONTEXT" },
  { key: "PAID", label: "A customer pays by card", contexts: ["EVENTS", "GIGS"], pref: "PAID", people: "AGENT", inbox: "CONTEXT" },
  { key: "PLANNER", label: "A couple fills in their planner", contexts: ["EVENTS"], pref: "PLANNER", people: "AGENT", inbox: "CONTEXT" },
  { key: "CHECK_INS", label: "Wedding check-ins at 6 months, 3 months, 4 weeks", contexts: ["EVENTS"], pref: null, people: "AGENT", inbox: "CONTEXT" },
  { key: "ENQUIRY", label: "A new lead comes in", contexts: ["ALL"], pref: "ENQUIRY", people: "ENQUIRY", inbox: "BUSINESS" },
  { key: "BILLING", label: "Monthly billing reminders", contexts: ["ALL"], pref: null, people: "ADMINS", inbox: "BUSINESS" },
  { key: "PAY_RUN", label: "Weekly pay run email", contexts: ["ALL"], pref: null, people: "ADMINS", inbox: "ACCOUNTS" },
] as const satisfies readonly {
  key: string;
  label: string;
  contexts: readonly RouteContext[];
  pref: StaffAlert | null;
  people: People;
  inbox: Inbox;
}[];

export type TeamAlert = (typeof TEAM_ALERTS)[number]["key"];
type AlertDef = (typeof TEAM_ALERTS)[number];

export function alertDef(alert: TeamAlert): AlertDef {
  return TEAM_ALERTS.find((a) => a.key === alert)!;
}

/** The words for each choice in an alert's drop-down. */
export function routeLabels(alert: TeamAlert): Record<Route, string> {
  const a = alertDef(alert);
  const people = a.people === "AGENT" ? "The lead agent" : a.people === "ADMINS" ? "Admins" : "As set in Enquiry form";
  const inbox = a.inbox === "CONTEXT" ? "The shared inbox" : a.inbox === "ACCOUNTS" ? "Accounts email" : "Business email";
  return { AGENT: people, INBOX: inbox, BOTH: "Both", NOBODY: "Nobody" };
}

// ---------------------------------------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------------------------------------

/**
 * Businesses from before this setting (stored as {}): every alert goes where it always has. Booking alerts to the
 * lead agent; billing reminders to the business email and the pay run email to the accounts email (each admin when
 * those aren't set, as the "shared inbox" choice falls back to the people when its address is empty).
 */
function legacyRoute(a: AlertDef): Route {
  return a.people === "ADMINS" ? "INBOX" : "AGENT";
}

/**
 * New businesses ("_defaults": "SHARED"): wedding and event alerts go to the events inbox once it's set (until then,
 * to the lead agent as before). A late act at a wedding goes to both, so the agent still gets the text.
 */
function sharedRoute(a: AlertDef, ctx: RouteContext): Route {
  if (ctx !== "EVENTS") return legacyRoute(a);
  return a.key === "LATE" ? "BOTH" : "INBOX";
}

const isRoute = (v: unknown): v is Route => typeof v === "string" && (ROUTES as readonly string[]).includes(v);

/** The choice for one alert in one context: what's saved, or else the business's defaults. */
export function routeFor(raw: unknown, alert: TeamAlert, ctx: RouteContext): Route {
  const a = alertDef(alert);
  const c: RouteContext = (a.contexts as readonly RouteContext[]).includes(ctx) ? ctx : a.contexts[0];
  const r = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const row = r[alert];
  const saved = row && typeof row === "object" ? (row as Record<string, unknown>)[c] : undefined;
  if (isRoute(saved)) return saved;
  return r._defaults === "SHARED" ? sharedRoute(a, c) : legacyRoute(a);
}

export type Routing = Record<TeamAlert, Partial<Record<RouteContext, Route>>>;

/** Every cell of the table, saved or defaulted, for the settings page. */
export function readRouting(raw: unknown): Routing {
  const out = {} as Routing;
  for (const a of TEAM_ALERTS) {
    out[a.key] = {};
    for (const c of a.contexts) out[a.key][c] = routeFor(raw, a.key, c);
  }
  return out;
}

/** The name of one cell's drop-down in the settings form. */
export const routeField = (alert: TeamAlert, ctx: RouteContext) => `route:${alert}:${ctx}`;

/** Read the settings form's drop-downs. Every cell is saved, so the defaults no longer matter once saved. */
export function routingFromForm(get: (name: string) => string | null, current: unknown): Routing {
  const out = {} as Routing;
  for (const a of TEAM_ALERTS) {
    out[a.key] = {};
    for (const c of a.contexts) {
      const v = get(routeField(a.key, c));
      out[a.key][c] = isRoute(v) ? v : routeFor(current, a.key, c);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// Which context a booking or proposal is in
// ---------------------------------------------------------------------------------------------------------

/** Event types that are a customer's own event (a wedding, party or company do), not a venue's gig. */
export const CUSTOMER_EVENT_TYPES = ["WEDDING", "PRIVATE_PARTY", "CORPORATE"];

/** A booking in a wedding or event (or of a wedding, party or corporate type) is an events one; the rest are venue gigs. */
export function bookingContext(b: { eventId?: string | null; eventType?: string | null }): AlertContext {
  return b.eventId || CUSTOMER_EVENT_TYPES.includes(b.eventType ?? "") ? "EVENTS" : "GIGS";
}

/** A proposal (or anything else with just a type) by its event type. */
export function typeContext(eventType: string | null | undefined): AlertContext {
  return CUSTOMER_EVENT_TYPES.includes(eventType ?? "") ? "EVENTS" : "GIGS";
}

// ---------------------------------------------------------------------------------------------------------
// Working out who gets it
// ---------------------------------------------------------------------------------------------------------

export type TeamPerson = { id: string; email: string; name: string; phone: string; notifyPrefs: unknown };

export type TeamRecipients = {
  /** Email addresses, each once (whatever its case). */
  emails: string[];
  /** First names by lower-case email, for the people (not the inboxes), e.g. for "Hi Sam". */
  names: Record<string, string>;
  /** Logins to send a phone notification to (people only: shared inboxes are email only). */
  push: string[];
  /** People to text (people only). */
  text: { userId: string; phone: string }[];
};

/**
 * Who gets an alert, given the choice and what it can go to:
 *  - people: who the "people" choice means here (the lead agent, the enquiry contacts or the admins). Each person's
 *    own switches in their profile apply, by channel. Someone who has turned it off simply doesn't get it.
 *  - inbox: the shared inbox's address. When it's empty, "The shared inbox" goes to the people instead, so an alert
 *    never goes nowhere just because an address hasn't been filled in.
 *  - fallback: where the people choice goes when there's nobody (e.g. no lead agent): the business email, as today.
 *    Not used when the inbox is getting it anyway.
 */
export function resolveRecipients(input: { alert: TeamAlert; route: Route; inbox: string; people: TeamPerson[]; fallback?: string }): TeamRecipients {
  const { route, people } = input;
  const pref = alertDef(input.alert).pref;
  const inbox = input.inbox.trim();
  const useInbox = (route === "INBOX" || route === "BOTH") && !!inbox;
  const usePeople = route === "AGENT" || route === "BOTH" || (route === "INBOX" && !inbox);
  const out: TeamRecipients = { emails: [], names: {}, push: [], text: [] };
  const seen = new Set<string>();
  const addEmail = (e: string) => {
    const t = e.trim();
    if (!t || seen.has(t.toLowerCase())) return;
    seen.add(t.toLowerCase());
    out.emails.push(t);
  };
  const on = (p: TeamPerson, c: "email" | "text" | "push") => !pref || wants(p.notifyPrefs, pref, c);
  if (useInbox) addEmail(inbox);
  if (usePeople) {
    if (people.length) {
      for (const p of people) {
        if (on(p, "email") && p.email.trim()) {
          addEmail(p.email);
          out.names[p.email.trim().toLowerCase()] = p.name.trim().split(/\s+/)[0] ?? "";
        }
        if (on(p, "push") && !out.push.includes(p.id)) out.push.push(p.id);
        if (on(p, "text") && p.phone.trim() && !out.text.some((t) => t.userId === p.id)) out.text.push({ userId: p.id, phone: p.phone.trim() });
      }
    } else if (!useInbox && input.fallback) addEmail(input.fallback);
  }
  return out;
}

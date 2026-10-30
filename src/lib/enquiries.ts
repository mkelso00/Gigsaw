// The enquiry form a business puts on its own website: its settings, checking what's sent in,
// spam checks and the embed code. Pure (no database), so it can be unit tested.

import { createHmac, timingSafeEqual } from "node:crypto";
import { eventTypeLabel, type EventType } from "./constants";
import { FormError } from "./forms";
import { formatDate } from "./time";

// ---------- Settings ----------

/** Fields the business can show or hide. Name, email and phone are always asked for. */
export const ENQUIRY_FIELDS = [
  { key: "eventType", label: "Type of event" },
  { key: "date", label: "Date", hint: "Without a date the enquiry still comes in, but no booking is made until you add one." },
  { key: "time", label: "Start time" },
  { key: "venue", label: "Venue or town" },
  { key: "guests", label: "Number of guests" },
  { key: "budget", label: "Budget" },
  { key: "acts", label: "Acts they like", hint: "A list of your acts by name to tick. Prices are never shown." },
  { key: "message", label: "Message" },
] as const;

export type EnquiryField = (typeof ENQUIRY_FIELDS)[number]["key"];

/** Who hears about a new enquiry: the business email, every admin, everyone, or one person ("USER:<id>"). */
export type EnquiryNotify = "BUSINESS" | "ADMINS" | "TEAM" | `USER:${string}`;

export type EnquiryConfig = {
  fields: Record<EnquiryField, boolean>;
  intro: string;
  thanks: string;
  notify: EnquiryNotify;
  logoUrl: string;
};

export const DEFAULT_THANKS = "Thanks for getting in touch. We've got your enquiry and will come back to you soon, usually within a working day.";
export const DEFAULT_INTRO = "Tell us about your event and we'll come back to you with ideas and prices.";

/** The business's form settings, with anything missing filled in. Every field shows unless switched off. */
export function readEnquiryConfig(raw: unknown): EnquiryConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<string, unknown>>;
  const f = (r.fields && typeof r.fields === "object" ? r.fields : {}) as Partial<Record<string, unknown>>;
  const fields = Object.fromEntries(ENQUIRY_FIELDS.map(({ key }) => [key, f[key] !== false])) as Record<EnquiryField, boolean>;
  const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const notify = text(r.notify);
  return {
    fields,
    intro: text(r.intro),
    thanks: text(r.thanks),
    notify: notify === "ADMINS" || notify === "TEAM" || /^USER:[\w-]{1,40}$/.test(notify) ? (notify as EnquiryNotify) : "BUSINESS",
    logoUrl: isHttpsUrl(text(r.logoUrl)) ? text(r.logoUrl) : "",
  };
}

export function isHttpsUrl(s: string) {
  if (!/^https:\/\//i.test(s) || s.length > 500) return false;
  try {
    new URL(s);
    return true;
  } catch {
    return false;
  }
}

/** The public address's last part, made from the business name: "Northern Lights Agency" → "northern-lights-agency". */
export function slugify(name: string) {
  const s = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30)
    .replace(/-+$/, "");
  return s.length >= 3 ? s : s ? `${s}-enquiries` : "enquiries";
}

export const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

// ---------- The form ----------

/** The kinds of event a customer can pick, in their words, with the booking type each becomes. */
export const ENQUIRY_EVENT_TYPES: { value: EventType; label: string }[] = [
  { value: "WEDDING", label: "Wedding" },
  { value: "PRIVATE_PARTY", label: "Birthday or private party" },
  { value: "CORPORATE", label: "Corporate event" },
  { value: "GIG", label: "Pub, bar or restaurant" },
  { value: "FESTIVAL", label: "Festival" },
  { value: "OTHER", label: "Something else" },
];

export function enquiryTypeLabel(t: string) {
  return ENQUIRY_EVENT_TYPES.find((x) => x.value === t)?.label ?? (t ? eventTypeLabel(t) : "");
}

export const LIMITS = { name: 100, email: 200, phone: 40, venue: 200, budget: 100, message: 3000, acts: 20, links: 2 } as const;

export type EnquiryData = {
  name: string;
  email: string;
  phone: string;
  eventType: EventType | "";
  date: string;
  startTime: string;
  venue: string;
  guests: number | null;
  budget: string;
  acts: { id: string; name: string }[];
  message: string;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** A real calendar date written "YYYY-MM-DD" (not 31 February). */
export function isRealDate(s: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Tidy a line of text: no control characters, single spaces. */
function line(s: string) {
  return s
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Tidy a message: keep line breaks (at most two in a row), drop other control characters. */
function block(s: string) {
  return s
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function capped(value: string, max: number, label: string) {
  if (value.length > max) throw new FormError(`${label} is too long (${max} characters at most)`);
  return value;
}

/**
 * Check and tidy what the customer sent. Only the fields the form shows are read. Acts must be the
 * business's own (by id); anything else is dropped. Throws a FormError with a message for the customer.
 */
export function parseEnquiry(form: FormData, config: EnquiryConfig, opts: { today: string; acts: { id: string; name: string }[] }): EnquiryData {
  const get = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" ? v : "";
  };
  const on = config.fields;

  const name = capped(line(get("name")), LIMITS.name, "Your name");
  if (name.length < 2) throw new FormError("Please tell us your name");
  const email = capped(line(get("email")).toLowerCase(), LIMITS.email, "Email");
  if (!EMAIL.test(email)) throw new FormError("Please check your email address");
  const phone = capped(line(get("phone")), LIMITS.phone, "Phone number");
  if (phone && (!/^[0-9+()\-. ]+$/.test(phone) || phone.replace(/\D/g, "").length < 7)) throw new FormError("Please check your phone number");

  let eventType: EventType | "" = "";
  if (on.eventType) {
    const t = get("eventType");
    const found = ENQUIRY_EVENT_TYPES.find((x) => x.value === t);
    if (!found) throw new FormError("Please choose the type of event");
    eventType = found.value;
  }

  let date = "";
  if (on.date) {
    date = line(get("date"));
    if (!isRealDate(date)) throw new FormError("Please choose the date of your event");
    if (date < opts.today) throw new FormError("That date has already passed");
    if (date > `${Number(opts.today.slice(0, 4)) + 5}${opts.today.slice(4)}`) throw new FormError("Please check the date of your event");
  }

  let startTime = "";
  if (on.time && on.date) {
    startTime = line(get("startTime"));
    if (startTime && !TIME.test(startTime)) throw new FormError("Please check the start time");
  }

  const venue = on.venue ? capped(line(get("venue")), LIMITS.venue, "Venue or town") : "";

  let guests: number | null = null;
  if (on.guests) {
    const raw = line(get("guests")).replace(/[, ]/g, "");
    if (raw) {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1 || n > 100_000) throw new FormError("Please enter the number of guests as a number, like 120");
      guests = n;
    }
  }

  const budget = on.budget ? capped(line(get("budget")), LIMITS.budget, "Budget") : "";

  let acts: { id: string; name: string }[] = [];
  if (on.acts) {
    const wanted = new Set(form.getAll("acts").filter((v): v is string => typeof v === "string"));
    acts = opts.acts.filter((a) => wanted.has(a.id)).slice(0, LIMITS.acts);
  }

  const message = on.message ? capped(block(get("message")), LIMITS.message, "Your message") : "";
  if ((message.match(/https?:\/\/|www\./gi)?.length ?? 0) > LIMITS.links) throw new FormError("Please take the web links out of your message");

  return { name, email, phone, eventType, date, startTime, venue, guests, budget, acts, message };
}

/** What makes a booking: a wedding becomes a wedding (an event) and anything else an Enquiry booking. Nothing without a date. */
export function enquiryMakes(d: Pick<EnquiryData, "date" | "eventType">): "EVENT" | "BOOKING" | "NOTHING" {
  if (!d.date) return "NOTHING";
  return d.eventType === "WEDDING" ? "EVENT" : "BOOKING";
}

/** First name, for "Hi Sam". */
export function firstName(name: string) {
  return name.trim().split(/\s+/)[0] ?? "";
}

/** Readable date for a "YYYY-MM-DD" day, written like every other date in Gigsaw. */
export function formatDay(key: string) {
  return isRealDate(key) ? formatDate(new Date(`${key}T12:00:00Z`), "UTC") : key;
}

/** An enquiry's details, as sent or as saved. */
export type EnquiryDetails = Omit<EnquiryData, "name" | "email" | "phone" | "eventType"> & { name?: string; email?: string; phone?: string; eventType: string };

/** The details as label and value pairs, for emails, the note on the customer and the enquiry list. Empty ones are left out. */
export function enquiryRows(d: EnquiryDetails): [string, string][] {
  const rows: [string, string][] = [];
  const add = (k: string, v: string | number | null | undefined) => {
    if (v !== null && v !== undefined && String(v).trim()) rows.push([k, String(v)]);
  };
  add("Name", d.name);
  add("Email", d.email);
  add("Phone", d.phone);
  add("Type of event", d.eventType ? enquiryTypeLabel(d.eventType) : "");
  add("Date", d.date ? `${formatDay(d.date)}${d.startTime ? `, starting ${d.startTime}` : ""}` : "");
  add("Venue or town", d.venue);
  add("Guests", d.guests);
  add("Budget", d.budget);
  add("Acts they like", d.acts.map((a) => a.name).join(", "));
  add("Message", d.message);
  return rows;
}

/** The note added to the customer's record. */
export function enquiryNote(d: EnquiryData, source: string) {
  const rows = enquiryRows({ ...d, name: undefined, email: undefined });
  return [`Enquiry from the website form${source ? ` (${source})` : ""}`, ...rows.map(([k, v]) => (k === "Message" ? `\n${v}` : `${k}: ${v}`))].join("\n");
}

/** The booking's or wedding's name, e.g. "Sam Jones's wedding" or "Sam Jones: private party". */
export function enquiryTitle(d: Pick<EnquiryData, "name" | "eventType">) {
  if (d.eventType === "WEDDING") return `${d.name}'s wedding`;
  return d.eventType && d.eventType !== "OTHER" ? `${d.name}: ${eventTypeLabel(d.eventType).toLowerCase()}` : `${d.name}: enquiry`;
}

// ---------- Spam checks ----------

/** At least this long between the form loading and being sent: people take longer, bots don't. */
export const MIN_FILL_MS = 3_000;
/** A form left open longer than this has to be reloaded. */
export const MAX_FORM_AGE_MS = 2 * 86_400_000;

function sign(ms: number, secret: string) {
  return createHmac("sha256", secret).update(`enquiry:${ms}`).digest("base64url").slice(0, 22);
}

/** A signed stamp of when the form was shown, put in a hidden field so it can't be faked. */
export function formStamp(ms: number, secret: string) {
  return `${ms}.${sign(ms, secret)}`;
}

/** Check the stamp: "ok", "fast" (sent too quickly), "old" (open too long) or "bad" (missing or tampered with). */
export function checkFormStamp(stamp: string, secret: string, now: number): "ok" | "fast" | "old" | "bad" {
  const m = /^(\d{10,16})\.([\w-]{22})$/.exec(stamp ?? "");
  if (!m) return "bad";
  const ms = Number(m[1]);
  const want = Buffer.from(sign(ms, secret));
  const got = Buffer.from(m[2]);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return "bad";
  if (ms > now + 60_000) return "bad";
  if (now - ms < MIN_FILL_MS) return "fast";
  if (now - ms > MAX_FORM_AGE_MS) return "old";
  return "ok";
}

/**
 * Counts attempts per key (e.g. per IP address) in a sliding window, in memory. It resets when the
 * server restarts, so saved enquiries are counted from the database as well.
 */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(
    private max: number,
    private windowMs: number,
  ) {}

  /** Record an attempt. False when this key has already had its share. */
  hit(key: string, now = Date.now()) {
    const since = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > since);
    const allowed = recent.length < this.max;
    if (allowed) recent.push(now);
    this.hits.set(key, recent);
    // Keep the map from growing for ever.
    if (this.hits.size > 5_000) {
      for (const [k, times] of this.hits) if (!times.some((t) => t > since)) this.hits.delete(k);
    }
    return allowed;
  }
}

/** Where it came from, from the page that embedded or linked to the form: "www.example.co.uk/weddings". */
export function sourceFrom(referer: string | null | undefined, ownHost: string) {
  if (!referer) return "";
  try {
    const u = new URL(referer);
    if (!/^https?:$/.test(u.protocol) || u.host === ownHost) return "";
    return `${u.host}${u.pathname === "/" ? "" : u.pathname}`.slice(0, 200);
  } catch {
    return "";
  }
}

// ---------- Embedding ----------

/** The code to paste into a website: the form in a frame that grows to fit, so there's never a scroll bar inside it. */
export function embedSnippet(formUrl: string) {
  const src = `${formUrl}${formUrl.includes("?") ? "&" : "?"}embed=1`;
  return [
    `<iframe id="gigsaw-enquiry" src="${src}" title="Enquiry form" style="width:100%;height:900px;border:0" loading="lazy"></iframe>`,
    `<script>`,
    `window.addEventListener("message", function (e) {`,
    `  var f = document.getElementById("gigsaw-enquiry");`,
    `  if (!f || e.source !== f.contentWindow || !e.data || e.data.type !== "gigsaw-enquiry") return;`,
    `  f.style.height = Math.min(Number(e.data.height) || 900, 20000) + "px";`,
    `  if (e.data.sent) f.scrollIntoView({ behavior: "smooth", block: "start" });`,
    `});`,
    `</script>`,
  ].join("\n");
}

// Automatic messages a business can switch off or reword (Settings > Notifications). Each one
// keeps Gigsaw's own wording unless the business writes its own subject, message or text. The
// details block (venue, date, times, links) is always added automatically underneath.

export type TemplateGroup = "ACTS" | "CUSTOMERS" | "TEAM";

export type TemplateDef = {
  key: string;
  group: TemplateGroup;
  label: string;
  hint: string;
  /** Example of Gigsaw's own wording, shown in the editor. */
  example: { subject: string; intro: string; text?: string };
  placeholders: string[];
  /** Only ever sent when someone presses a button, so it can't be switched off. */
  manual?: boolean;
};

const GIG = ["first_name", "act", "venue", "date", "time", "business"];
const EVENT = ["first_name", "event", "date", "business"];

export const TEMPLATES: TemplateDef[] = [
  {
    key: "OFFER",
    group: "ACTS",
    label: "Gig offer",
    hint: "Asks the act to accept or decline, with a link. Sent when a gig is set to Awaiting confirmation.",
    example: {
      subject: "Gig offer: {venue}, {date}",
      intro: "Hi {first_name}, {business} would like to book you for this gig. Please accept or decline as soon as you can.",
      text: "{business}: gig offer, {venue} {date}. Accept or decline: (link)",
    },
    placeholders: GIG,
  },
  {
    key: "BOOKED",
    group: "ACTS",
    label: "You're booked",
    hint: "Sent to the act when a gig is confirmed.",
    example: { subject: "You're booked: {venue}, {date}", intro: "Hi {first_name}, you're confirmed for this gig. It's in your app and calendar." },
    placeholders: GIG,
  },
  {
    key: "GIG_CHANGE",
    group: "ACTS",
    label: "New gig or gig changed",
    hint: "When a gig is added for the act, or its date, times, venue or fee change.",
    example: { subject: "Gig changed: {venue}, {date}", intro: "Hi {first_name}, {business} has changed one of your gigs. Here's what's different." },
    placeholders: GIG,
  },
  {
    key: "REMINDER_WEEK",
    group: "ACTS",
    label: "Weekly gig list",
    hint: "Each act's gigs for the coming week. Day and time are set in Act reminders.",
    example: { subject: "Your gigs next week", intro: "Hi {first_name}, here are your gigs for next week." },
    placeholders: ["first_name", "business"],
  },
  {
    key: "REMINDER_DAY",
    group: "ACTS",
    label: "Reminder on the day",
    hint: "“Don't forget your gig this evening”.",
    example: { subject: "Tonight: {venue}", intro: "Hi {first_name}, don't forget your gig tonight at {venue}. Call time {time}." },
    placeholders: GIG,
  },
  {
    key: "EVENT_DETAILS",
    group: "ACTS",
    label: "Wedding and event details",
    hint: "Final details sent to each act a week before a wedding or event.",
    example: { subject: "{event}: your details", intro: "Hi {first_name}, here are the final details for {event}." },
    placeholders: EVENT,
  },
  {
    key: "WELCOME",
    group: "ACTS",
    label: "Welcome to a new act",
    hint: "When you approve a new act who joined through your link.",
    example: { subject: "You're on the books with {business}", intro: "{business} has approved your details. Log in to see your gigs." },
    placeholders: ["act", "business"],
  },
  {
    key: "CUSTOMER_CONFIRMED",
    group: "CUSTOMERS",
    label: "Booking confirmed",
    hint: "Tells a wedding or private customer an act is confirmed. Who gets it is set in Weddings and events.",
    example: { subject: "Confirmed: {act} for {event}", intro: "Hi {first_name}, great news: {act} is confirmed for {event}." },
    placeholders: ["first_name", "act", "event", "date", "business"],
  },
  {
    key: "CONTRACT",
    group: "CUSTOMERS",
    label: "Contract to sign",
    hint: "Sent when you press Send contract to sign on a booking or a wedding or event. The link to read and sign it is always added.",
    example: {
      subject: "Your contract to sign: {event}",
      intro:
        "Hi {first_name}, here is your contract from {business} for {event} on {date}. Please read it and sign it online. It takes a minute and works on your phone.",
    },
    placeholders: ["first_name", "event", "act", "date", "business"],
    manual: true,
  },
  {
    key: "ARRIVED",
    group: "CUSTOMERS",
    label: "Act has arrived",
    hint: "When the act checks in at the venue. Can be switched off per booking.",
    example: {
      subject: "{act} has arrived",
      intro: "Hi {first_name}, good news: {act} is at {venue} and getting set up.",
      text: "{act} has arrived at {venue} and is setting up. {business}",
    },
    placeholders: GIG,
  },
  {
    key: "PLANNER",
    group: "CUSTOMERS",
    label: "Planner link",
    hint: "Asks a wedding or event customer for the running order, contacts and song requests.",
    example: { subject: "{event}: a few details from you", intro: "Hi {first_name}, to make the day perfect we need a few details from you." },
    placeholders: EVENT,
  },
  {
    key: "BALANCE",
    group: "CUSTOMERS",
    label: "Balance reminder",
    hint: "Reminds a wedding or event customer of what's left to pay.",
    example: { subject: "{event}: balance due", intro: "Hi {first_name}, just a reminder that the balance for {event} is due soon." },
    placeholders: EVENT,
  },
  {
    key: "THANKS",
    group: "CUSTOMERS",
    label: "Thank you",
    hint: "Sent after a wedding or event, with your review link if you've set one.",
    example: { subject: "Thank you!", intro: "Hi {first_name}, thank you for having us at {event}. We hope you had a brilliant time." },
    placeholders: EVENT,
  },
  {
    key: "NEW_ACT",
    group: "TEAM",
    label: "New act applied",
    hint: "Sent to your business email when someone fills in your join link.",
    example: { subject: "New act wants to join: {act}", intro: "{act} has sent their details." },
    placeholders: ["act", "business"],
  },
];

export const TEMPLATE_GROUPS: Record<TemplateGroup, { label: string; hint: string; icon: string; slug: string }> = {
  ACTS: { label: "Act notifications", hint: "Offers, confirmations, changes and reminders to your acts", icon: "artists", slug: "acts" },
  CUSTOMERS: { label: "Customer notifications", hint: "Confirmations, arrival notes and wedding emails to customers", icon: "user", slug: "customers" },
  TEAM: { label: "Internal user notifications", hint: "Alerts to you and your team", icon: "contacts", slug: "team" },
};

export type TemplateSettings = { off?: boolean; subject?: string; intro?: string; text?: string };

function read(all: unknown, key: string): TemplateSettings {
  const t = all && typeof all === "object" ? (all as Record<string, TemplateSettings>)[key] : undefined;
  return t && typeof t === "object" ? t : {};
}

/** Fill {placeholders}. Unknown ones are left as typed, so a mistake is easy to spot. */
export function fillPlaceholders(text: string, vars: Record<string, string | undefined | null>) {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] != null && vars[k] !== "" ? String(vars[k]) : k in vars ? "" : m)).replace(/  +/g, " ");
}

/**
 * The business's version of a message: whether it's on, and any custom subject, message or text
 * with the placeholders filled in. Anything not customised comes back undefined, so the sender
 * uses its own wording.
 */
export function messageFor(templates: unknown, key: string, vars: Record<string, string | undefined | null>) {
  const t = read(templates, key);
  const fill = (s?: string) => (s?.trim() ? fillPlaceholders(s.trim(), vars) : undefined);
  return { on: !t.off, subject: fill(t.subject), intro: fill(t.intro), text: fill(t.text) };
}

export function templateSettings(templates: unknown, key: string) {
  return read(templates, key);
}

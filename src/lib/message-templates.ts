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
/** Wedding notices to staff: first_name is the staff member's, customer the couple's names. */
const TEAM_EVENT = ["first_name", "event", "date", "customer", "business"];

export const TEMPLATES: TemplateDef[] = [
  {
    key: "OFFER",
    group: "ACTS",
    label: "Booking offer",
    hint: "Asks the act to accept or decline, with a link. Sent when a booking is set to Awaiting confirmation.",
    example: {
      subject: "Booking offer: {venue}, {date}",
      intro: "Hi {first_name}, {business} would like to book you for this booking. Please accept or decline as soon as you can.",
      text: "{business}: booking offer, {venue} {date}. Accept or decline: (link)",
    },
    placeholders: GIG,
  },
  {
    key: "AVAILABILITY",
    group: "ACTS",
    label: "Are you free?",
    hint: "Asks the act if they're free on a date, with a link to answer Yes or No. Sent from Who's free.",
    example: {
      subject: "Are you free on {date}?",
      intro: "Hi {first_name}, {business} is looking for an act on {date}. Are you free? Just tap Yes or No.",
      text: "{business}: are you free on {date}? Tap to answer yes or no: (link)",
    },
    placeholders: GIG,
  },
  {
    key: "BOOKED",
    group: "ACTS",
    label: "You're booked",
    hint: "Sent to the act when a booking is confirmed.",
    example: { subject: "You're booked: {venue}, {date}", intro: "Hi {first_name}, you're confirmed for this booking. It's in your app and calendar." },
    placeholders: GIG,
  },
  {
    key: "GIG_CHANGE",
    group: "ACTS",
    label: "New booking or booking changed",
    hint: "When a booking is added for the act, or its date, times, venue or fee change.",
    example: { subject: "Booking changed: {venue}, {date}", intro: "Hi {first_name}, {business} has changed one of your bookings. Here's what's different." },
    placeholders: GIG,
  },
  {
    key: "REMINDER_WEEK",
    group: "ACTS",
    label: "Weekly booking list",
    hint: "Each act's bookings for the coming week. Day and time are set in Act reminders.",
    example: { subject: "Your bookings next week", intro: "Hi {first_name}, here are your bookings for next week." },
    placeholders: ["first_name", "business"],
  },
  {
    key: "REMINDER_DAY",
    group: "ACTS",
    label: "Reminder on the day",
    hint: "“Don't forget your booking this evening”.",
    example: { subject: "Tonight: {venue}", intro: "Hi {first_name}, don't forget your booking tonight at {venue}. Call time {time}." },
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
    key: "EVENT_UPDATED",
    group: "ACTS",
    label: "Wedding details updated",
    hint: "When the couple (or your team) change a wedding or event's plan, each act on it is told what changed, once the changes stop for 15 minutes.",
    example: { subject: "{event}: details updated", intro: "Hi {first_name}, some details for {event} have changed. Here's what's new." },
    placeholders: EVENT,
  },
  {
    key: "WELCOME",
    group: "ACTS",
    label: "Welcome to a new act",
    hint: "When you approve a new act who joined through your link.",
    example: { subject: "You're on the books with {business}", intro: "{business} has approved your details. Log in to see your bookings." },
    placeholders: ["act", "business"],
  },
  {
    key: "PAY_DETAILS",
    group: "ACTS",
    label: "Pay details reminder",
    hint: "Once a week (Monday morning, in office hours) to whoever an act's invoices go to, while their bank details or address are missing and they have a gig coming up or one still to be paid for. Staff can also send it from Pay acts with Remind now. A link to their details in the app is always added.",
    example: {
      subject: "Add your bank and address so {business} can pay you",
      intro: "Hi {first_name}, {business} needs your bank details and address to pay you for your gigs. It takes a minute in the app, and you only do it once.",
    },
    placeholders: ["first_name", "act", "business"],
  },
  {
    key: "SELF_BILLING",
    group: "ACTS",
    label: "Self-billing agreement reminder",
    hint: "Once a week (Monday morning, in office hours) to whoever an act's invoices go to, when their details are in but they haven't agreed to self-billing, or agreed more than 12 months ago, and they have a gig coming up or one still to be paid for. A link to agree in the app is always added.",
    example: {
      subject: "Please confirm self-billing with {business}",
      intro:
        "Hi {first_name}, {business} makes out your invoices for you (self-billing). HMRC asks for your agreement to that, renewed once a year. Please read it and tick to agree in the app. It takes a moment.",
    },
    placeholders: ["first_name", "act", "business"],
  },
  {
    key: "CUSTOMER_CONFIRMED",
    group: "CUSTOMERS",
    label: "Booking confirmed",
    hint: "Tells a wedding or private customer their booking is confirmed. For a wedding or event with several acts it goes once, when every act is confirmed, and {act} lists them all. Who gets it is set in Weddings and events.",
    example: { subject: "Confirmed: {act} for {event}", intro: "Hi {first_name}, great news: {act} is confirmed for {event}." },
    placeholders: ["first_name", "act", "event", "date", "business"],
  },
  {
    key: "CONTRACT",
    group: "CUSTOMERS",
    label: "Contract to sign and approve",
    hint: "Sent when you press Send contract to sign on a booking or a wedding or event. The link to read, sign and approve it online is always added.",
    example: {
      subject: "Please sign and approve: {event}",
      intro:
        "Hi {first_name}, here is your contract from {business} for {event} on {date}. Please read it, sign in the box and press Approve. It's all online, nothing to print, and works on your phone.",
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
    hint: "Six months before a wedding or event, asks the customer for the running order, contacts and song requests, with a summary of what's paid and when the balance is due.",
    example: { subject: "{event}: a few details from you", intro: "Hi {first_name}, to make the day perfect we need a few details from you." },
    placeholders: EVENT,
  },
  {
    key: "BALANCE",
    group: "CUSTOMERS",
    label: "Balance reminder",
    hint: "Three months before a wedding or event, when the balance is due, if anything is still owed to you.",
    example: { subject: "{event}: balance due", intro: "Hi {first_name}, just a reminder that the balance for {event} is due." },
    placeholders: EVENT,
  },
  // ---- The wedding journey (src/lib/events.ts) ----
  {
    key: "PLANNER_CHASE",
    group: "CUSTOMERS",
    label: "Planner reminder",
    hint: "Three months before a wedding or event, if the customer hasn't filled in their planner yet.",
    example: {
      subject: "A quick reminder: the running order for {event}",
      intro: "Hi {first_name}, we still need your running order and a few details for {event}. It only takes about five minutes.",
    },
    placeholders: EVENT,
  },
  {
    key: "PLANNER_FINAL",
    group: "CUSTOMERS",
    label: "Planner: last call",
    hint: "Four weeks before a wedding or event, when the running order and songs are due, if the planner still isn't filled in.",
    example: {
      subject: "{event}: we need your running order",
      intro: "Hi {first_name}, {event} is only four weeks away and we still need your running order and song choices. Please fill them in today.",
    },
    placeholders: EVENT,
  },
  {
    key: "WEEK_TO_GO",
    group: "CUSTOMERS",
    label: "One week to go",
    hint: "A short, warm note to the customer a week before their wedding or event.",
    example: { subject: "One week to go!", intro: "Hi {first_name}, we can't wait! There's nothing for you to worry about, we're all ready to go 👌" },
    placeholders: EVENT,
  },
  {
    key: "PAYMENT_RECEIVED",
    group: "CUSTOMERS",
    label: "Payment received",
    hint: "Sent to a wedding or private customer when you record a payment from them, with what's left to pay. Not sent to venues.",
    example: { subject: "Payment received: {amount}", intro: "Hi {first_name}, thank you: we've received your payment of {amount} for {what}." },
    placeholders: ["first_name", "amount", "what", "business"],
  },
  {
    key: "PAY_LINK",
    group: "CUSTOMERS",
    label: "Payment link",
    hint: "Sent when you email a venue or customer a link to pay a deposit or balance by card.",
    example: {
      subject: "{what}: {amount} to pay",
      intro: "Hi {first_name}, here's a secure link to pay {amount} by card for {what}.",
    },
    placeholders: ["first_name", "what", "amount", "business"],
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
    key: "ENQUIRY_REPLY",
    group: "CUSTOMERS",
    label: "Enquiry received",
    hint: "The automatic reply to someone who fills in the enquiry form on your website. What they sent is listed underneath.",
    example: {
      subject: "Thanks for your enquiry",
      intro: "Hi {first_name}, thanks for getting in touch with {business}. We've got your enquiry and will come back to you soon.",
    },
    placeholders: ["first_name", "event_type", "date", "business"],
  },
  {
    key: "QUOTE",
    group: "CUSTOMERS",
    label: "Your proposal",
    hint: "Sent when you press Send on a proposal. The link to see it and sign or decline is always added, with the total, deposit and valid-until date.",
    example: {
      subject: "Your proposal from {business}: {event}",
      intro: "Hi {first_name}, thank you for your enquiry. Here's your proposal for {event} on {date}. You can sign and approve it online in a minute.",
    },
    placeholders: ["first_name", "event", "date", "total", "valid_until", "business"],
    manual: true,
  },
  {
    key: "QUOTE_ACCEPTED",
    group: "CUSTOMERS",
    label: "Proposal accepted: you're booked",
    hint: "Sent to the customer when they accept a proposal, listing what's booked, the deposit and a link to pay it by card if card payments are set up. Not for weddings: a couple get “Proposal accepted: deposit to pay” and then “Wedding booked”.",
    example: {
      subject: "You're booked: {event}",
      intro: "Hi {first_name}, thank you for accepting your proposal. {event} on {date} is booked with {business}.",
    },
    placeholders: ["first_name", "event", "date", "total", "business"],
  },
  {
    key: "QUOTE_ACCEPTED_HELD",
    group: "CUSTOMERS",
    label: "Proposal accepted: deposit to pay",
    hint: "Sent to a couple when they accept a wedding proposal that has a deposit. Their date is held for them, and it's booked once the deposit is in. The deposit and a link to pay it by card (if card payments are set up) are always added.",
    example: {
      subject: "Thanks for accepting: {event}",
      intro:
        "Hi {first_name}, thank you for accepting your proposal for {event} on {date}. Your date is held for you. To book it, please pay your deposit of {deposit}.",
    },
    placeholders: ["first_name", "event", "date", "total", "deposit", "business"],
  },
  {
    key: "EVENT_SECURED",
    group: "CUSTOMERS",
    label: "Wedding booked",
    hint: "Sent to a couple once their wedding is booked: the proposal or contract is agreed and the deposit is in (or straight away when there's no deposit). Lists what's booked, what's left to pay and when the balance is due, three months before the wedding. Sent once.",
    example: {
      subject: "You're booked: {event}",
      intro: "Hi {first_name}, thank you: your deposit has arrived, so {event} on {date} is booked with {business}.",
    },
    placeholders: EVENT,
  },
  {
    key: "QUOTE_CHASE",
    group: "CUSTOMERS",
    label: "Proposal reminder",
    hint: "A gentle reminder to a customer who hasn't answered their proposal: 3 days after it's sent, and again after 7. Sent between 9am and 8pm. The link to their proposal is always added.",
    example: {
      subject: "A quick reminder: your proposal for {event}",
      intro: "Hi {first_name}, just checking you've seen your proposal for {event} on {date}. You can read it and sign it online in a minute.",
    },
    placeholders: ["first_name", "event", "date", "total", "valid_until", "business"],
  },
  {
    key: "QUOTE_DECLINED",
    group: "CUSTOMERS",
    label: "Proposal declined: thank you",
    hint: "Sent to a customer when they decline a proposal, thanking them for their interest.",
    example: {
      subject: "Thank you for considering us",
      intro: "Hi {first_name}, thank you for letting us know, and for considering {business} for {event}. If anything changes, just reply to this email.",
    },
    placeholders: ["first_name", "event", "date", "business"],
  },
  {
    key: "BILL_PO_REQUEST",
    group: "CUSTOMERS",
    label: "Monthly bill: please send a PO",
    hint: "Sent when you press Ask for PO in Monthly billing. Lists the month's gigs (date, venue, act and what each costs the client, never the act's fee) and the total. Replies go to your business email.",
    example: {
      subject: "Purchase order needed: {client}, {month}",
      intro:
        "Hi {first_name}, here are the gigs {business} will be billing {client} for in {month}. Please could you send us a purchase order (PO) number for them? Just reply to this email.",
    },
    placeholders: ["first_name", "client", "month", "total", "business"],
    manual: true,
  },
  {
    key: "NEW_ACT",
    group: "TEAM",
    label: "New act applied",
    hint: "Sent to your business email when someone fills in your join link.",
    example: { subject: "New act wants to join: {act}", intro: "{act} has sent their details." },
    placeholders: ["act", "business"],
  },
  // ---- The wedding journey, to the wedding's lead agent (or your business email) ----
  {
    key: "TEAM_SIX_MONTHS",
    group: "TEAM",
    label: "Wedding: six months to go",
    hint: "To the wedding or event's lead agent (or your business email) six months before, once the customer has been asked for their running order.",
    example: {
      subject: "{event}: six months to go",
      intro: "Hi {first_name}, {event} is six months away. We've asked {customer} for their running order. Please get in touch with them.",
    },
    placeholders: TEAM_EVENT,
  },
  {
    key: "TEAM_THREE_MONTHS",
    group: "TEAM",
    label: "Wedding: three months to go",
    hint: "To the lead agent (or your business email) three months before, when the balance is due: what's still missing, or that all is in hand.",
    example: { subject: "{event}: three months to go", intro: "Hi {first_name}, {event} is three months away. Here's where things stand." },
    placeholders: TEAM_EVENT,
  },
  {
    key: "TEAM_PLANNER_LATE",
    group: "TEAM",
    label: "Wedding: running order missing",
    hint: "To the lead agent (or your business email) four weeks before, if the customer still hasn't filled in their planner.",
    example: {
      subject: "{event}: running order still missing",
      intro: "Hi {first_name}, {customer} still haven't filled in their running order for {event}. It's due now, so please give them a call.",
    },
    placeholders: TEAM_EVENT,
  },
  {
    key: "NEW_ENQUIRY",
    group: "TEAM",
    label: "New enquiry",
    hint: "When someone fills in the enquiry form on your website. Who gets it is set in Enquiry form.",
    example: { subject: "New enquiry: {name}", intro: "{name} has sent an enquiry from your website." },
    placeholders: ["name", "event_type", "date", "business"],
  },
  {
    key: "QUOTE_ANSWER",
    group: "TEAM",
    label: "Proposal accepted or declined",
    hint: "To the proposal's lead agent (or your business email) when a customer accepts or declines a proposal.",
    example: { subject: "Proposal accepted: {event}", intro: "{name} has accepted the proposal for {event}. The bookings are made." },
    placeholders: ["name", "event", "answer", "business"],
  },
  {
    key: "BILL_MONTH_START",
    group: "TEAM",
    label: "Monthly billing: time to bill",
    hint: "To your business email (or each admin when there isn't one) on the 1st of the month, or the first weekday after: how many bills last month needs, with a link to Monthly billing.",
    example: {
      subject: "Monthly billing for {month}: {count} to bill",
      intro: "{month} is over, so it's time to ask for POs and raise the invoices.",
    },
    placeholders: ["month", "count", "business"],
  },
  {
    key: "BILL_MONTH_CHASE",
    group: "TEAM",
    label: "Monthly billing: still to do",
    hint: "On the 5th of the month (or the first weekday after), if any of last month's bills are still missing a PO or haven't been invoiced, a list of them.",
    example: {
      subject: "Monthly billing for {month}: {count} still to do",
      intro: "These bills for {month} are still missing a PO or haven't been invoiced yet.",
    },
    placeholders: ["month", "count", "business"],
  },
  {
    key: "PAY_RUN_READY",
    group: "TEAM",
    label: "Weekly pay run ready to check",
    hint: "On Monday morning (or the first weekday after), when last week's act invoices are ready: how many and the total, with a link to the Weekly pay run. Goes to your accounts email (Settings, General), or each admin when there isn't one. Nothing is sent for your records until you press Send.",
    example: {
      subject: "Last week's pay run is ready to check: {count} invoices, {total}",
      intro: "The act invoices for the gigs from {week} are ready. Check them, send them for your records, then pay everyone and mark them paid.",
    },
    placeholders: ["week", "count", "total", "business"],
  },
  {
    key: "PAY_RUN_SIGN_OFF",
    group: "TEAM",
    label: "Weekly gigs ready to sign off",
    hint: "When act invoices are made at sign-off (Settings, General): on Monday morning (or the first weekday after), how many gigs and acts last week had, with a link to sign them off in the Weekly pay run. Goes to your accounts email, or each admin when there isn't one.",
    example: {
      subject: "Last week's gigs are ready to sign off: {gigs} gigs, {acts} acts",
      intro: "Check that everyone played their gigs from {week}, then sign off the week. That makes the act invoices.",
    },
    placeholders: ["week", "gigs", "acts", "business"],
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

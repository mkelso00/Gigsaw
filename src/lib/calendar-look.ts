import type { CSSProperties } from "react";

/*
 * How a gig looks on the staff calendar. Where the booking stands decides the look, so staff can
 * tell at a glance what still needs chasing: yellow is pending, brown is waiting on the act, a solid
 * block in the venue's (or act's) colour is booked. Anything not yet booked has a dashed edge, so
 * colour is never the only clue. The colours themselves live in globals.css (.gig-*), because dark
 * mode needs its own shades.
 */

export type GigTone = "pending" | "awaiting" | "quiet" | "on" | "cancelled";

const DARK_TEXT = "#15181c";
const LIGHT_TEXT = "#ffffff";

/** Which look a booking gets. A booking with no act yet is pending whatever it says, since it can't go ahead. */
export function gigTone(status: string, hasAct = true): GigTone {
  if (status === "CANCELLED") return "cancelled";
  // An enquiry is a customer asking, not a booking: grey, with or without an act.
  if (status === "ENQUIRY") return "quiet";
  if (!hasAct) return "pending";
  if (status === "CONFIRMED" || status === "SETTLED") return "on";
  if (status === "AWAITING") return "awaiting";
  // Held dates are pencilled in, not booked: grey like an enquiry.
  if (status === "HOLD") return "quiet";
  return "pending";
}

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two #rrggbb colours. */
export function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** White or near-black, whichever reads better on a solid block of this colour. */
export function textOn(colour: string) {
  if (!/^#[0-9a-f]{6}$/i.test(colour)) return LIGHT_TEXT;
  return contrast(colour, LIGHT_TEXT) >= contrast(colour, DARK_TEXT) ? LIGHT_TEXT : DARK_TEXT;
}

/** The class and inline style for a gig chip: `colour` is the venue's or act's, used once the gig is booked. */
export function gigLook(status: string, colour: string, hasAct = true): { tone: GigTone; className: string; style?: CSSProperties } {
  const tone = gigTone(status, hasAct);
  if (tone !== "on") return { tone, className: `gig gig-${tone}` };
  return {
    tone,
    className: "gig gig-on",
    style: { "--gig": colour, "--gig-ink": textOn(colour) } as CSSProperties,
  };
}

/** The colour key shown by the view switcher, in the order a booking usually moves through. */
export const GIG_KEY: { tone: GigTone; label: string }[] = [
  { tone: "quiet", label: "Enquiry or on hold" },
  { tone: "pending", label: "Pending" },
  { tone: "awaiting", label: "Awaiting confirmation" },
  { tone: "on", label: "Confirmed" },
];

/** Which gigs a busy day shows first in the month view: the ones that still need something doing. */
export const TONE_ATTENTION: Record<GigTone, number> = {
  pending: 0,
  awaiting: 1,
  quiet: 2,
  on: 3,
  cancelled: 4,
};

const TONE_COUNT_LABEL: Record<GigTone, [string, string]> = {
  pending: ["pending", "pending"],
  awaiting: ["waiting", "waiting"],
  quiet: ["on hold or enquiry", "on hold or enquiries"],
  on: ["confirmed", "confirmed"],
  cancelled: ["cancelled", "cancelled"],
};

/** A busy day's gigs counted by look, most urgent first: e.g. [{ tone: "pending", n: 3, label: "3 pending" }, …]. */
export function daySummary(tones: GigTone[]) {
  const counts = new Map<GigTone, number>();
  for (const t of tones) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts]
    .sort((a, b) => TONE_ATTENTION[a[0]] - TONE_ATTENTION[b[0]])
    .map(([tone, n]) => ({
      tone,
      n,
      label: `${n} ${TONE_COUNT_LABEL[tone][n === 1 ? 0 : 1]}`,
    }));
}

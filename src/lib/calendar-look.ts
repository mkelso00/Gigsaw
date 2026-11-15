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
  return { tone, className: "gig gig-on", style: { "--gig": colour, "--gig-ink": textOn(colour) } as CSSProperties };
}

/** The colour key shown by the view switcher, in the order a booking usually moves through. */
export const GIG_KEY: { tone: GigTone; label: string }[] = [
  { tone: "quiet", label: "Enquiry or on hold" },
  { tone: "pending", label: "Pending" },
  { tone: "awaiting", label: "Awaiting confirmation" },
  { tone: "on", label: "Confirmed" },
];

// How a business's emails look: header and accent colours, the website and phone in the footer, and the
// enquiry reply's "What happens next" steps. Stored in Settings.emailDesign; the logo is in BrandLogo.
// Pure, so the settings page can preview it as you change it.

export type EmailDesign = {
  /** The header band behind the logo or name. */
  header: string;
  /** Buttons, step numbers and the tint behind the enquiry summary. */
  accent: string;
  /** Shown in the footer, and the enquiry reply's button goes here. */
  website: string;
  phone: string;
  /** The enquiry reply's button, e.g. "See our acts". Empty: no button. */
  buttonLabel: string;
  /** The enquiry reply's "What happens next", one step each. Empty: the section is left out. */
  steps: string[];
};

/** What the rendered email needs: the design, plus the logo's address when there is one. */
export type EmailLook = Pick<EmailDesign, "header" | "accent"> & {
  logoUrl?: string;
  /** Footer lines under the business name: email, phone, website. */
  contact?: string[];
};

export const DEFAULT_STEPS = [
  "We check which of our acts are free on your date.",
  "We send you two or three that fit, with prices and videos.",
  "You choose, sign online and you're booked.",
];

export const DEFAULT_DESIGN: EmailDesign = {
  header: "#15181c",
  accent: "#22c7a6",
  website: "",
  phone: "",
  buttonLabel: "See our acts",
  steps: DEFAULT_STEPS,
};

/** Ready-made pairs for the settings page, header then accent. */
export const DESIGN_PRESETS: { name: string; header: string; accent: string }[] = [
  { name: "Gigsaw", header: "#15181c", accent: "#22c7a6" },
  { name: "Black and gold", header: "#15120f", accent: "#c9a25b" },
  { name: "Navy", header: "#14213d", accent: "#fca311" },
  { name: "Forest", header: "#1f3b2d", accent: "#d4a373" },
  { name: "Wine", header: "#4a1525", accent: "#e8b4b8" },
  { name: "Light", header: "#f4f1ea", accent: "#15181c" },
];

const HEX = /^#[0-9a-f]{6}$/i;
const MAX_STEPS = 5;

export function isHexColour(s: unknown): s is string {
  return typeof s === "string" && HEX.test(s);
}

/** A website as typed ("glazedigital.com") made into a link, or "" if it isn't one. */
export function websiteUrl(raw: string) {
  const s = raw.trim();
  if (!s || s.length > 200 || /\s/.test(s)) return "";
  const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withScheme);
    return u.hostname.includes(".") ? u.toString().replace(/\/$/, "") : "";
  } catch {
    return "";
  }
}

/** The stored design with anything missing or broken filled in from the defaults. */
export function readEmailDesign(raw: unknown): EmailDesign {
  const r = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
  const steps = Array.isArray(r.steps)
    ? r.steps
        .map((s) => text(s, 160))
        .filter(Boolean)
        .slice(0, MAX_STEPS)
    : DEFAULT_STEPS;
  return {
    header: isHexColour(r.header) ? r.header.toLowerCase() : DEFAULT_DESIGN.header,
    accent: isHexColour(r.accent) ? r.accent.toLowerCase() : DEFAULT_DESIGN.accent,
    website: websiteUrl(text(r.website, 200)),
    phone: text(r.phone, 40),
    buttonLabel: typeof r.buttonLabel === "string" ? text(r.buttonLabel, 40) : DEFAULT_DESIGN.buttonLabel,
    steps,
  };
}

/** Steps as typed in the settings box, one a line. */
export function parseSteps(raw: string) {
  return raw
    .split(/\r?\n/)
    .map((s) =>
      s
        .replace(/^\s*(\d+[.)]|[-•*])\s*/, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 160),
    )
    .filter(Boolean)
    .slice(0, MAX_STEPS);
}

/** The footer contact lines: the business email, phone and website (as "glazedigital.com"). */
export function contactLines(d: Pick<EmailDesign, "phone" | "website">, email: string) {
  return [email.trim(), d.phone, d.website.replace(/^https?:\/\/(www\.)?/i, "")].filter(Boolean);
}

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** White or near-black, whichever reads better on this colour. */
export function inkOn(hex: string) {
  if (!HEX.test(hex)) return "#ffffff";
  const l = luminance(hex);
  const onWhite = 1.05 / (l + 0.05);
  const onDark = (l + 0.05) / (luminance("#15181c") + 0.05);
  return onWhite >= onDark ? "#ffffff" : "#15181c";
}

/** The colour mixed with white, e.g. a pale tint of the accent for a background. */
export function tint(hex: string, amount: number) {
  if (!HEX.test(hex)) return "#f4f6f7";
  const mix = (i: number) =>
    Math.round(parseInt(hex.slice(i, i + 2), 16) * amount + 255 * (1 - amount))
      .toString(16)
      .padStart(2, "0");
  return `#${mix(1)}${mix(3)}${mix(5)}`;
}

/** A colour dark enough to read as text on white: the accent itself, or near-black if it's too pale. */
export function readableOnWhite(hex: string) {
  if (!HEX.test(hex)) return "#15181c";
  return 1.05 / (luminance(hex) + 0.05) >= 3 ? hex : "#15181c";
}

/** Whether a colour shows up as a button on a white page. Only near-white ones don't; the text on it is chosen to read either way. */
export function showsOnWhite(hex: string) {
  return HEX.test(hex) && 1.05 / (luminance(hex) + 0.05) >= 1.4;
}

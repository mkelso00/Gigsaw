import { DEFAULT_DESIGN, inkOn, readableOnWhite, showsOnWhite, tint, type EmailLook } from "./email-design";

// Pure helpers for outgoing messages (kept separate so they can be unit tested).

/**
 * Turn a phone number into international format for texting. Numbers starting with 0 are
 * treated as UK numbers. Returns null if it doesn't look like a phone number.
 */
export function normalisePhone(raw: string, defaultCountryCode = "44"): string | null {
  let s = raw.replace(/[\s\-().]/g, "");
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  else if (s.startsWith("0")) s = `+${defaultCountryCode}${s.slice(1)}`;
  return /^\+\d{8,15}$/.test(s) ? s : null;
}

// Pages opened by a secret link: the part after the prefix is the key, e.g. /reset-password/<token>.
const SECRET_LINK = /(https?:\/\/[^\s/?#<>"']+)?\/(reset-password|o|c|pay|w|f|join|v|q)\/[^\s/?#<>"'),\]]+/g;

/**
 * Hide the key in secret links before a message is saved, so the message log can't be used to
 * open someone's offer, contract, payment or password reset. The page prefix stays, so staff
 * can still see which link was sent: https://gigsaw.live/o/abc123 becomes https://gigsaw.live/o/…
 */
export function redactLinks(text: string): string {
  return text.replace(SECRET_LINK, (match, host: string | undefined, prefix: string, at: number) => {
    // A path on its own only counts at the start of a word, not inside another path.
    if (!host && at > 0 && !/[\s(<"'[]/.test(text[at - 1])) return match;
    return `${host ?? ""}/${prefix}/…`;
  });
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The content of a branded email. Everything except title is optional. */
export type EmailContent = {
  /** The business's colours, logo and contact lines (Settings → Email design). Gigsaw's look when not given. */
  look?: EmailLook;
  /** A heading over the rows, which then sit in a tinted card, e.g. "Your enquiry". */
  rowsTitle?: string;
  /** Numbered steps under a heading, e.g. the enquiry reply's "What happens next". */
  steps?: { title: string; items: string[] };
  /** Shown in the header, e.g. the agency's name. Defaults to Gigsaw. */
  brand?: string;
  /** Short line shown in inbox previews. */
  preheader?: string;
  title: string;
  intro?: string;
  /** A big status line, e.g. "Arrived at 18:42". */
  highlight?: { label: string; value: string; tone?: "good" | "warn" | "bad" };
  /** Label / value details, e.g. venue, date, times. */
  rows?: [string, string][];
  /** What changed: label, old value, new value. */
  changes?: [string, string, string][];
  cta?: { label: string; url: string };
  outro?: string;
  footnote?: string;
};

const esc = escapeHtml;
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/** Render a branded HTML email plus a plain-text version for clients that need it. */
export function renderEmail(c: EmailContent): { html: string; text: string } {
  const brand = c.brand?.trim() || "Gigsaw";
  const look = c.look;
  const header = look?.header ?? DEFAULT_DESIGN.header;
  const accent = look?.accent ?? DEFAULT_DESIGN.accent;
  const headerInk = inkOn(header);
  const accentInk = inkOn(accent);
  // Buttons in the accent colour, unless it's so pale it would vanish on the white page.
  const button = look && showsOnWhite(accent) ? accent : "#15181c";
  const buttonInk = look ? inkOn(button) : "#ffffff";
  const para = (s: string, style = "") =>
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#363c43;${style}">${esc(s).replace(/\n/g, "<br>")}</p>`;
  const tones = { good: ["#ecfdf5", "#065f46"], warn: ["#fffbeb", "#92400e"], bad: ["#fff1f2", "#9f1239"] };
  const [hlBg, hlFg] = tones[c.highlight?.tone ?? "good"];

  const rowCells = (k: string, v: string, i: number, line: string) =>
    `<tr><td style="padding:10px 0;${i || !c.rowsTitle ? `border-top:1px solid ${line};` : ""}font-size:13px;color:#67707a;width:38%;vertical-align:top">${esc(k)}</td><td style="padding:10px 0;${i || !c.rowsTitle ? `border-top:1px solid ${line};` : ""}font-size:14px;color:#15181c;vertical-align:top">${esc(v).replace(/\n/g, "<br>")}</td></tr>`;
  const rowsTable = (line: string) =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${(c.rows ?? []).map(([k, v], i) => rowCells(k, v, i, line)).join("")}</table>`;
  const rows = !c.rows?.length
    ? ""
    : c.rowsTitle
      ? `<div style="margin:8px 0 24px;padding:18px 20px 8px;border-radius:14px;background:${tint(accent, 0.1)};border:1px solid ${tint(accent, 0.28)}"><div style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${readableOnWhite(accent)}">${esc(c.rowsTitle)}</div>${rowsTable(tint(accent, 0.28))}</div>`
      : `<div style="margin:8px 0 20px">${rowsTable("#e3e6e9")}</div>`;

  const steps = c.steps?.items.length
    ? `<div style="margin:4px 0 24px"><div style="margin:0 0 14px;font-size:17px;font-weight:600;color:#15181c">${esc(c.steps.title)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${c.steps.items
        .map(
          (s, i) =>
            `<tr><td style="width:40px;padding:0 0 14px;vertical-align:top"><div style="width:28px;height:28px;border-radius:14px;background:${accent};color:${accentInk};font-size:14px;font-weight:700;line-height:28px;text-align:center">${i + 1}</div></td><td style="padding:4px 0 14px;font-size:15px;line-height:1.5;color:#363c43;vertical-align:top">${esc(s)}</td></tr>`,
        )
        .join("")}</table></div>`
    : "";

  const changes = c.changes?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 20px;border-collapse:collapse">${c.changes
        .map(
          ([k, from, to]) =>
            `<tr><td style="padding:12px 0;border-top:1px solid #e3e6e9;font-size:13px;color:#67707a;width:30%;vertical-align:top">${esc(k)}</td><td style="padding:12px 0;border-top:1px solid #e3e6e9;font-size:14px;vertical-align:top"><span style="color:#8d949c;text-decoration:line-through">${esc(from || "none")}</span>&nbsp;&nbsp;→&nbsp;&nbsp;<strong style="color:#15181c;background:${look ? tint(accent, 0.3) : "#a9ebdc"};padding:2px 6px;border-radius:4px">${esc(to || "none")}</strong></td></tr>`,
        )
        .join("")}</table>`
    : "";

  const highlight = c.highlight
    ? `<div style="margin:4px 0 20px;padding:16px 18px;border-radius:12px;background:${hlBg}"><div style="font-size:12px;color:${hlFg};opacity:.8">${esc(c.highlight.label)}</div><div style="margin-top:4px;font-size:22px;font-weight:600;color:${hlFg}">${esc(c.highlight.value)}</div></div>`
    : "";

  const cta = c.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px"><tr><td style="border-radius:10px;background:${button}"><a href="${esc(c.cta.url)}" style="display:inline-block;padding:14px 24px;font-size:15px;font-weight:600;color:${buttonInk};text-decoration:none;font-family:${FONT}">${esc(c.cta.label)}</a></td></tr></table>`
    : "";

  // The header: the business's logo when it has one, otherwise its initial in a badge and its name.
  const masthead = look?.logoUrl
    ? `<img src="${esc(look.logoUrl)}" alt="${esc(brand)}" height="44" style="display:block;height:44px;max-width:240px;width:auto;border:0;outline:none">`
    : `<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="width:28px;height:28px;background:${accent};border-radius:8px;text-align:center;font-size:16px;font-weight:700;color:${accentInk};line-height:28px">${esc(brand.charAt(0).toUpperCase())}</td>
<td style="padding-left:12px;font-size:16px;font-weight:600;color:${headerInk};letter-spacing:-0.01em">${esc(brand)}</td>
</tr></table>`;
  const contact = look?.contact?.length
    ? `<div style="margin-bottom:6px;font-size:13px;color:#4f5761"><strong style="color:#15181c">${esc(brand)}</strong><br>${look.contact.map(esc).join("&nbsp;&nbsp;·&nbsp;&nbsp;")}</div>`
    : "";

  const html = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(c.title)}</title></head>
<body style="margin:0;padding:0;background:#eef0f2;font-family:${FONT}">
${c.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(c.preheader)}</div>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef0f2"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td style="background:${header};border-radius:16px 16px 0 0;padding:${look?.logoUrl ? "22px 28px" : "20px 28px"}">${masthead}</td></tr>
${look ? `<tr><td style="height:4px;line-height:4px;font-size:0;background:${accent}">&nbsp;</td></tr>` : ""}
<tr><td style="background:#ffffff;padding:32px 28px 12px;border-radius:0 0 16px 16px">
<h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;font-weight:600;letter-spacing:-0.02em;color:#15181c">${esc(c.title)}</h1>
${c.intro ? para(c.intro) : ""}${highlight}${changes}${rows}${steps}${cta}${c.outro ? para(c.outro) : ""}
</td></tr>
<tr><td style="padding:20px 28px;font-size:12px;line-height:1.6;color:#8d949c;text-align:center">${contact}${c.footnote ? `${esc(c.footnote)}<br>` : ""}Sent with Gigsaw${brand !== "Gigsaw" ? ` for ${esc(brand)}` : ""}</td></tr>
</table></td></tr></table></body></html>`;

  const text = [
    c.title,
    c.intro,
    c.highlight ? `${c.highlight.label}: ${c.highlight.value}` : "",
    c.changes?.map(([k, from, to]) => `${k}: ${from || "none"} → ${to || "none"}`).join("\n"),
    c.rows?.length ? [c.rowsTitle, ...c.rows.map(([k, v]) => `${k}: ${v}`)].filter(Boolean).join("\n") : "",
    c.steps?.items.length ? [c.steps.title, ...c.steps.items.map((s, i) => `${i + 1}. ${s}`)].join("\n") : "",
    c.cta ? `${c.cta.label}: ${c.cta.url}` : "",
    c.outro,
    look?.contact?.length ? [brand, ...look.contact].join("\n") : "",
    c.footnote,
    `Sent with Gigsaw${brand !== "Gigsaw" ? ` for ${brand}` : ""}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  return { html, text };
}

/**
 * The From line for an email sent on behalf of a business: its name with Gigsaw's verified
 * sending address, e.g. `"Suave Agency" <alerts@send.gigsaw.live>`. The name is cleaned so it
 * can't break the header (no quotes, angle brackets or line breaks) and kept to 60 characters.
 * With no usable name or address, the configured MAIL_FROM is used as it is.
 */
export function fromWithName(mailFrom: string, address: string | null, name: string | null | undefined) {
  const clean = (name ?? "")
    .replace(/[\r\n\t"<>\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60)
    .trim();
  return clean && address ? `"${clean}" <${address}>` : mailFrom;
}

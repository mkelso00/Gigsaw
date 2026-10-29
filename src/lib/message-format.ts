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

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The content of a branded email. Everything except title is optional. */
export type EmailContent = {
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
  const para = (s: string, style = "") =>
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#3b3a36;${style}">${esc(s).replace(/\n/g, "<br>")}</p>`;
  const tones = { good: ["#ecfdf5", "#065f46"], warn: ["#fffbeb", "#92400e"], bad: ["#fff1f2", "#9f1239"] };
  const [hlBg, hlFg] = tones[c.highlight?.tone ?? "good"];

  const rows = c.rows?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 20px;border-collapse:collapse">${c.rows
        .map(
          ([k, v]) =>
            `<tr><td style="padding:10px 0;border-top:1px solid #efefea;font-size:13px;color:#75746d;width:38%;vertical-align:top">${esc(k)}</td><td style="padding:10px 0;border-top:1px solid #efefea;font-size:14px;color:#0d0d0c;vertical-align:top">${esc(v).replace(/\n/g, "<br>")}</td></tr>`,
        )
        .join("")}</table>`
    : "";

  const changes = c.changes?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 20px;border-collapse:collapse">${c.changes
        .map(
          ([k, from, to]) =>
            `<tr><td style="padding:12px 0;border-top:1px solid #efefea;font-size:13px;color:#75746d;width:30%;vertical-align:top">${esc(k)}</td><td style="padding:12px 0;border-top:1px solid #efefea;font-size:14px;vertical-align:top"><span style="color:#a2a199;text-decoration:line-through">${esc(from || "none")}</span>&nbsp;&nbsp;→&nbsp;&nbsp;<strong style="color:#0d0d0c;background:#ebff9e;padding:2px 6px;border-radius:4px">${esc(to || "none")}</strong></td></tr>`,
        )
        .join("")}</table>`
    : "";

  const highlight = c.highlight
    ? `<div style="margin:4px 0 20px;padding:16px 18px;border-radius:12px;background:${hlBg}"><div style="font-size:12px;color:${hlFg};opacity:.8">${esc(c.highlight.label)}</div><div style="margin-top:4px;font-size:22px;font-weight:600;color:${hlFg}">${esc(c.highlight.value)}</div></div>`
    : "";

  const cta = c.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px"><tr><td style="border-radius:10px;background:#0d0d0c"><a href="${esc(c.cta.url)}" style="display:inline-block;padding:13px 22px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;font-family:${FONT}">${esc(c.cta.label)}</a></td></tr></table>`
    : "";

  const html = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(c.title)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f0;font-family:${FONT}">
${c.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(c.preheader)}</div>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td style="background:#0d0d0c;border-radius:16px 16px 0 0;padding:20px 28px">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="width:28px;height:28px;background:#cdf72e;border-radius:8px;text-align:center;font-size:16px;font-weight:700;color:#0d0d0c;line-height:28px">${esc(brand.charAt(0).toUpperCase())}</td>
<td style="padding-left:12px;font-size:16px;font-weight:600;color:#ffffff;letter-spacing:-0.01em">${esc(brand)}</td>
</tr></table></td></tr>
<tr><td style="background:#ffffff;padding:32px 28px 12px;border-radius:0 0 16px 16px">
<h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;font-weight:600;letter-spacing:-0.02em;color:#0d0d0c">${esc(c.title)}</h1>
${c.intro ? para(c.intro) : ""}${highlight}${changes}${rows}${cta}${c.outro ? para(c.outro) : ""}
</td></tr>
<tr><td style="padding:20px 28px;font-size:12px;line-height:1.6;color:#a2a199;text-align:center">${c.footnote ? `${esc(c.footnote)}<br>` : ""}Sent with Gigsaw${brand !== "Gigsaw" ? ` for ${esc(brand)}` : ""}</td></tr>
</table></td></tr></table></body></html>`;

  const text = [
    c.title,
    c.intro,
    c.highlight ? `${c.highlight.label}: ${c.highlight.value}` : "",
    c.changes?.map(([k, from, to]) => `${k}: ${from || "none"} → ${to || "none"}`).join("\n"),
    c.rows?.map(([k, v]) => `${k}: ${v}`).join("\n"),
    c.cta ? `${c.cta.label}: ${c.cta.url}` : "",
    c.outro,
    c.footnote,
    `Sent with Gigsaw${brand !== "Gigsaw" ? ` for ${brand}` : ""}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  return { html, text };
}

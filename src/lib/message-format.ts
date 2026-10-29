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

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A plain, readable HTML version of a text email, with links made clickable. */
export function textToHtml(text: string) {
  const body = escapeHtml(text)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#111">$1</a>')
    .replace(/\n/g, "<br>");
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#111;max-width:560px">${body}<p style="margin-top:28px;color:#888;font-size:12px">Sent by Gigsaw</p></div>`;
}

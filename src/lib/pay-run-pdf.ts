import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { formatSortCode, maskAccount } from "./act-invoice-rules";
import { formatMoney } from "./money";
import { formatDate } from "./time";

// The week's self-billing invoices as one PDF, one A4 page each, for the business's records (sent by the weekly
// pay run, src/lib/pay-run-server.ts). Each page says what the printed invoice says (src/app/print/act-invoices),
// laid out the same way: the payee as the supplier at the top, the business as the customer, the line, VAT and
// total, then paid or void and the bank account it's paid to. The account number is masked (••••5678), as the
// PDF goes by email. Built with pdf-lib and the standard Helvetica fonts, so nothing needs a browser.

export type PdfInvoice = {
  id: string;
  number: string;
  status: string;
  currency: string;
  netMinor: number;
  vatPct: number;
  vatMinor: number;
  totalMinor: number;
  issuedAt: Date;
  paidAt: Date | null;
  voidedAt: Date | null;
  note: string;
  bookingRef: string;
  description: string;
  gigDate: Date;
  actName: string;
  payeeName: string;
  actAddress: string;
  actVatNumber: string;
  bankAccountName: string;
  bankSortCode: string;
  bankAccountNumber: string;
};

export type PdfBusiness = { agencyName: string; agencyAddress: string; defaultTimezone: string };

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 56;
const INK = rgb(0.06, 0.07, 0.09);
const MUTED = rgb(0.39, 0.45, 0.53);
const RULE = rgb(0.8, 0.84, 0.88);
const ROSE = rgb(0.62, 0.07, 0.22);
const GREEN = rgb(0.02, 0.47, 0.34);

type Fonts = { regular: PDFFont; bold: PDFFont; chars: Set<number> };

/** Text the standard fonts can draw: accents kept where they can be, anything else (emoji, other alphabets) as "?". */
function drawable(text: string, fonts: Fonts) {
  let out = "";
  for (const ch of text.replace(/\r/g, "")) {
    const code = ch.codePointAt(0)!;
    if (ch === "\n" || fonts.chars.has(code)) out += ch;
    else if (ch === "’" || ch === "‘") out += "'";
    else if (ch === "–" || ch === "—") out += "-";
    else {
      const plain = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
      out += plain && [...plain].every((c) => fonts.chars.has(c.codePointAt(0)!)) ? plain : "?";
    }
  }
  return out;
}

/** Split text into lines no wider than `width`, keeping line breaks already in it. */
function wrap(text: string, font: PDFFont, size: number, width: number) {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width || !line) line = next;
      else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

/** One page's writer: text from the top down, left or right aligned. */
function writer(page: PDFPage, fonts: Fonts) {
  const [w] = A4;
  let y = A4[1] - MARGIN;
  const text = (s: string, o: { x?: number; right?: number; size?: number; bold?: boolean; colour?: ReturnType<typeof rgb>; at?: number } = {}) => {
    const font = o.bold ? fonts.bold : fonts.regular;
    const size = o.size ?? 10;
    const t = drawable(s, fonts);
    const x = o.right !== undefined ? o.right - font.widthOfTextAtSize(t, size) : (o.x ?? MARGIN);
    page.drawText(t, { x, y: o.at ?? y, size, font, color: o.colour ?? INK });
  };
  const lines = (s: string, o: { x?: number; width?: number; size?: number; bold?: boolean; colour?: ReturnType<typeof rgb>; gap?: number } = {}) => {
    const size = o.size ?? 10;
    const font = o.bold ? fonts.bold : fonts.regular;
    for (const l of wrap(drawable(s, fonts), font, size, o.width ?? w - 2 * MARGIN)) {
      text(l, { ...o, size });
      y -= o.gap ?? size * 1.45;
    }
  };
  const rule = (thick = 0.75, colour = RULE) => {
    page.drawLine({ start: { x: MARGIN, y }, end: { x: w - MARGIN, y }, thickness: thick, color: colour });
  };
  return {
    text,
    lines,
    rule,
    down: (by: number) => (y -= by),
    get y() {
      return y;
    },
    set y(v: number) {
      y = v;
    },
  };
}

function drawInvoice(doc: PDFDocument, inv: PdfInvoice, biz: PdfBusiness, fonts: Fonts) {
  const page = doc.addPage(A4);
  const w = writer(page, fonts);
  const right = A4[0] - MARGIN;
  const tz = biz.defaultTimezone;
  const money = (m: number) => formatMoney(m, inv.currency);
  const payee = inv.payeeName || inv.actName;
  const hasVat = inv.vatMinor > 0;

  // Letterhead: the payee is the supplier on a self-billing invoice.
  const top = w.y;
  w.text("SELF-BILLING INVOICE", { right, size: 13, bold: true, colour: rgb(0.1, 0.32, 0.6), at: top - 4 });
  w.text(inv.number, { right, size: 10, colour: MUTED, at: top - 20 });
  w.lines(payee, { size: 18, bold: true, width: 300, gap: 22 });
  const letterhead = [inv.actAddress, inv.actVatNumber ? `VAT number ${inv.actVatNumber}` : ""].filter(Boolean).join("\n");
  if (letterhead) w.lines(letterhead, { size: 9.5, colour: MUTED, width: 300 });
  w.y = Math.min(w.y, top - 40) - 10;
  w.rule();
  w.down(24);

  // Customer (the business) on the left, dates and booking on the right.
  const blockTop = w.y;
  w.text("Customer", { size: 9.5, colour: MUTED });
  w.down(14);
  w.lines(biz.agencyName, { bold: true, width: 260 });
  if (biz.agencyAddress) w.lines(biz.agencyAddress, { width: 260 });
  const leftEnd = w.y;
  const details: [string, string][] = [
    ["Invoice date", formatDate(inv.issuedAt, tz)],
    ["Date of performance", formatDate(inv.gigDate, tz)],
    ["Booking", inv.bookingRef],
    ...(payee !== inv.actName ? ([["Act", inv.actName]] as [string, string][]) : []),
  ];
  let ry = blockTop;
  for (const [label, value] of details) {
    const v = drawable(value, fonts);
    const vw = fonts.regular.widthOfTextAtSize(v, 10);
    w.text(v, { right, at: ry });
    w.text(label, { right: right - vw - 6, at: ry, colour: MUTED });
    ry -= 14.5;
  }
  w.y = Math.min(leftEnd, ry) - 18;

  // The line, then the sums.
  w.text("Description", { bold: true, size: 9.5 });
  w.text("Amount", { right, bold: true, size: 9.5 });
  w.down(7);
  w.rule(1.5, rgb(0.8, 0.84, 0.88));
  w.down(16);
  const lineTop = w.y;
  w.lines(inv.description, { width: right - MARGIN - 100 });
  w.text(money(inv.netMinor), { right, at: lineTop });
  w.down(4);
  if (hasVat) {
    w.rule();
    w.down(18);
  }
  const sum = (label: string, value: string, o: { bold?: boolean; size?: number } = {}) => {
    const v = drawable(value, fonts);
    w.text(v, { right, ...o });
    w.text(label, { right: right - 110, colour: o.bold ? INK : MUTED, ...o });
    w.down((o.size ?? 10) * 1.7);
  };
  if (hasVat) {
    sum("Subtotal", money(inv.netMinor));
    sum(`VAT at ${inv.vatPct}%`, money(inv.vatMinor));
  }
  w.down(2);
  w.rule(1.5, rgb(0.8, 0.84, 0.88));
  w.down(18);
  sum("Total", money(inv.totalMinor), { bold: true, size: 13 });
  w.down(14);

  // Notes, as on the printed invoice.
  if (inv.status === "VOID") {
    w.lines(`Void${inv.voidedAt ? ` since ${formatDate(inv.voidedAt, tz)}` : ""}. Nothing is owed on this invoice.${inv.note ? ` ${inv.note}.` : ""}`, {
      bold: true,
      colour: ROSE,
    });
    w.down(6);
  }
  if (inv.status === "PAID" && inv.paidAt) {
    w.lines(`Paid ${formatDate(inv.paidAt, tz)}.`, { bold: true, colour: GREEN });
    w.down(6);
  }
  if (inv.status !== "VOID" && inv.note) {
    w.lines(`${inv.note}.`, { colour: MUTED });
    w.down(6);
  }
  const bank = [
    inv.bankAccountName,
    inv.bankSortCode && `Sort code ${formatSortCode(inv.bankSortCode)}`,
    inv.bankAccountNumber && `Account ${maskAccount(inv.bankAccountNumber)}`,
  ].filter(Boolean);
  if (bank.length) {
    w.text("Paid to", { size: 9.5, colour: MUTED });
    w.down(14);
    for (const l of bank) w.lines(l);
    w.down(8);
  }
  w.lines(
    `Self-billing invoice, made out by ${biz.agencyName} on behalf of ${payee}.${
      hasVat ? " The VAT shown is your output tax due to HMRC." : ` No VAT is charged: ${payee} isn't registered for VAT.`
    }`,
    { colour: MUTED, size: 9.5 },
  );
}

/** One PDF with a page for each invoice, in number order. */
export async function invoicesPdf(invoices: PdfInvoice[], biz: PdfBusiness): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Self-billing invoices: ${biz.agencyName}`);
  doc.setCreator("Gigsaw");
  doc.setProducer("Gigsaw");
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fonts: Fonts = { regular, bold, chars: new Set([...regular.getCharacterSet(), ...bold.getCharacterSet()]) };
  for (const inv of [...invoices].sort((a, b) => a.number.localeCompare(b.number, "en", { numeric: true }))) drawInvoice(doc, inv, biz, fonts);
  if (!invoices.length) doc.addPage(A4);
  return doc.save();
}

// The weekly pay run's payment list as a bank's bulk-payment upload file, kept pure (no database) so it's unit
// tested in tests/bank-file.test.ts. A business picks its bank (a preset) or builds its own layout (Custom) on the
// pay run page; the choice is kept in Settings.bankFile.
//
// Presets: only Generic (Gigsaw's own plain layout) is ours to vouch for. Monzo Business's column order is the one
// its help centre gives; the rest are our best-known layouts, which banks change, so the page says "Check against
// your bank's template" for every preset with `confirmed: false`. Custom covers any bank that differs.
//
// UK bank rules on every file: a sort code is 6 digits; an account number is 8 digits (6 or 7 are padded with
// zeros in front, as banks do); references and names keep only the characters UK payment schemes take (letters,
// numbers, space and - . / &) and are cut to the template's length (18 for references; 18 for names in Bacs-style
// files, 40 otherwise). A payee whose sort code or account number isn't right is left out of the file and listed
// on the page as "Fix before paying".

import { minorToInput } from "./money";

export const BANK_FIELDS = [
  "payee_name",
  "account_name",
  "sort_code",
  "sort_code_dashes",
  "account_number",
  "amount",
  "amount_pence",
  "reference",
  "payment_date",
  "email",
] as const;
export type BankField = (typeof BANK_FIELDS)[number];

/** What each column holds, as the builder lists them. */
export const BANK_FIELD_LABELS: Record<BankField, string> = {
  payee_name: "Payee name",
  account_name: "Account name",
  sort_code: "Sort code (123456)",
  sort_code_dashes: "Sort code with dashes (12-34-56)",
  account_number: "Account number",
  amount: "Amount in pounds (1250.00)",
  amount_pence: "Amount in pence (125000)",
  reference: "Reference",
  payment_date: "Payment date",
  email: "Payee's email",
};

/** A column's heading when the business doesn't name it. */
export function defaultHeader(f: BankField) {
  return { sort_code_dashes: "Sort code", amount_pence: "Amount", email: "Email" }[f as string] ?? BANK_FIELD_LABELS[f].replace(/ \(.*\)$/, "");
}

/** How many columns the custom builder offers. */
export const CUSTOM_MAX_COLUMNS = 10;

export const DATE_FORMATS = ["DD/MM/YYYY", "YYYY-MM-DD", "DD-MM-YYYY", "DDMMYYYY"] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

/** A column: one of the fields above, or (presets only) a fixed value such as a currency. */
export type BankColumn = { field: BankField; header: string } | { field: "fixed"; header: string; value: string };

export type BankTemplate = {
  columns: BankColumn[];
  header: boolean;
  separator: "," | ";";
  dateFormat: DateFormat;
  referenceMax: number;
  nameMax: number;
  extension: "csv" | "txt";
};

export const REFERENCE_DEFAULT = 18;
export const NAME_BACS = 18;
export const NAME_DEFAULT = 40;

const base: Omit<BankTemplate, "columns"> = {
  header: true,
  separator: ",",
  dateFormat: "DD/MM/YYYY",
  referenceMax: REFERENCE_DEFAULT,
  nameMax: NAME_DEFAULT,
  extension: "csv",
};
const col = (field: BankField, header: string): BankColumn => ({ field, header });

export const BANK_PRESETS = ["GENERIC", "STARLING", "TIDE", "REVOLUT", "MONZO", "BANKLINE", "LLOYDS", "BARCLAYS", "HSBC", "CUSTOM"] as const;
export type BankPreset = (typeof BANK_PRESETS)[number];

export type PresetDef = { label: string; confirmed: boolean; note: string; template: BankTemplate | null };

export const PRESETS: Record<BankPreset, PresetDef> = {
  GENERIC: {
    label: "Generic CSV",
    confirmed: true,
    note: "Name, sort code, account number, amount and reference, with a header row. Most UK business banks can map these columns.",
    template: {
      ...base,
      columns: [
        col("account_name", "Name"),
        col("sort_code", "Sort code"),
        col("account_number", "Account number"),
        col("amount", "Amount"),
        col("reference", "Reference"),
      ],
    },
  },
  STARLING: {
    label: "Starling",
    confirmed: false,
    note: "Starling's bulk payments take a CSV from its own template (Faster Payments only, up to 250 a month).",
    template: {
      ...base,
      columns: [
        col("account_name", "Name"),
        col("sort_code", "Sort Code"),
        col("account_number", "Account Number"),
        col("reference", "Reference"),
        col("amount", "Amount"),
      ],
    },
  },
  TIDE: {
    label: "Tide",
    confirmed: false,
    note: "Tide's bulk payment upload layout couldn't be confirmed.",
    template: {
      ...base,
      columns: [
        col("account_name", "Name"),
        col("sort_code", "Sort code"),
        col("account_number", "Account number"),
        col("amount", "Amount"),
        col("reference", "Reference"),
      ],
    },
  },
  REVOLUT: {
    label: "Revolut Business",
    confirmed: false,
    note: "Revolut's bulk transfer template needs a name, recipient type, account number and sort code for GBP payments. Check the recipient type values (individual or business) against its template.",
    template: {
      ...base,
      columns: [
        col("account_name", "Name"),
        { field: "fixed", header: "Recipient type", value: "INDIVIDUAL" },
        col("account_number", "Account number"),
        col("sort_code", "Sort code"),
        { field: "fixed", header: "Recipient bank country", value: "GB" },
        { field: "fixed", header: "Currency", value: "GBP" },
        col("amount", "Amount"),
        col("reference", "Payment reference"),
      ],
    },
  },
  MONZO: {
    label: "Monzo Business",
    confirmed: false,
    note: "Columns in the order Monzo's help centre gives: payee name, sort code, account number, account type, reference, amount (up to 200 payments). Check the account type values against Monzo's template.",
    template: {
      ...base,
      columns: [
        col("account_name", "Payee name"),
        col("sort_code", "Sort code"),
        col("account_number", "Bank account number"),
        { field: "fixed", header: "Bank account type", value: "Personal" },
        col("reference", "Payment reference"),
        col("amount", "Amount"),
      ],
    },
  },
  BANKLINE: {
    label: "NatWest/RBS Bankline",
    confirmed: false,
    note: "Bankline imports its own CSV layout (with a .txt name) set out in its import file guide, and bulk payments go against a bulk list saved in Bankline. This is a plain Bacs-style list to map there.",
    template: {
      ...base,
      header: false,
      nameMax: NAME_BACS,
      extension: "txt",
      columns: [
        col("sort_code", "Sort code"),
        col("account_number", "Account number"),
        col("account_name", "Name"),
        col("amount", "Amount"),
        col("reference", "Reference"),
      ],
    },
  },
  LLOYDS: {
    label: "Lloyds",
    confirmed: false,
    note: "Lloyds' bulk payment import layout couldn't be confirmed.",
    template: {
      ...base,
      header: false,
      nameMax: NAME_BACS,
      columns: [
        col("sort_code", "Sort code"),
        col("account_number", "Account number"),
        col("account_name", "Name"),
        col("amount", "Amount"),
        col("reference", "Reference"),
      ],
    },
  },
  BARCLAYS: {
    label: "Barclays",
    confirmed: false,
    note: "Barclays' bulk payment import layout couldn't be confirmed.",
    template: {
      ...base,
      nameMax: NAME_BACS,
      columns: [
        col("account_name", "Name"),
        col("sort_code", "Sort code"),
        col("account_number", "Account number"),
        col("amount", "Amount"),
        col("reference", "Reference"),
      ],
    },
  },
  HSBC: {
    label: "HSBC",
    confirmed: false,
    note: "HSBCnet's Dynamic CSV upload needs a header row and an import profile set up by HSBC; your relationship manager has its layout.",
    template: {
      ...base,
      nameMax: NAME_BACS,
      columns: [
        col("account_name", "Beneficiary name"),
        col("sort_code", "Beneficiary sort code"),
        col("account_number", "Beneficiary account number"),
        col("amount", "Amount"),
        col("reference", "Payment reference"),
      ],
    },
  },
  CUSTOM: { label: "Custom", confirmed: false, note: "Your own layout: choose the columns, their order and headings.", template: null },
};

export type BankFileSetting = { preset: BankPreset; custom: BankTemplate };

const DEFAULT_CUSTOM = PRESETS.GENERIC.template!;

const clampInt = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};

/** The stored setting, made safe: unknown presets, fields and options fall back to the defaults. */
export function readBankFile(json: unknown): BankFileSetting {
  const o = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  const preset = (BANK_PRESETS as readonly string[]).includes(String(o.preset)) ? (o.preset as BankPreset) : "GENERIC";
  const c = o.custom && typeof o.custom === "object" ? (o.custom as Record<string, unknown>) : {};
  const columns = (Array.isArray(c.columns) ? c.columns : [])
    .flatMap((x): BankColumn[] => {
      const f = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
      if (!(BANK_FIELDS as readonly string[]).includes(String(f.field))) return [];
      return [{ field: f.field as BankField, header: String(f.header ?? "").slice(0, 60) }];
    })
    .slice(0, 12);
  return {
    preset,
    custom: {
      columns: columns.length ? columns : DEFAULT_CUSTOM.columns,
      header: c.header === undefined ? true : c.header === true,
      separator: c.separator === ";" ? ";" : ",",
      dateFormat: (DATE_FORMATS as readonly string[]).includes(String(c.dateFormat)) ? (c.dateFormat as DateFormat) : "DD/MM/YYYY",
      referenceMax: clampInt(c.referenceMax, 6, 140, REFERENCE_DEFAULT),
      nameMax: clampInt(c.nameMax, 6, 140, NAME_DEFAULT),
      extension: "csv",
    },
  };
}

/** The template a setting uses. */
export function templateOf(s: BankFileSetting): BankTemplate {
  return s.preset === "CUSTOM" ? s.custom : PRESETS[s.preset].template!;
}

// ---------------------------------------------------------------------------------------------------------
// UK bank rules
// ---------------------------------------------------------------------------------------------------------

/** "123456" from "12-34-56", or null unless it's exactly 6 digits. */
export function cleanSortCode(s: string) {
  const d = s.replace(/[\s-]/g, "");
  return /^\d{6}$/.test(d) ? d : null;
}

/** "01234567": 8 digits, a 6 or 7 digit number padded with zeros in front; null for anything else. */
export function cleanAccountNumber(s: string) {
  const d = s.replace(/[\s-]/g, "");
  return /^\d{6,8}$/.test(d) ? d.padStart(8, "0") : null;
}

/** Only letters, numbers, space and - . / &, single-spaced, cut to `max`. Accents become plain letters. */
export function bankText(s: string, max: number) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9 ./&-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
}

function formatDate(key: string, f: DateFormat) {
  const [y, m, d] = key.split("-");
  if (f === "YYYY-MM-DD") return key;
  if (f === "DD-MM-YYYY") return `${d}-${m}-${y}`;
  if (f === "DDMMYYYY") return `${d}${m}${y}`;
  return `${d}/${m}/${y}`;
}

// ---------------------------------------------------------------------------------------------------------
// The file
// ---------------------------------------------------------------------------------------------------------

/** One payment, as the pay run has it. */
export type BankPayment = {
  key: string;
  payeeName: string;
  accountName: string;
  sortCode: string;
  accountNumber: string;
  amountMinor: number;
  currency: string;
  reference: string;
  email: string;
  /** Where to fix their details. */
  artistId: string | null;
};

export type BankProblem = { key: string; payeeName: string; artistId: string | null; problems: string[] };

/** Why a payment can't go in a bank file: the sort code or account number isn't right. */
export function paymentProblems(p: Pick<BankPayment, "sortCode" | "accountNumber">) {
  const out: string[] = [];
  if (!p.sortCode.trim()) out.push("No sort code");
  else if (!cleanSortCode(p.sortCode)) out.push(`Sort code ${p.sortCode.trim()} isn't 6 digits`);
  if (!p.accountNumber.trim()) out.push("No account number");
  else if (!cleanAccountNumber(p.accountNumber)) out.push(`Account number ${p.accountNumber.trim()} isn't 8 digits`);
  return out;
}

function cell(p: BankPayment, c: BankColumn, t: BankTemplate, dateKey: string) {
  switch (c.field) {
    case "fixed":
      return c.value;
    case "payee_name":
      return bankText(p.payeeName, t.nameMax);
    case "account_name":
      return bankText(p.accountName || p.payeeName, t.nameMax);
    case "sort_code":
      return cleanSortCode(p.sortCode)!;
    case "sort_code_dashes": {
      const s = cleanSortCode(p.sortCode)!;
      return `${s.slice(0, 2)}-${s.slice(2, 4)}-${s.slice(4)}`;
    }
    case "account_number":
      return cleanAccountNumber(p.accountNumber)!;
    case "amount":
      return minorToInput(p.amountMinor, p.currency);
    case "amount_pence":
      return String(p.amountMinor);
    case "reference":
      return bankText(p.reference, t.referenceMax);
    case "payment_date":
      return formatDate(dateKey, t.dateFormat);
    case "email":
      return p.email.trim();
  }
}

/** A value made safe for the file: quoted when it holds the separator, a quote or a line break. */
function quote(v: string, sep: string) {
  return v.includes(sep) || /["\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * The bank file: one row per payment that passes the bank rules (nothing to pay, nothing written), and the
 * payments left out, to fix before paying. `dateKey` ("YYYY-MM-DD") is the payment date for a date column.
 */
export function bankFile(t: BankTemplate, payments: BankPayment[], dateKey: string) {
  const problems: BankProblem[] = [];
  const rows: string[][] = [];
  for (const p of payments) {
    if (p.amountMinor <= 0) continue;
    const bad = paymentProblems(p);
    if (bad.length) {
      problems.push({ key: p.key, payeeName: p.payeeName, artistId: p.artistId, problems: bad });
      continue;
    }
    rows.push(t.columns.map((c) => cell(p, c, t, dateKey)));
  }
  const lines = [...(t.header ? [t.columns.map((c) => c.header)] : []), ...rows].map((r) => r.map((v) => quote(v, t.separator)).join(t.separator));
  return { text: lines.length ? `${lines.join("\r\n")}\r\n` : "", rows, problems };
}

/** Made-up payments for "Download a sample". */
export const SAMPLE_PAYMENTS: BankPayment[] = [
  {
    key: "s1",
    payeeName: "Jo Bloggs",
    accountName: "J BLOGGS",
    sortCode: "12-34-56",
    accountNumber: "12345678",
    amountMinor: 45_000,
    currency: "GBP",
    reference: "Suave SB-0012/0019",
    email: "jo@example.com",
    artistId: null,
  },
  {
    key: "s2",
    payeeName: "The Bluebirds",
    accountName: "BLUEBIRDS MUSIC LTD",
    sortCode: "20-30-40",
    accountNumber: "0123456",
    amountMinor: 125_050,
    currency: "GBP",
    reference: "Suave SB-0020",
    email: "band@example.com",
    artistId: null,
  },
];

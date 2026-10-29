// Reading an Overture contacts export (Contacts > Export, a CSV). Overture keeps acts, people
// and companies in one list: a row with only an act name is an act, a row with a first name or
// surname is a person (linked to up to five acts and five companies by name), and a row with
// only a company name is a company. Venues are companies in Overture.

export type CsvRow = Record<string, string>;

/** Parse CSV text (quoted fields, commas and line breaks inside quotes, a leading BOM). */
export function parseCsv(text: string): CsvRow[] {
  const src = text.replace(/^﻿/, "");
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      record.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else field += c;
  }
  if (field || record.length) {
    record.push(field);
    records.push(record);
  }
  const [header, ...rest] = records;
  if (!header) return [];
  return rest
    .filter((r) => r.some((v) => v.trim()))
    .map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? "").trim()])))
    .filter((r) => r["Contact ID"] !== "Contact ID"); // a repeated header row
}

const nth = (base: string) => [base, `${base} 2`, `${base} 3`, `${base} 4`, `${base} 5`];

/** UK mobiles exported without their leading 0, e.g. 7700900123. */
export function tidyPhone(p: string) {
  const s = p.trim();
  return /^7\d{9}$/.test(s.replace(/\s/g, "")) ? `0${s.replace(/\s/g, "")}` : s;
}

const VENUE_WORDS =
  /\b(haus|hause|bar|bars|arms|inn|hotel|club|farm|barn|barns|castle|hall|manor|lodge|stadium|tavern|pub|golf|social|rogues|bonnies?|marriott?|house|priory|palace|estate|retreat|campsite|garden|gardens|court|grange|park|brewery|kitchen|lounge|tap|taproom|vaults|cellar|church|loft)\b/i;
const COMPANY_WORDS = /\b(ltd|limited|plc|llp|agency|group|solutions|records|music|management|overture|sony)\b/i;

export type ImportedAct = { ref: string; name: string; tag: string };
export type ImportedPerson = {
  ref: string;
  firstName: string;
  surname: string;
  alias: string;
  pronouns: string;
  jobTitle: string;
  email: string;
  phone: string;
  website: string;
  address: string;
  notes: string;
  acts: string[];
  companies: string[];
  customer: boolean;
};
export type ImportedCompany = { ref: string; name: string; venue: boolean; address: string; city: string; country: string; notes: string; tag: string };

function address(r: CsvRow, n = 1) {
  const k = (s: string) => r[`Address ${n}: ${s}`] ?? "";
  return [k("Line 1"), k("Line 2"), k("Line 3"), k("State/County"), k("Zip/Postcode")].filter(Boolean).join(", ");
}

/** Sort an export's rows into acts, people and companies. */
export function readOvertureContacts(rows: CsvRow[]) {
  const acts: ImportedAct[] = [];
  const people: ImportedPerson[] = [];
  const companies: ImportedCompany[] = [];
  let skipped = 0;
  for (const r of rows) {
    const ref = r["Contact ID"] ?? "";
    const actNames = nth("Act name")
      .map((k) => r[k] ?? "")
      .filter(Boolean);
    const companyNames = nth("Company name")
      .map((k) => r[k] ?? "")
      .filter(Boolean);
    const isPerson = !!(r["First name"] || r["Surname"]);
    const tag = r["Tag"] ?? "";
    if (isPerson) {
      const extra = [
        r["Tax Number"] && `Tax number: ${r["Tax Number"]}`,
        r["Email 2"] && `Also: ${r["Email 2"]}`,
        r["Phone number 2"] && `Also: ${tidyPhone(r["Phone number 2"])}`,
        tag && !/customer/i.test(tag) && `Overture tag: ${tag}`,
      ].filter(Boolean);
      people.push({
        ref,
        firstName: r["First name"] || r["Surname"],
        surname: r["First name"] ? r["Surname"] : "",
        alias: r["Alias"] ?? "",
        pronouns: r["Pronoun"] ?? "",
        jobTitle: r["Job title"] ?? "",
        email: (r["Email 1"] ?? "").toLowerCase(),
        phone: tidyPhone(r["Phone number 1"] ?? ""),
        website: r["Website 1"] ?? "",
        address: [address(r), r["Address 1: City"], r["Address 1: Country"]].filter(Boolean).join(", "),
        notes: extra.join("\n"),
        acts: actNames,
        companies: companyNames,
        customer: /customer/i.test(tag),
      });
    } else if (actNames.length && !companyNames.length) {
      acts.push({ ref, name: actNames[0], tag });
    } else if (companyNames.length) {
      const name = companyNames[0];
      const hasAddress = !!(address(r) || r["Address 1: City"]);
      const venue = /venue/i.test(tag) || (!COMPANY_WORDS.test(name) && (hasAddress || VENUE_WORDS.test(name)));
      const notes = [
        r["Parking"] && `Parking: ${r["Parking"]}`,
        r["PA Setup"] && `PA: ${r["PA Setup"]}`,
        r["Arrival Time"] && `Arrival: ${r["Arrival Time"]}`,
        /wedding/i.test(tag) && "Wedding venue",
      ]
        .filter(Boolean)
        .join("\n");
      companies.push({ ref, name, venue, address: address(r), city: r["Address 1: City"] ?? "", country: r["Address 1: Country"] ?? "", notes, tag });
    } else skipped++;
  }
  // People link to acts and companies by name, so make sure every one named exists.
  const actNames = new Set(acts.map((a) => a.name.toLowerCase()));
  for (const p of people)
    for (const a of p.acts)
      if (!actNames.has(a.toLowerCase())) {
        actNames.add(a.toLowerCase());
        acts.push({ ref: "", name: a, tag: "" });
      }
  const companyNames = new Set(companies.map((c) => c.name.toLowerCase()));
  for (const p of people)
    for (const c of p.companies)
      if (!companyNames.has(c.toLowerCase())) {
        companyNames.add(c.toLowerCase());
        companies.push({ ref: "", name: c, venue: !COMPANY_WORDS.test(c) && VENUE_WORDS.test(c), address: "", city: "", country: "", notes: "", tag: "" });
      }
  return { acts, people, companies, skipped };
}

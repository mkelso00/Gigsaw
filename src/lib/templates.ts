// Fill-in spreadsheets for adding acts, people and venues in bulk: download one, fill it in
// (Excel, Numbers or Google Sheets, saved as CSV) and upload it on the Import page.

import { toCsv } from "./csv";

export type TemplateKind = "acts" | "people" | "venues";

export const TEMPLATE_COLUMNS: Record<TemplateKind, { columns: string[]; examples: string[][]; required: string; label: string; hint: string }> = {
  acts: {
    label: "Acts",
    hint: "One row per act: solo singers, duos, bands and DJs. List members' names, separated by semicolons, to link them.",
    required: "Act name",
    columns: ["Act name", "Type", "Genre", "Based in", "Email", "Phone", "Usual fee", "Members", "Video link", "Instagram", "Website", "Notes"],
    examples: [
      ["Ellie Rose", "Solo", "Acoustic pop", "Bristol", "ellie@example.com", "07700 900111", "180", "Ellie Rose", "", "ellierose", "", ""],
      ["The Rogues Duo", "Duo", "Party covers", "Cardiff", "", "", "260", "Dev Sharma; Sam Price", "", "", "", "Own PA"],
    ],
  },
  people: {
    label: "People",
    hint: "Musicians, venue managers and anyone else. Link them to their acts (separated by semicolons) and to the venue or company they work at.",
    required: "First name",
    columns: ["First name", "Surname", "Email", "Phone", "Acts", "Works at", "Job title", "Notes"],
    examples: [
      ["Dev", "Sharma", "dev@example.com", "07700 900222", "The Rogues Duo; The Ultimate Party Band", "", "Drums", ""],
      ["Rachel", "Green", "rachel@example.com", "07700 900333", "", "The Crown", "General manager", "Books the Friday slot"],
    ],
  },
  venues: {
    label: "Venues",
    hint: "Pubs, bars and wedding venues. Parking, PA and arrival notes are saved on the venue.",
    required: "Venue name",
    columns: ["Venue name", "Address", "Town or city", "Postcode", "Country", "Email", "Phone", "Parking", "PA setup", "Arrival", "Notes"],
    examples: [
      [
        "The Crown",
        "12 High Street",
        "Bristol",
        "BS1 4DJ",
        "United Kingdom",
        "manager@thecrown.example",
        "0117 496 0000",
        "Car park behind",
        "Speakers provided, bring a desk",
        "15 minutes before start",
        "",
      ],
      ["Hollins Hall", "Hollins Lane", "Harrogate", "HG3 2LL", "United Kingdom", "", "", "", "", "", "Wedding venue"],
    ],
  },
};

export const isTemplateKind = (s: string): s is TemplateKind => s in TEMPLATE_COLUMNS;

/** The template as CSV: headings plus two example rows to type over. */
export function templateCsv(kind: TemplateKind) {
  const t = TEMPLATE_COLUMNS[kind];
  return toCsv(t.columns, t.examples);
}

/** Split "a; b, c" into names. Semicolons are preferred; commas work too. */
export function splitNames(s: string | undefined) {
  return (s ?? "")
    .split(/[;,]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

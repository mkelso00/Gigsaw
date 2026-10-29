"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { logActivity } from "@/lib/db";
import { FormError, handleForm, type FormState } from "@/lib/forms";
import { parseCsv } from "@/lib/overture";
import { importOverture } from "@/lib/overture-import";
import { importTemplate, missingColumn } from "@/lib/template-import";
import { isTemplateKind, TEMPLATE_COLUMNS } from "@/lib/templates";

/** Import an Overture contacts export (CSV). Safe to run again with the same file. */
export async function importOvertureContacts(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireAdmin();
  return handleForm(async () => {
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) throw new FormError("Choose the CSV file you exported from Overture");
    if (file.size > 5_000_000) throw new FormError("That file is too big. Overture contact exports are usually under 1 MB.");
    const rows = parseCsv(await file.text());
    if (!rows.length || !("Contact ID" in rows[0]) || !("Act name" in rows[0])) {
      throw new FormError("That doesn't look like an Overture contacts export. In Overture, go to Contacts and export them as CSV.");
    }
    const s = await importOverture(user.agencyId!, rows, { allVenues: form.get("allVenues") === "on" });
    await logActivity(user, "SETTINGS", user.agencyId!, "imported contacts from Overture", `${rows.length} rows`);
    revalidatePath("/", "layout");
    const part = (label: string, x: { added: number; matched: number }) => `${label}: ${x.added} added${x.matched ? `, ${x.matched} already here` : ""}`;
    return {
      ok: [
        `Imported ${rows.length} rows.`,
        part("Acts", s.acts),
        part("People", s.people),
        `${s.links.acts} people linked to their acts, ${s.links.workplaces} to where they work`,
        part("Venues", s.venues),
        part("Companies", s.companies),
        part("Private customers", s.customers),
        s.skipped ? `${s.skipped} empty rows skipped` : "",
      ]
        .filter(Boolean)
        .join(" · "),
    };
  });
}

/** Import a filled-in Gigsaw template (acts, people or venues). Safe to run again with the same file. */
export async function importTemplateFile(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireAdmin();
  return handleForm(async () => {
    const kind = String(form.get("kind") ?? "");
    if (!isTemplateKind(kind)) throw new FormError("Choose what's in the file: acts, people or venues");
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) throw new FormError("Choose the filled-in template (saved as CSV)");
    if (file.size > 5_000_000) throw new FormError("That file is too big.");
    const t = TEMPLATE_COLUMNS[kind];
    // The example rows are there to show what goes where: skip them if they were left in.
    const examples = new Set(t.examples.map((e) => e.join("|")));
    const rows = parseCsv(await file.text()).filter((r) => !examples.has(t.columns.map((c) => r[c] ?? "").join("|")));
    const missing = missingColumn(kind, rows);
    if (missing)
      throw new FormError(
        `That doesn't look like the ${t.label.toLowerCase()} template: there's no "${missing}" column. Download the template and fill that in.`,
      );
    if (!rows.length) throw new FormError("The file has no rows to add.");
    const s = await importTemplate(user.agencyId!, kind, rows);
    await logActivity(user, "SETTINGS", user.agencyId!, `imported ${kind} from a template`, `${rows.length} rows`);
    revalidatePath("/", "layout");
    const label = t.label.toLowerCase();
    return {
      ok: [
        `${rows.length} rows read.`,
        `${s.added} ${label} added`,
        s.updated ? `${s.updated} already here and filled in` : "",
        s.links ? `${s.links} links between people and acts` : "",
        s.created.length ? `also added: ${s.created.slice(0, 8).join(", ")}${s.created.length > 8 ? ` and ${s.created.length - 8} more` : ""}` : "",
        s.skipped ? `${s.skipped} rows skipped (no name)` : "",
      ]
        .filter(Boolean)
        .join(" · "),
    };
  });
}

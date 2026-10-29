"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { logActivity } from "@/lib/db";
import { FormError, handleForm, type FormState } from "@/lib/forms";
import { parseCsv } from "@/lib/overture";
import { importOverture } from "@/lib/overture-import";

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

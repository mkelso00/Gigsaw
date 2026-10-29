import type { Metadata } from "next";
import Link from "next/link";
import { importOvertureContacts } from "@/actions/import";
import { ActionForm, SubmitButton } from "@/components/forms";
import { PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";

export const metadata: Metadata = { title: "Import from Overture" };

export default async function ImportPage() {
  await requireAdmin();
  return (
    <div className="max-w-3xl">
      <PageHeader
        eyebrow={
          <Link href="/artists" className="hover:underline">
            Acts
          </Link>
        }
        title="Import from Overture"
        subtitle="Bring your acts, the people in them, venues, companies and customers across. Import your full contacts export, or a venues export with their parking, PA and arrival notes."
      />
      <section className="card card-pad space-y-5">
        <ol className="list-decimal space-y-2 pl-5 text-sm text-ink-600">
          <li>In Overture, go to Contacts and export everything as a CSV file.</li>
          <li>Choose that file below and press Import.</li>
        </ol>
        <ul className="space-y-1.5 rounded-xl border border-ink-200 p-4 text-sm text-ink-600">
          <li>
            <strong className="text-ink-950">Acts</strong> come across with the people in them linked as members. Someone in two acts is linked to both.
          </li>
          <li>
            <strong className="text-ink-950">Venues</strong> (companies with an address, or tagged as a venue) become venues, and their staff are linked to
            them.
          </li>
          <li>
            <strong className="text-ink-950">Other companies</strong> go under Companies &amp; customers. People tagged Customer become private customers.
          </li>
          <li>
            Anything already in Gigsaw with the same name is matched, not doubled up, and only empty details are filled in. You can import the same file again
            safely.
          </li>
        </ul>
        <ActionForm action={importOvertureContacts} className="space-y-4">
          <input type="file" name="file" accept=".csv,text/csv" required className="input" />
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" name="allVenues" className="mt-0.5 h-4 w-4 accent-ink-950" />
            <span>
              <span className="font-medium text-ink-950">This file is just venues</span>
              <span className="block text-ink-500">Treat every company in it as a venue, except obvious businesses like a Ltd company or an agency.</span>
            </span>
          </label>
          <SubmitButton pendingText="Importing… this can take a minute">Import</SubmitButton>
        </ActionForm>
      </section>
    </div>
  );
}

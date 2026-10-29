import type { Metadata } from "next";
import Link from "next/link";
import { importOvertureContacts, importTemplateFile } from "@/actions/import";
import { ActionForm, SubmitButton } from "@/components/forms";
import { PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { TEMPLATE_COLUMNS, type TemplateKind } from "@/lib/templates";

export const metadata: Metadata = { title: "Import" };

export default async function ImportPage() {
  await requireAdmin();
  return (
    <div className="max-w-4xl">
      <PageHeader
        eyebrow={
          <Link href="/artists" className="hover:underline">
            Acts
          </Link>
        }
        title="Import"
        subtitle="Add acts, people and venues in bulk: fill in one of our templates, or bring everything across from Overture."
      />

      <h2 id="templates" className="section-title mt-2 mb-1 scroll-mt-6">
        Fill in a template
      </h2>
      <p className="mb-4 text-sm text-ink-500">
        Download a template, fill it in with Excel, Numbers or Google Sheets, save it as CSV and upload it here. Delete or type over the two example rows.
        Anything already in Gigsaw with the same name is matched, not doubled up, so you can upload the same file again.
      </p>
      <div className="mb-10 grid gap-4 lg:grid-cols-3">
        {(Object.keys(TEMPLATE_COLUMNS) as TemplateKind[]).map((kind) => {
          const t = TEMPLATE_COLUMNS[kind];
          return (
            <section key={kind} id={`template-${kind}`} className="card card-pad flex scroll-mt-6 flex-col gap-3">
              <h3 className="text-base font-semibold">{t.label}</h3>
              <p className="text-sm text-ink-500">{t.hint}</p>
              <p className="text-xs text-ink-500">
                <span className="font-medium text-ink-700">Columns:</span> {t.columns.join(", ")}. Only {t.required} is required.
              </p>
              <a href={`/api/templates/${kind}`} className="btn btn-sm self-start" download>
                Download the {t.label.toLowerCase()} template
              </a>
              <ActionForm action={importTemplateFile} className="mt-auto space-y-3 border-t border-ink-100 pt-3">
                <input type="hidden" name="kind" value={kind} />
                <input type="file" name="file" accept=".csv,text/csv" required aria-label={`Filled-in ${t.label.toLowerCase()} template`} className="input" />
                <SubmitButton pendingText="Importing…">Upload {t.label.toLowerCase()}</SubmitButton>
              </ActionForm>
            </section>
          );
        })}
      </div>

      <h2 id="overture" className="section-title mb-1 scroll-mt-6">
        From Overture
      </h2>
      <p className="mb-4 text-sm text-ink-500">
        Bring your acts, the people in them, venues, companies and customers across. Import your full contacts export, or a venues export with their parking, PA
        and arrival notes.
      </p>
      <section className="card card-pad max-w-3xl space-y-5">
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

import type { Metadata } from "next";
import { createAgency } from "@/actions/owner";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, PageHeader } from "@/components/ui";
import { requireOwner } from "@/lib/auth";
import { CURRENCIES } from "@/lib/constants";

export const metadata: Metadata = { title: "New business" };

export default async function NewAgencyPage() {
  await requireOwner();
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="New business"
        subtitle="Creates the business and its first admin login, and emails them a welcome with a link to set their password."
      />
      <ActionForm action={createAgency} className="space-y-6">
        <section className="card card-pad space-y-4">
          <h2 className="section-title">Company</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Business name">
              <input name="name" required className="input" />
            </Field>
            <Field label="Billing email" hint="Where statements go. Defaults to the admin's email.">
              <input name="billingEmail" type="email" className="input" />
            </Field>
            <Field label="Price per gig" hint="Charged for each gig that goes ahead">
              <input name="pricePerGig" inputMode="decimal" required placeholder="2.50" className="input" />
            </Field>
            <Field label="Internal users included" hint="Admins and agents who log in to book">
              <input name="includedUsers" inputMode="numeric" defaultValue={2} className="input" />
            </Field>
            <Field label="Each extra internal user, per year" hint="Leave at 0 for no charge">
              <input name="extraUserYearly" inputMode="decimal" defaultValue="0" placeholder="500.00" className="input" />
            </Field>
            <Field label="Currency">
              <select name="billingCurrency" defaultValue="GBP" className="input">
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Private notes" hint="Only you see these">
            <textarea name="ownerNotes" rows={2} className="input" />
          </Field>
        </section>
        <section className="card card-pad space-y-4">
          <h2 className="section-title">First admin</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Name">
              <input name="adminName" required className="input" />
            </Field>
            <Field label="Email">
              <input name="adminEmail" type="email" required className="input" />
            </Field>
            <Field label="Password" hint="Optional. Leave blank and they set their own from the welcome email.">
              <input name="password" type="text" minLength={8} autoComplete="off" className="input" />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="welcome" defaultChecked className="h-4 w-4" />
            Send a welcome email with a link to set their password and sign in
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="demo" className="h-4 w-4" />
            Fill with demo data so they can explore (they can remove it from Settings). Demo gigs are never billed.
          </label>
        </section>
        <div className="flex justify-end">
          <SubmitButton pendingText="Creating…">Create business</SubmitButton>
        </div>
      </ActionForm>
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { createAgency } from "@/actions/owner";
import { Icon } from "@/components/icons";
import { SettingsSection } from "@/components/settings-ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, PageHeader } from "@/components/ui";
import { requireOwner } from "@/lib/auth";
import { CURRENCIES } from "@/lib/constants";

export const metadata: Metadata = { title: "New business" };

export default async function NewAgencyPage() {
  await requireOwner();
  return (
    <div className="mx-auto max-w-[760px]">
      <Link href="/owner" className="mb-3 inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-950">
        <Icon name="back" className="h-4 w-4" />
        Businesses
      </Link>
      <PageHeader title="New business" subtitle="Sets up the business and its first admin, and emails them a welcome with a link to set their password." />
      <ActionForm action={createAgency} className="space-y-10">
        <SettingsSection title="Business">
          <div className="card card-pad grid gap-4 sm:grid-cols-2">
            <Field label="Business name">
              <input name="name" required className="input" />
            </Field>
            <Field label="Billing email" hint="Where statements go. Leave blank to use the admin's email.">
              <input name="billingEmail" type="email" className="input" />
            </Field>
          </div>
        </SettingsSection>

        <SettingsSection title="Price" description="For businesses you invoice. Card-paying businesses choose a plan when they sign up themselves.">
          <div className="card card-pad grid gap-4 sm:grid-cols-2">
            <Field label="Price per gig" hint="For each gig that goes ahead">
              <input name="pricePerGig" inputMode="decimal" required defaultValue="2.50" className="input" />
            </Field>
            <Field label="Currency">
              <select name="billingCurrency" defaultValue="GBP" className="input">
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label="Internal users included" hint="Admins and agents who sign in">
              <input name="includedUsers" inputMode="numeric" defaultValue={2} className="input" />
            </Field>
            <Field label="Each extra internal user, per year" hint="Leave at 0 for no charge">
              <input name="extraUserYearly" inputMode="decimal" defaultValue="0" className="input" />
            </Field>
          </div>
        </SettingsSection>

        <SettingsSection title="First admin" description="The person who'll set up the business. They can add the rest of their team.">
          <div className="card card-pad grid gap-4 sm:grid-cols-2">
            <Field label="Name">
              <input name="adminName" required className="input" />
            </Field>
            <Field label="Email">
              <input name="adminEmail" type="email" required className="input" />
            </Field>
            <Field label="Password" hint="Optional. Leave blank and they set their own from the welcome email." className="sm:col-span-2">
              <input name="password" type="text" minLength={8} autoComplete="off" className="input" />
            </Field>
            <label className="flex items-start gap-3 text-sm sm:col-span-2">
              <input type="checkbox" name="welcome" defaultChecked className="mt-0.5 h-4 w-4" />
              <span>
                Send a welcome email
                <span className="block text-ink-500">With a link to set their password and sign in.</span>
              </span>
            </label>
            <label className="flex items-start gap-3 text-sm sm:col-span-2">
              <input type="checkbox" name="demo" className="mt-0.5 h-4 w-4" />
              <span>
                Fill with demo data
                <span className="block text-ink-500">
                  Sample acts, venues and bookings to explore. They can remove it from Settings, and demo gigs are never billed.
                </span>
              </span>
            </label>
          </div>
        </SettingsSection>

        <SettingsSection title="Private notes" description="Only owners see these.">
          <div className="card card-pad">
            <textarea name="ownerNotes" rows={2} aria-label="Private notes" className="input" />
          </div>
        </SettingsSection>

        <div className="flex justify-end gap-3 border-t border-ink-200 pt-6">
          <Link href="/owner" className="btn">
            Cancel
          </Link>
          <SubmitButton pendingText="Creating…">Create business</SubmitButton>
        </div>
      </ActionForm>
    </div>
  );
}

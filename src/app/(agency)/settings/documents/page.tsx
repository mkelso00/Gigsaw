import type { Metadata } from "next";
import { saveSettings } from "@/actions/settings";
import { ActionForm, SubmitButton } from "@/components/forms";
import { SettingsCard, SettingsPage, SettingsSection } from "@/components/settings-ui";
import { Field } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { getSettings } from "@/lib/db";

export const metadata: Metadata = { title: "Contracts and invoices" };

export default async function DocumentSettings() {
  const user = await requireAdmin();
  const settings = await getSettings(user.agencyId!);
  return (
    <SettingsPage title="Contracts and invoices">
      <ActionForm action={saveSettings} className="space-y-9">
        <SettingsSection title="Wording" description="Added to the bottom of every contract and invoice.">
          <SettingsCard pad>
            <div className="space-y-4">
              <Field label="Contract terms">
                <textarea name="contractTerms" rows={6} defaultValue={settings.contractTerms} className="input" />
              </Field>
              <Field label="Invoice terms" hint="e.g. payment terms and bank details">
                <textarea name="invoiceTerms" rows={3} defaultValue={settings.invoiceTerms} className="input" />
              </Field>
            </div>
          </SettingsCard>
        </SettingsSection>
        <SubmitButton>Save</SubmitButton>
      </ActionForm>
    </SettingsPage>
  );
}

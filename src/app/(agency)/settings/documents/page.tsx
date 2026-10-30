import type { Metadata } from "next";
import { saveSettings } from "@/actions/settings";
import { ActionForm } from "@/components/forms";
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
      <ActionForm action={saveSettings} saveBar className="space-y-9">
        <SettingsSection
          title="Contracts"
          description="Your terms go at the end of every contract, printed or sent to sign online, just above the signatures. Leave it empty to leave the section out. Changing them doesn't affect contracts already signed."
        >
          <SettingsCard pad>
            <Field label="Contract terms" hint="e.g. cancellation, deposits and what happens if the act can't make it">
              <textarea name="contractTerms" rows={8} defaultValue={settings.contractTerms} className="input" />
            </Field>
          </SettingsCard>
        </SettingsSection>
        <SettingsSection title="Invoices and statements" description="Printed at the bottom of every invoice and venue statement.">
          <SettingsCard pad>
            <Field label="Invoice terms" hint="e.g. payment terms and your bank details">
              <textarea
                name="invoiceTerms"
                rows={4}
                defaultValue={settings.invoiceTerms}
                placeholder={"Payment within 14 days, please.\nBank: Example Bank, sort code 00-00-00, account 12345678"}
                className="input"
              />
            </Field>
          </SettingsCard>
        </SettingsSection>
      </ActionForm>
    </SettingsPage>
  );
}

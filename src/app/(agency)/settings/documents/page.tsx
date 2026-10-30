import type { Metadata } from "next";
import { saveSettings } from "@/actions/settings";
import { ActionForm } from "@/components/forms";
import { SettingsCard, SettingsPage, SettingsSection } from "@/components/settings-ui";
import { SignaturePad } from "@/components/signature-pad";
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
        <SettingsSection
          title="Your signature"
          description="Signed on your side of every contract, printed or sent to sign online. Draw it once here with your mouse, finger or a pen."
        >
          <SettingsCard pad className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name under the signature">
                <input name="signatureName" defaultValue={settings.signatureName} placeholder="e.g. Tom Smith" className="input" />
              </Field>
              <Field label="Their role" hint="Optional">
                <input name="signatureRole" defaultValue={settings.signatureRole} placeholder="e.g. Director" className="input" />
              </Field>
            </div>
            {settings.signatureImage && (
              <div>
                <span className="label">Signature on your contracts now</span>
                <div className="flex items-center justify-between gap-4 rounded-xl border border-ink-200 bg-white px-4 py-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={settings.signatureImage} alt="Your current signature" className="h-14 max-w-[60%] object-contain" />
                  <label className="flex items-center gap-2 text-sm text-ink-600">
                    <input type="checkbox" name="signatureRemove" />
                    Remove it
                  </label>
                </div>
              </div>
            )}
            <div>
              <span className="label">{settings.signatureImage ? "Draw a new one to replace it" : "Draw your signature"}</span>
              <SignaturePad
                name="signatureImage"
                emptyText={
                  settings.signatureImage ? "Leave the box empty to keep the one above." : "Until you draw one, your name is written in a handwriting style."
                }
              />
            </div>
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

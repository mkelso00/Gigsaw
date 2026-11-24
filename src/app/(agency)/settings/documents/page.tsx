import type { Metadata } from "next";
import { addContractType, deleteContractType, saveContractType } from "@/actions/contract-types";
import { saveSettings } from "@/actions/settings";
import { ActionForm, ServerForm, SubmitButton } from "@/components/forms";
import { Badge, SettingsCard, SettingsPage, SettingsSection } from "@/components/settings-ui";
import { SignaturePad } from "@/components/signature-pad";
import { Field } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { EVENT_TYPES, eventTypeLabel } from "@/lib/constants";
import { shadowedEventTypes } from "@/lib/contract-templates";
import { contractTemplatesFor, type ContractTemplateRow } from "@/lib/contract-templates-server";
import { getSettings } from "@/lib/db";
import { DEFAULT_PAY_NOTE, DEFAULT_PROPOSAL_WELCOME } from "@/lib/proposal-pay";
import { DEFAULT_SELF_BILLING_TEXT } from "@/lib/self-billing";

export const metadata: Metadata = { title: "Contracts and invoices" };

export default async function DocumentSettings() {
  const user = await requireAdmin();
  const [settings, templates] = await Promise.all([getSettings(user.agencyId!), contractTemplatesFor(user.agencyId!)]);
  const shadowed = shadowedEventTypes(templates);
  return (
    <SettingsPage title="Contracts and invoices">
      {/* Each contract type is its own form, kept outside the Save bar's form below (forms can't be nested). */}
      <SettingsSection
        id="contract-types"
        title="Contract types"
        description="Your saved contracts, e.g. one for weddings, one for corporate clients and one for small events. The right one goes into each new proposal and at the end of each contract, printed or sent to sign online, and you can change it on any proposal, booking or wedding. A client can have their own on their page. Proposals already sent and contracts already signed keep the wording they had."
      >
        {templates.length === 0 ? (
          <SettingsCard pad>
            <p className="text-sm text-ink-600">
              No contracts yet. Add your terms once, e.g. cancellation, deposits and what happens if the act can&apos;t make it, and they go on every contract
              and proposal. Wedding proposals need them: the couple read and agree to them when they sign.
            </p>
            <ServerForm action={addContractType} className="mt-4">
              <SubmitButton pendingText="Adding…">Add your first contract</SubmitButton>
            </ServerForm>
          </SettingsCard>
        ) : (
          <div className="space-y-4">
            {templates.map((t, i) => (
              <ContractTypeCard key={t.id} t={t} shadowed={shadowed[t.id] ?? []} before={templates.slice(0, i)} />
            ))}
            <ServerForm action={addContractType}>
              <SubmitButton className="btn" pendingText="Adding…">
                Add a contract type
              </SubmitButton>
            </ServerForm>
          </div>
        )}
      </SettingsSection>

      <ActionForm action={saveSettings} saveBar className="space-y-9">
        <SettingsSection
          id="signature"
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
        <SettingsSection
          id="proposal-welcome"
          title="Opening message on proposals"
          description="The first thing a customer reads on every proposal, after 'Hi' and their first name. Anything you write on one proposal's note goes underneath it."
        >
          <SettingsCard pad>
            <Field
              label="Opening message"
              hint="Leave it blank for the wording shown. {business} is your business name and {occasion} is 'your wedding', 'your party' or 'your event'."
            >
              <textarea
                name="proposalWelcome"
                rows={6}
                maxLength={2000}
                defaultValue={settings.proposalWelcome}
                placeholder={DEFAULT_PROPOSAL_WELCOME}
                className="input"
              />
            </Field>
          </SettingsCard>
        </SettingsSection>
        <SettingsSection
          id="wedding-payments"
          title="How couples pay"
          description="Every wedding proposal asks for a deposit of your share plus VAT, which secures the date. The couple then choose to pay the balance in cash with no VAT, or by bank transfer with VAT added. This note goes under the ways to pay on every wedding proposal, and you can change it on any one proposal."
        >
          <SettingsCard pad className="space-y-5">
            <Field
              label="Address for cash payments"
              hint="Where couples bring a balance paid in cash. Shown on the proposal, the couple's page and the balance emails."
            >
              <textarea
                name="cashAddress"
                rows={3}
                maxLength={300}
                defaultValue={settings.cashAddress}
                placeholder={"e.g. 63 Boverton Road\nLlantwit Major\nCF61 1YA"}
                className="input"
              />
            </Field>
            <Field
              label="Note under the ways to pay"
              hint="Leave it blank for the wording shown. {business} is your business name and {cashAddress} the address above."
            >
              <textarea name="payNote" rows={5} maxLength={2000} defaultValue={settings.payNote} placeholder={DEFAULT_PAY_NOTE} className="input" />
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
        <SettingsSection
          id="self-billing"
          title="Self-billing agreement"
          description="Gigsaw makes out each act's invoice for them (self-billing). HMRC asks for the act's written agreement to that, reviewed every 12 months. Acts tick this wording when they give their pay details in the app, and are asked again a year later. Changing it here doesn't change what anyone has already agreed to."
        >
          <SettingsCard pad>
            <Field label="What acts agree to" hint="Leave it blank for the wording shown. {business} is your business name.">
              <textarea
                name="selfBillingAgreementText"
                rows={4}
                maxLength={2000}
                defaultValue={settings.selfBillingAgreementText}
                placeholder={DEFAULT_SELF_BILLING_TEXT}
                className="input"
              />
            </Field>
          </SettingsCard>
        </SettingsSection>
      </ActionForm>
    </SettingsPage>
  );
}

/** One contract type: its own form to save it, and a separate one to delete it (which asks first). */
function ContractTypeCard({ t, shadowed, before }: { t: ContractTemplateRow; shadowed: string[]; before: ContractTemplateRow[] }) {
  // The type above this one that already has an event type ticked here too (the first in the list wins).
  const takenBy = (e: string) => before.find((o) => o.eventTypes.includes(e))?.name;
  return (
    <div className="card p-5" data-testid="contract-type" id={`contract-${t.id}`}>
      <ActionForm action={saveContractType.bind(null, t.id)} className="space-y-4">
        <div className="flex items-start gap-3">
          <Field label="Name" className="min-w-0 flex-1">
            <input name="name" required maxLength={80} defaultValue={t.name} placeholder="e.g. Wedding contract" className="input" />
          </Field>
          {t.isDefault && (
            <span className="mt-7">
              <Badge tone="green">Default</Badge>
            </span>
          )}
        </div>
        <fieldset>
          <legend className="label">Use by default for</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {EVENT_TYPES.map((e) => (
              <label key={e} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="eventTypes" value={e} defaultChecked={t.eventTypes.includes(e)} />
                {eventTypeLabel(e)}
              </label>
            ))}
          </div>
          {shadowed.length > 0 ? (
            <p className="mt-1.5 text-xs text-amber-800">
              {shadowed.map((e) => `${eventTypeLabel(e)} already uses the ${takenBy(e) ?? "contract above"}`).join(". ")}. That one comes first, so this one is
              only used there when you choose it.
            </p>
          ) : (
            <p className="hint">Proposals, bookings and weddings of these types get this contract, unless the client has their own.</p>
          )}
        </fieldset>
        <label className="flex items-start gap-2 text-sm">
          {/* The default can't be unticked here (there's always one): tick it on another type to move it. */}
          <input type="checkbox" name="isDefault" defaultChecked={t.isDefault} disabled={t.isDefault} className="mt-0.5" />
          <span>
            Default for everything else
            <span className="hint block">
              {t.isDefault ? "Used when nothing else fits. To change it, tick this on another contract type." : "Used when nothing else fits."}
            </span>
          </span>
        </label>
        <Field label="Terms" hint="e.g. cancellation, deposits and what happens if the act can't make it">
          <textarea name="terms" rows={8} maxLength={20000} defaultValue={t.terms} className="input" />
        </Field>
        <div className="flex justify-end">
          <SubmitButton>Save</SubmitButton>
        </div>
      </ActionForm>
      <ActionForm action={deleteContractType.bind(null, t.id)} className="mt-4 border-t border-ink-100 pt-4">
        <SubmitButton className="btn btn-sm" pendingText="Checking…">
          Delete this contract type
        </SubmitButton>
      </ActionForm>
    </div>
  );
}

import type { Metadata } from "next";
import { saveSettings } from "@/actions/settings";
import { ActionForm } from "@/components/forms";
import { SettingsCard, SettingsPage, SettingsSection } from "@/components/settings-ui";
import { Field } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { getSettings } from "@/lib/db";
import { formatMoney, minorToInput } from "@/lib/money";

export const metadata: Metadata = { title: "Booking fee and VAT" };

export default async function BookingFeeSettings() {
  const user = await requireAdmin();
  const settings = await getSettings(user.agencyId!);
  const cur = settings.defaultCurrency;
  return (
    <SettingsPage title="Booking fee and VAT">
      <ActionForm action={saveSettings} saveBar className="space-y-9">
        <SettingsSection
          title="VAT on sales"
          description={`Put VAT on what the venue or customer pays for every new booking, so you don't have to add it each time. For example, at 20% a ${formatMoney(30000, cur)} sale is invoiced as ${formatMoney(36000, cur)}.`}
        >
          <SettingsCard pad>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="VAT %" hint="0 for no VAT, e.g. if you're not VAT registered">
                <input
                  name="defaultVatPct"
                  inputMode="decimal"
                  defaultValue={settings.defaultVatPct ? String(settings.defaultVatPct) : "0"}
                  placeholder="20"
                  className="input"
                />
              </Field>
            </div>
            <p className="mt-4 text-sm text-ink-500">
              It fills in on new bookings (the full form, quick bookings, copies, weekly bookings, wedding acts and proposal lines), where you can still change
              it for one booking. Bookings already made aren&apos;t changed.
            </p>
          </SettingsCard>
        </SettingsSection>
        <SettingsSection
          title="Default booking fee"
          description={`A fee on top of the act's fee, paid by the venue or client and kept in full by you. For example, with a ${formatMoney(5000, cur)} fee a client booking a ${formatMoney(60000, cur)} band pays ${formatMoney(65000, cur)}. Acts never see it.`}
        >
          <SettingsCard pad>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={`Amount (${cur})`} hint="Leave empty or 0 for no booking fee">
                <input
                  name="bookingFee"
                  inputMode="decimal"
                  defaultValue={settings.bookingFeeMinor ? minorToInput(settings.bookingFeeMinor, cur) : ""}
                  placeholder="0.00"
                  className="input"
                />
              </Field>
              <Field label="Add it to">
                <select name="bookingFeeFor" defaultValue={settings.bookingFeeFor} className="input">
                  <option value="EVENTS">Weddings and private events (once per event)</option>
                  <option value="ALL">Every booking, bar bookings too</option>
                </select>
              </Field>
            </div>
            <p className="mt-4 text-sm text-ink-500">
              It fills in on new bookings, where you can change or clear it. Bookings already made aren&apos;t changed.
            </p>
          </SettingsCard>
        </SettingsSection>
      </ActionForm>
    </SettingsPage>
  );
}

import type { Metadata } from "next";
import { saveSettings } from "@/actions/settings";
import { ActionForm, SubmitButton } from "@/components/forms";
import { SettingsCard, SettingsPage, SettingsSection } from "@/components/settings-ui";
import { Field } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { getSettings } from "@/lib/db";
import { minorToInput } from "@/lib/money";

export const metadata: Metadata = { title: "Booking fee" };

export default async function BookingFeeSettings() {
  const user = await requireAdmin();
  const settings = await getSettings(user.agencyId!);
  return (
    <SettingsPage title="Booking fee">
      <ActionForm action={saveSettings} className="space-y-6">
        <SettingsSection
          title="Default booking fee"
          description="A fee on top of the act's fee, paid by the venue or client and kept in full by you. It fills in on new bookings and can be changed or cleared on any booking. Acts never see it."
        >
          <SettingsCard pad>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={`Amount (${settings.defaultCurrency})`} hint="Leave blank or 0 for no booking fee">
                <input
                  name="bookingFee"
                  inputMode="decimal"
                  defaultValue={settings.bookingFeeMinor ? minorToInput(settings.bookingFeeMinor, settings.defaultCurrency) : ""}
                  placeholder="0.00"
                  className="input"
                />
              </Field>
              <Field label="Add it to">
                <select name="bookingFeeFor" defaultValue={settings.bookingFeeFor} className="input">
                  <option value="EVENTS">Weddings and private events (once per event)</option>
                  <option value="ALL">Every booking, bar gigs too</option>
                </select>
              </Field>
            </div>
          </SettingsCard>
        </SettingsSection>
        <SubmitButton>Save</SubmitButton>
      </ActionForm>
    </SettingsPage>
  );
}

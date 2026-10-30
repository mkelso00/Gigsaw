import type { Metadata } from "next";
import { clearDemoData, loadDemoData } from "@/actions/settings";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/forms";
import { SettingsCard, SettingsPage, SettingsSection } from "@/components/settings-ui";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const metadata: Metadata = { title: "Demo data" };

export default async function DemoSettings() {
  const user = await requireAdmin();
  const demoBookings = await prisma.booking.count({ where: { agencyId: user.agencyId, demo: true } });
  return (
    <SettingsPage title="Demo data">
      <SettingsSection title={demoBookings ? `Loaded: ${demoBookings} bookings` : "Not loaded"}>
        <SettingsCard pad>
          {demoBookings > 0 ? (
            <>
              <p className="mb-4 text-sm text-ink-500">
                Remove it before you start using Gigsaw for real. Only the demo acts, venues, contacts and bookings are removed, plus anything you added to a
                demo act.
              </p>
              <ActionForm action={clearDemoData}>
                <ConfirmButton message="Remove all demo data? This can't be undone.">Remove demo data</ConfirmButton>
              </ActionForm>
            </>
          ) : (
            <>
              <p className="mb-4 text-sm text-ink-500">
                Fill Gigsaw with a bar-circuit agency: 12 acts (solos, duos, a DJ and two bands, one built from solo acts), 8 venues with weekly music
                schedules, managers and the pub companies that pay, six weeks of bookings played, live arrivals today, the next month of bookings with offers
                out and bookings still needing an act, two weddings and two private events. It sits alongside your own data, is never billed or messaged, and
                can be removed in one click.
              </p>
              <ActionForm action={loadDemoData}>
                <SubmitButton pendingText="Loading demo data…">Load demo data</SubmitButton>
              </ActionForm>
            </>
          )}
        </SettingsCard>
      </SettingsSection>
    </SettingsPage>
  );
}

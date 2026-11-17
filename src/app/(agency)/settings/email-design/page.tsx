import type { Metadata } from "next";
import { saveEmailDesign, sendTestEmail } from "@/actions/email-design";
import { EmailDesignEditor } from "@/components/email-design-editor";
import { ActionForm, SubmitButton } from "@/components/forms";
import { SettingsPage } from "@/components/settings-ui";
import { requireAdmin } from "@/lib/auth";
import { getSettings, prisma } from "@/lib/db";
import { readEmailDesign } from "@/lib/email-design";
import { brandLogoUrl } from "@/lib/messaging";

export const metadata: Metadata = { title: "Email design" };

/** The look of every email the business sends: logo, colours, footer, and the enquiry reply's next steps. */
export default async function EmailDesignSettings() {
  const user = await requireAdmin();
  const agencyId = user.agencyId!;
  const [settings, logo] = await Promise.all([getSettings(agencyId), prisma.brandLogo.findUnique({ where: { agencyId }, select: { updatedAt: true } })]);
  const business = settings.agencyName;

  return (
    <SettingsPage title="Email design">
      <p className="-mt-5 mb-6 text-sm text-ink-500">
        Your logo and colours on every email you send: the enquiry reply, proposals, contracts, payment links, reminders and the rest.
      </p>
      <ActionForm action={saveEmailDesign} saveBar className="space-y-8">
        <EmailDesignEditor
          design={readEmailDesign(settings.emailDesign)}
          business={business}
          email={settings.agencyEmail}
          logoUrl={logo ? brandLogoUrl(agencyId, logo.updatedAt) : null}
        />
      </ActionForm>
      <ActionForm action={sendTestEmail} className="mt-8 flex flex-wrap items-center gap-3 border-t border-ink-100 pt-6">
        <SubmitButton className="btn" pendingText="Sending…">
          Send me a test
        </SubmitButton>
        <span className="text-sm text-ink-500">A sample enquiry reply in your saved design, to {user.email}. Save first to test a change.</span>
      </ActionForm>
    </SettingsPage>
  );
}

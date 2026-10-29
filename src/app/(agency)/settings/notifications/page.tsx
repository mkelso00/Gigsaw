import type { Metadata } from "next";
import { sendTestMessage } from "@/actions/settings";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, SettingsCard, SettingsPage, SettingsRow, SettingsSection } from "@/components/settings-ui";
import { requireAdmin } from "@/lib/auth";
import { getSettings } from "@/lib/db";
import { TEMPLATES, TEMPLATE_GROUPS, templateSettings, type TemplateGroup } from "@/lib/message-templates";
import { emailConfigured, smsConfigured } from "@/lib/messaging";

export const metadata: Metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

export default async function NotificationSettings() {
  const user = await requireAdmin();
  const settings = await getSettings(user.agencyId!);
  const from = process.env.MAIL_FROM?.match(/[^\s<>]+@[^\s<>]+/)?.[0] ?? "Gigsaw's sending address";
  const counts = (g: TemplateGroup) => {
    const list = TEMPLATES.filter((t) => t.group === g);
    const off = list.filter((t) => templateSettings(settings.messageTemplates, t.key).off).length;
    const custom = list.filter((t) => {
      const s = templateSettings(settings.messageTemplates, t.key);
      return s.subject || s.intro || s.text;
    }).length;
    return [`${list.length} message${list.length === 1 ? "" : "s"}`, off ? `${off} off` : "", custom ? `${custom} reworded` : ""].filter(Boolean).join(" · ");
  };
  return (
    <SettingsPage title="Notifications">
      <SettingsSection title="Sender email" description="The address your emails come from, and where replies go.">
        <SettingsCard>
          <SettingsRow
            icon="mail"
            title={`Sent from ${from}`}
            sub={`Shown as "${settings.agencyName || "Gigsaw"}". Replies go to ${settings.agencyEmail || "your business email (not set yet)"}.`}
            href="/settings/general"
          />
          <SettingsRow
            icon="bell"
            title="Email and texts"
            sub="Send yourself a test to check they arrive."
            right={
              <span className="flex flex-wrap items-center justify-end gap-2">
                <Badge tone={emailConfigured() ? "green" : "red"}>Email {emailConfigured() ? "on" : "not set up"}</Badge>
                <Badge tone={smsConfigured() ? "green" : "grey"}>Texts {smsConfigured() ? "on" : "not set up"}</Badge>
                <ActionForm action={sendTestMessage}>
                  <SubmitButton className="btn btn-sm" pendingText="Sending…">
                    Send me a test
                  </SubmitButton>
                </ActionForm>
              </span>
            }
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title="Automatic messages"
        description="Switch any of them off, or change the wording. Venue, date, times and links are always added underneath."
      >
        <SettingsCard>
          {(Object.keys(TEMPLATE_GROUPS) as TemplateGroup[]).map((g) => (
            <SettingsRow
              key={g}
              icon={TEMPLATE_GROUPS[g].icon}
              title={TEMPLATE_GROUPS[g].label}
              sub={`${TEMPLATE_GROUPS[g].hint}. ${counts(g)}`}
              href={`/settings/notifications/${TEMPLATE_GROUPS[g].slug}`}
            />
          ))}
        </SettingsCard>
      </SettingsSection>

      <SettingsSection>
        <SettingsCard>
          <SettingsRow icon="user" title="Your own alerts" sub="Late acts, turned-down gigs and more: each person chooses in their profile" href="/profile" />
          <SettingsRow icon="arrivals" title="Late act alerts" sub="Who's alerted when an act is late, and an on-call contact" href="/settings/arrivals" />
          <SettingsRow
            icon="messages"
            title="Message log"
            sub="Every email, text and phone notification sent, and any that failed"
            href="/settings/notifications/log"
          />
        </SettingsCard>
      </SettingsSection>
    </SettingsPage>
  );
}

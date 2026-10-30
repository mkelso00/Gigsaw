import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { saveMessageTemplate } from "@/actions/settings";
import { ActionForm } from "@/components/forms";
import { SettingsCard, SettingsPage, SettingsSection } from "@/components/settings-ui";
import { TemplateFields } from "@/components/template-fields";
import { requireAdmin } from "@/lib/auth";
import { getSettings } from "@/lib/db";
import { TEMPLATES, TEMPLATE_GROUPS, templateSettings } from "@/lib/message-templates";

export const metadata: Metadata = { title: "Edit message" };

export default async function EditTemplatePage({ params }: { params: Promise<{ group: string; key: string }> }) {
  const user = await requireAdmin();
  const { group, key } = await params;
  const t = TEMPLATES.find((x) => x.key.toLowerCase() === key && TEMPLATE_GROUPS[x.group].slug === group);
  if (!t) notFound();
  const settings = await getSettings(user.agencyId!);
  const s = templateSettings(settings.messageTemplates, t.key);
  const save = saveMessageTemplate.bind(null, t.key);
  // Without these the act never hears they've been asked, so say what switching off means.
  const critical =
    t.key === "OFFER"
      ? "If it's off, acts won't hear about offers: you'll need to tell them yourself."
      : t.key === "AVAILABILITY"
        ? "If it's off, acts won't be asked if they're free: you'll need to send them the link yourself."
        : null;
  const values = { subject: s.subject ?? "", intro: s.intro ?? "", text: s.text ?? "" };
  return (
    <SettingsPage title={t.label} back={{ href: `/settings/notifications/${group}`, label: TEMPLATE_GROUPS[t.group].label }}>
      <p className="-mt-5 text-sm text-ink-500">{t.hint}</p>
      <ActionForm action={save} saveBar className="space-y-9">
        <SettingsCard>
          <label className="flex cursor-pointer items-start justify-between gap-4 px-5 py-4">
            <span>
              <span className="block text-sm font-medium text-ink-950">Send this message</span>
              <span className="mt-0.5 block text-sm text-ink-500">{critical ?? "Turn it off and it won't go out."}</span>
            </span>
            <input type="checkbox" name="on" defaultChecked={!s.off} className="switch mt-0.5" />
          </label>
        </SettingsCard>

        <SettingsSection
          title="Wording"
          description="Leave a box empty to use Gigsaw's own wording, shown in grey. The venue, date, times and links are always added underneath."
        >
          <SettingsCard pad>
            {/* Starts afresh whenever the saved wording changes, e.g. after going back to Gigsaw's wording. */}
            <TemplateFields key={JSON.stringify(values)} example={t.example} values={values} placeholders={t.placeholders} business={settings.agencyName} />
          </SettingsCard>
        </SettingsSection>
      </ActionForm>
    </SettingsPage>
  );
}

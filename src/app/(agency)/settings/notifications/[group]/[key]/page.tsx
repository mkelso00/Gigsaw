import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { saveMessageTemplate } from "@/actions/settings";
import { ActionForm, SubmitButton } from "@/components/forms";
import { SettingsCard, SettingsPage, SettingsSection } from "@/components/settings-ui";
import { Field } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { getSettings } from "@/lib/db";
import { TEMPLATES, TEMPLATE_GROUPS, templateSettings } from "@/lib/message-templates";

export const metadata: Metadata = { title: "Edit message" };

const LABELS: Record<string, string> = {
  first_name: "their first name",
  act: "the act",
  venue: "the venue",
  date: "the date",
  time: "the call time",
  business: "your business name",
  event: "the wedding or event",
};

export default async function EditTemplatePage({ params }: { params: Promise<{ group: string; key: string }> }) {
  const user = await requireAdmin();
  const { group, key } = await params;
  const t = TEMPLATES.find((x) => x.key.toLowerCase() === key && TEMPLATE_GROUPS[x.group].slug === group);
  if (!t) notFound();
  const settings = await getSettings(user.agencyId!);
  const s = templateSettings(settings.messageTemplates, t.key);
  const save = saveMessageTemplate.bind(null, t.key);
  const critical = t.key === "OFFER";
  return (
    <SettingsPage
      title={t.label}
      actions={
        <Link href={`/settings/notifications/${group}`} className="btn">
          Back
        </Link>
      }
    >
      <p className="-mt-5 text-sm text-ink-500">{t.hint}</p>
      <ActionForm action={save} className="space-y-9">
        <SettingsCard>
          <label className="flex cursor-pointer items-start justify-between gap-4 px-5 py-4">
            <span>
              <span className="block text-sm font-medium text-ink-950">Send this message</span>
              <span className="mt-0.5 block text-sm text-ink-500">
                {critical ? "If it's off, acts won't hear about offers: you'll need to tell them yourself." : "Turn it off and it won't go out."}
              </span>
            </span>
            <input type="checkbox" name="on" defaultChecked={!s.off} className="switch mt-0.5" />
          </label>
        </SettingsCard>

        <SettingsSection title="Wording" description="Leave a box empty to use Gigsaw's own wording, shown in grey.">
          <SettingsCard pad>
            <div className="space-y-4">
              <Field label="Email subject">
                <input name="subject" defaultValue={s.subject ?? ""} placeholder={t.example.subject} className="input" />
              </Field>
              <Field label="Message" hint="The opening of the email. The details and buttons are added underneath.">
                <textarea name="intro" rows={4} defaultValue={s.intro ?? ""} placeholder={t.example.intro} className="input" />
              </Field>
              {t.example.text && (
                <Field label="Text message" hint="For people without the app. Keep it short; any link is added at the end.">
                  <textarea name="text" rows={2} defaultValue={s.text ?? ""} placeholder={t.example.text} className="input" />
                </Field>
              )}
            </div>
          </SettingsCard>
        </SettingsSection>

        <SettingsSection title="Placeholders" description="Type these and they're filled in for each message.">
          <SettingsCard pad>
            <div className="flex flex-wrap gap-2 text-sm">
              {t.placeholders.map((p) => (
                <span key={p} className="rounded-lg border border-ink-200 px-2.5 py-1">
                  <code className="font-semibold">{`{${p}}`}</code> <span className="text-ink-500">{LABELS[p] ?? p}</span>
                </span>
              ))}
            </div>
          </SettingsCard>
        </SettingsSection>

        <div className="flex flex-wrap gap-3">
          <SubmitButton>Save</SubmitButton>
          <SubmitButton className="btn" name="useDefault" value="1" pendingText="Resetting…">
            Use Gigsaw&apos;s wording
          </SubmitButton>
        </div>
      </ActionForm>
    </SettingsPage>
  );
}

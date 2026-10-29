import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, SettingsCard, SettingsPage, SettingsRow } from "@/components/settings-ui";
import { requireAdmin } from "@/lib/auth";
import { getSettings } from "@/lib/db";
import { TEMPLATES, TEMPLATE_GROUPS, templateSettings, type TemplateGroup } from "@/lib/message-templates";

export const metadata: Metadata = { title: "Notifications" };

export default async function TemplateGroupPage({ params }: { params: Promise<{ group: string }> }) {
  const user = await requireAdmin();
  const { group: slug } = await params;
  const group = (Object.keys(TEMPLATE_GROUPS) as TemplateGroup[]).find((g) => TEMPLATE_GROUPS[g].slug === slug);
  if (!group) notFound();
  const settings = await getSettings(user.agencyId!);
  return (
    <SettingsPage
      title={TEMPLATE_GROUPS[group].label}
      actions={
        <Link href="/settings/notifications" className="btn">
          Back
        </Link>
      }
    >
      <SettingsCard>
        {TEMPLATES.filter((t) => t.group === group).map((t) => {
          const s = templateSettings(settings.messageTemplates, t.key);
          return (
            <SettingsRow
              key={t.key}
              title={t.label}
              sub={t.hint}
              href={`/settings/notifications/${slug}/${t.key.toLowerCase()}`}
              right={
                <span className="flex gap-1.5">
                  {(s.subject || s.intro || s.text) && <Badge>Reworded</Badge>}
                  <Badge tone={s.off ? "red" : "green"}>{s.off ? "Off" : "On"}</Badge>
                </span>
              }
            />
          );
        })}
      </SettingsCard>
    </SettingsPage>
  );
}

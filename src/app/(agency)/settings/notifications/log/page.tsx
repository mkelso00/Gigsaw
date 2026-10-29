import type { Metadata } from "next";
import Link from "next/link";
import { MessageList } from "@/components/message-list";
import { SettingsCard, SettingsPage } from "@/components/settings-ui";
import { requireAdmin } from "@/lib/auth";
import { getSettings, prisma } from "@/lib/db";

export const metadata: Metadata = { title: "Message log" };
export const dynamic = "force-dynamic";

export default async function MessageLog() {
  const user = await requireAdmin();
  const [settings, messages] = await Promise.all([
    getSettings(user.agencyId!),
    prisma.message.findMany({ where: { agencyId: user.agencyId }, orderBy: { createdAt: "desc" }, take: 100 }),
  ]);
  return (
    <SettingsPage
      title="Message log"
      actions={
        <Link href="/settings/notifications" className="btn">
          Back to notifications
        </Link>
      }
    >
      <SettingsCard pad>
        <MessageList messages={messages} timezone={settings.defaultTimezone} />
      </SettingsCard>
    </SettingsPage>
  );
}

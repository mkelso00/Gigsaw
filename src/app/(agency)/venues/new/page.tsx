import type { Metadata } from "next";
import { createVenue } from "@/actions/crm";
import { VenueForm } from "@/components/crm-forms";
import { PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { getSettings } from "@/lib/db";

export const metadata: Metadata = { title: "Add venue" };

export default async function NewVenuePage() {
  await requireStaff();
  const settings = await getSettings();
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Add venue" />
      <VenueForm action={createVenue} defaultTimezone={settings.defaultTimezone} />
    </div>
  );
}

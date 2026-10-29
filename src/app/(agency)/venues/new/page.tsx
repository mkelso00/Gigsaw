import type { Metadata } from "next";
import { createVenue } from "@/actions/crm";
import { VenueForm } from "@/components/crm-forms";
import { PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { getSettings, prisma } from "@/lib/db";
import { suggestVenueColour } from "@/lib/rota";

export const metadata: Metadata = { title: "Add venue" };

export default async function NewVenuePage() {
  const user = await requireStaff();
  const [settings, existing] = await Promise.all([
    getSettings(user.agencyId),
    prisma.venue.findMany({ where: { agencyId: user.agencyId }, select: { id: true, colour: true } }),
  ]);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Add venue" />
      <VenueForm action={createVenue} defaultTimezone={settings.defaultTimezone} suggestedColour={suggestVenueColour(existing)} />
    </div>
  );
}

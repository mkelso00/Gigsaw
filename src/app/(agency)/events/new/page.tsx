import type { Metadata } from "next";
import { createEvent } from "@/actions/events";
import { EventForm } from "@/components/event-form";
import { PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { eventFormOptions } from "@/lib/event-options";

export const metadata: Metadata = { title: "New wedding or event" };

export default async function NewEventPage({ searchParams }: { searchParams: Promise<{ date?: string; customerId?: string }> }) {
  const user = await requireStaff();
  const sp = await searchParams;
  const options = await eventFormOptions(user.agencyId);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="New wedding or event"
        subtitle="One booking for the customer. Next you'll add each act (ceremony singer, band, DJ…), each with its own times, sale and cost."
      />
      <div className="card card-pad">
        <EventForm action={createEvent} values={{ date: sp.date, customerId: sp.customerId }} {...options} submitLabel="Create and add acts" />
      </div>
    </div>
  );
}

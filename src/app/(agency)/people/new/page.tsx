import type { Metadata } from "next";
import { createPerson } from "@/actions/people";
import { ContactsTabs } from "@/components/contacts-tabs";
import { PersonForm } from "@/components/person-form";
import { PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { personFormOptions } from "@/lib/people";

export const metadata: Metadata = { title: "Add a person" };

/** Add a person. ?actId= or ?venueId= / ?companyId= pre-fill their act or company. */
export default async function NewPersonPage({ searchParams }: { searchParams: Promise<{ actId?: string; venueId?: string; companyId?: string }> }) {
  const user = await requireStaff();
  const sp = await searchParams;
  const [options, act, venue, company] = await Promise.all([
    personFormOptions(user.agencyId),
    sp.actId ? prisma.artist.findFirst({ where: { id: sp.actId, agencyId: user.agencyId }, select: { id: true, name: true } }) : null,
    sp.venueId ? prisma.venue.findFirst({ where: { id: sp.venueId, agencyId: user.agencyId }, select: { id: true, name: true } }) : null,
    sp.companyId ? prisma.contact.findFirst({ where: { id: sp.companyId, agencyId: user.agencyId }, select: { id: true, name: true, company: true } }) : null,
  ]);
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Add a new person" subtitle="A musician, a venue manager, someone at a promoter: anyone you work with." />
      <ContactsTabs active="people" />
      <PersonForm
        action={createPerson}
        values={{
          company: venue?.name ?? (company ? company.company || company.name : undefined),
          acts: act ? [{ name: act.name, jobTitle: "" }] : undefined,
        }}
        {...options}
        submitLabel="Add this person"
        cancelHref={act ? `/artists/${act.id}` : venue ? `/venues/${venue.id}` : "/people"}
      />
    </div>
  );
}

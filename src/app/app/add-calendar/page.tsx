import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AddCalendarStep } from "@/components/add-calendar-step";
import { CalendarConnect } from "@/components/calendar-connect";
import { YourCalendar } from "@/components/your-calendar";
import { needsPayDetails } from "@/lib/act-details-server";
import { needsCalendar } from "@/lib/act-calendar-step";
import { requireUser } from "@/lib/auth";
import { calendarProviders, canConnectCalendar } from "@/lib/calendar-connect";
import { prisma } from "@/lib/db";
import { personName } from "@/lib/person-name";

export const metadata: Metadata = { title: "Add your gigs to your calendar" };
export const dynamic = "force-dynamic";

// The step after Your details: every other page of the act app sends the act here until their gigs are in a
// calendar (requireActApp; what counts is in src/lib/act-calendar-step.ts).
export default async function AddCalendarPage() {
  const user = await requireUser(["ARTIST"]);
  if (await needsPayDetails(user)) redirect("/app/details");
  if (!(await needsCalendar(user.id))) redirect("/app");

  const owner = user.personId
    ? await prisma.person.findFirst({ where: { id: user.personId, agencyId: user.agencyId }, select: { calendarToken: true, firstName: true, surname: true, alias: true } })
    : user.artistId
      ? await prisma.artist.findFirst({ where: { id: user.artistId, agencyId: user.agencyId }, select: { calendarToken: true, name: true } })
      : null;
  if (!owner) redirect("/app");
  const name = "name" in owner ? owner.name : personName(owner);
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const feedUrl = `${proto}://${host}/api/calendar/${owner.calendarToken}.ics`;
  const providers = canConnectCalendar(user) ? calendarProviders() : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[28px] leading-tight font-semibold tracking-tight">Add your gigs to your calendar</h1>
        <p className="mt-2 text-[15px] text-ink-300">
          Every gig goes straight into the calendar on your phone, with the times, venue and your fee, and it updates by itself when anything changes.
          It&apos;s the last step.
        </p>
      </div>
      <AddCalendarStep>
        {providers.length ? (
          <YourCalendar connections={[]} providers={providers} feedUrl={feedUrl} feedName={`${name} bookings`} notice={{}} />
        ) : (
          <CalendarConnect feedUrl={feedUrl} name={`${name} bookings`} />
        )}
      </AddCalendarStep>
    </div>
  );
}

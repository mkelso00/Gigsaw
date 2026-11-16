"use server";

import { redirect } from "next/navigation";
import { markCalendarAdded } from "@/lib/act-calendar-step";
import { requireUser } from "@/lib/auth";

/** "I've added it": for calendars that take a while to fetch the gigs for the first time (Google can take hours). */
export async function confirmCalendarAdded() {
  const user = await requireUser(["ARTIST"]);
  await markCalendarAdded(user.id);
  redirect("/app");
}

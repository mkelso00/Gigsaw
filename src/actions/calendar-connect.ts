"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { chooseCalendar, disconnectCalendar, ListNotAllowed, ReconnectNeeded } from "@/lib/calendar-connect";
import { str, type FormState } from "@/lib/forms";
import { log } from "@/server/log";

// The act app's "Your calendar": disconnect, and choose which calendar gigs go in. Connecting is a link to
// /api/calendar-connect/<provider>, because it leaves Gigsaw for Google or Microsoft.

/** Disconnect one of your calendars. Open even while the business is paused: anyone can always take access back. */
export async function disconnectMyCalendar(connectionId: string) {
  const user = await requireUser(["ARTIST"], { allowLocked: true });
  const provider = await disconnectCalendar(user.id, connectionId);
  revalidatePath("/app");
  redirect(provider ? `/app?calendar=disconnected&p=${provider}#calendar` : "/app#calendar");
}

/** Choose which of your calendars your gigs go in. */
export async function chooseMyCalendar(connectionId: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser(["ARTIST"]);
  const calendarId = str(form, "calendarId");
  if (!calendarId) return { error: "Choose a calendar." };
  try {
    const done = await chooseCalendar(user.id, connectionId, calendarId);
    if ("error" in done) return { error: done.error };
    revalidatePath("/app");
    revalidatePath("/app/calendar");
    return { ok: done.ok };
  } catch (e) {
    if (e instanceof ReconnectNeeded) return { error: "Gigsaw can't reach your calendar any more. Reconnect it, then choose again." };
    if (e instanceof ListNotAllowed) return { error: "Gigsaw isn't allowed to see your list of calendars. Reconnect and tick every box to choose one." };
    log.warn("Choosing a calendar failed", { err: e, connectionId });
    return { error: "Your calendar didn't answer. Please try again in a minute." };
  }
}

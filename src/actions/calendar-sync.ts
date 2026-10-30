"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { handleForm, type FormState } from "@/lib/forms";
import { TEAM_FEED_STATUSES } from "@/lib/team-calendar";

const newToken = () => randomBytes(24).toString("base64url");

/** Choose what goes in your calendar feed. The first save makes your private link. */
export async function saveCalendarSync(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  return handleForm(async () => {
    const scope = form.get("scope") === "ALL" ? "ALL" : "MINE";
    const picked = form.getAll("status").map(String);
    const statuses = TEAM_FEED_STATUSES.filter((s) => picked.includes(s));
    await prisma.user.update({
      where: { id: user.id },
      data: {
        calendarScope: scope,
        // None or all ticked both mean "every status"; saved as blank so new statuses are included too.
        calendarStatuses: statuses.length === TEAM_FEED_STATUSES.length ? "" : statuses.join(","),
        calendarToken: user.calendarToken ?? newToken(),
      },
    });
    revalidatePath("/profile");
    return { ok: user.calendarToken ? "Saved. Your calendar picks this up next time it checks." : "Your calendar link is ready." };
  });
}

/** A new link: the old one stops working straight away (e.g. if it was shared by mistake). */
export async function resetCalendarLink() {
  const user = await requireStaff();
  await prisma.user.update({ where: { id: user.id }, data: { calendarToken: newToken() } });
  revalidatePath("/profile");
}

export async function turnOffCalendarSync() {
  const user = await requireStaff();
  await prisma.user.update({ where: { id: user.id }, data: { calendarToken: null } });
  revalidatePath("/profile");
}

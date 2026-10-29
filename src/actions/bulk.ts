"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { applyBulkChange } from "@/lib/bulk";
import { handleForm, int, str, type FormState } from "@/lib/forms";

const TIME = /^\d{2}:\d{2}$/;

export async function bulkUpdateBookings(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  return handleForm(async () => {
    const ids = form.getAll("ids").filter((v): v is string => typeof v === "string");
    const t = (k: string) => (TIME.test(str(form, k)) ? str(form, k) : undefined);
    const res = await applyBulkChange(user, ids, {
      times: { arrive: t("arriveTime"), soundcheck: t("soundcheckTime"), setStart: t("setStartTime"), setEnd: t("setEndTime") },
      shiftMinutes: int(form, "shiftMinutes") ?? undefined,
      fee: str(form, "fee") || undefined,
      cost: str(form, "cost") || undefined,
      notifyArtists: str(form, "notifyArtists") === "on",
    });
    revalidatePath("/", "layout");
    return {
      ok: `Updated ${res.updated} gig${res.updated === 1 ? "" : "s"}.${form.get("notifyArtists") ? ` ${res.notified} artist message${res.notified === 1 ? "" : "s"} sent about the changes.` : ""}${
        res.mayClash.length ? ` Check ${res.mayClash.join(", ")}: the new times may clash with the artist's other gigs.` : ""
      }`,
    };
  });
}

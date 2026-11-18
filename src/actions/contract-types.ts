"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { eventTypesFrom, termsText, usageLines } from "@/lib/contract-templates";
import {
  addContractTemplate,
  ContractTemplateError,
  contractTemplateUsage,
  deleteContractTemplate,
  updateContractTemplate,
} from "@/lib/contract-templates-server";
import { logActivity } from "@/lib/db";
import { confirmed, FormError, handleForm, ShownFormError, str, type FormState } from "@/lib/forms";

// Contract types, in Settings, Contracts and invoices: add, change and delete them. Admins only, like
// the rest of Settings. Each type is its own form on the page.

const PAGE = "/settings/documents";

/** Turn a ContractTemplateError (a message meant for the person) into a form message. */
async function templateForm(fn: () => Promise<FormState | void>): Promise<FormState> {
  return handleForm(async () => {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ContractTemplateError) throw new FormError(e.message);
      throw e;
    }
  });
}

/** "Add a contract type" (or "Add your first contract"): a new, empty type at the end of the list. */
export async function addContractType(): Promise<void> {
  const user = await requireAdmin();
  try {
    const t = await addContractTemplate(user.agencyId);
    await logActivity(user, "SETTINGS", user.agencyId, "added a contract type", t.name);
  } catch (e) {
    // Shown to the person by the ServerForm (a plain error would be hidden by Next).
    if (e instanceof ContractTemplateError) throw new ShownFormError(e.message);
    throw e;
  }
  revalidatePath(PAGE);
}

/** Save one contract type: its name, the event types it's used for, whether it's the default, and its wording. */
export async function saveContractType(id: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireAdmin();
  return templateForm(async () => {
    const t = await updateContractTemplate(user.agencyId, id, {
      name: str(form, "name"),
      terms: termsText(str(form, "terms")),
      eventTypes: eventTypesFrom(form.getAll("eventTypes").map(String)),
      makeDefault: form.get("isDefault") === "on",
    });
    await logActivity(user, "SETTINGS", user.agencyId, "updated a contract type", t.name);
    revalidatePath("/", "layout");
    return { ok: "Saved." };
  });
}

/**
 * Delete a contract type, after a check that says what still uses it. Proposals already sent and contracts
 * already signed keep their own copy of the wording, so they never change.
 */
export async function deleteContractType(id: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireAdmin();
  return templateForm(async () => {
    if (!confirmed(form)) {
      const usage = usageLines(await contractTemplateUsage(user.agencyId, id));
      return {
        confirm: {
          title: usage.length ? "This contract type is in use. Delete it anyway?" : "Delete this contract type?",
          items: [...usage, "Proposals already sent and contracts already signed keep their own copy of the wording, so they don't change."],
          button: "Delete it",
        },
      };
    }
    const t = await deleteContractTemplate(user.agencyId, id);
    if (t) await logActivity(user, "SETTINGS", user.agencyId, "deleted a contract type", t.name);
    revalidatePath("/", "layout");
    return { ok: "Deleted." };
  });
}

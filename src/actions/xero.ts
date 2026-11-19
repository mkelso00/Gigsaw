"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { logActivity, prisma } from "@/lib/db";
import { FormError, handleForm, str, type FormState } from "@/lib/forms";
import {
  chooseXeroTenant,
  createDraftInvoice,
  disconnectXero,
  getInvoiceStatuses,
  getXeroOrganisation,
  isoDay,
  isXeroId,
  XERO_STATE_LABELS,
  XeroError,
  xeroConnectionFor,
  XeroReconnectNeeded,
  type XeroInvoiceLine,
  type XeroInvoiceState,
} from "@/lib/xero";
import { log } from "@/server/log";

// Xero for admins: the settings page's forms (Settings, Xero), and the two calls the monthly billing page makes,
// sendInvoiceToXero and syncXeroStatuses. Those take plain data, not Gigsaw records, so billing decides what goes
// on an invoice and keeps the Xero invoice id and status itself. Connecting is a link to /api/xero/connect,
// because it leaves Gigsaw for Xero. Every action works on the signed-in admin's own business only.

/** What went wrong with Xero, in words for the admin. Anything that isn't a Xero problem is thrown on. */
function xeroMessage(e: unknown): { error: string; reconnect?: boolean } {
  if (e instanceof XeroReconnectNeeded) return { error: e.message, reconnect: true };
  if (e instanceof XeroError) return { error: e.message };
  throw e;
}

async function connectionOrThrow(agencyId: string) {
  const conn = await xeroConnectionFor(agencyId);
  if (!conn) throw new FormError("Xero isn't connected. Connect it in Settings, Xero first.");
  return conn;
}

// ---------------------------------------------------------------------------------------------
// For the billing page

export type SendInvoiceToXeroInput = {
  /** The venue or company, as its Xero contact is (or will be) named, and the email Xero sends invoices to. */
  contactName: string;
  contactEmail?: string | null;
  /** The customer's PO number: the invoice's Reference in Xero. Blank uses the month label instead. */
  poNumber?: string | null;
  /** e.g. "October 2026": a heading line, "Gigs in October 2026", above the gigs. */
  monthLabel: string;
  /** One per gig, e.g. { description: "12 Oct, The Crown: Act name, 8pm to 11pm", unitAmountMinor: 25000 } (see gigLineDescription). Ex VAT. */
  lines: { description: string; quantity?: number; unitAmountMinor: number; taxType?: string; accountCode?: string }[];
  currency: string;
  /** "YYYY-MM-DD"; today when left out. */
  date?: string | null;
  /** "YYYY-MM-DD"; left out, the due days in Settings, Xero, or else Xero's terms for the contact. */
  dueDate?: string | null;
  /** Something unique to this bill (e.g. its id), so pressing Send twice doesn't make two invoices. */
  idempotencyKey?: string | null;
};

export type SendInvoiceToXeroResult =
  | { ok: true; invoiceId: string; invoiceNumber: string; status: string; url: string; subTotalMinor: number; taxMinor: number; totalMinor: number }
  | { ok: false; error: string; reconnect?: boolean };

/** Creates the month's invoice in the business's Xero as a draft, finding or adding the contact. Admins only. */
export async function sendInvoiceToXero(input: SendInvoiceToXeroInput): Promise<SendInvoiceToXeroResult> {
  const user = await requireAdmin();
  try {
    const conn = await connectionOrThrow(user.agencyId);
    if (!input.lines?.length) throw new FormError("There are no gigs on this invoice.");
    const month = (input.monthLabel ?? "").trim();
    const lines: XeroInvoiceLine[] = [...(month ? [{ description: `Gigs in ${month}` }] : []), ...input.lines];
    const made = await createDraftInvoice(conn, {
      contactName: input.contactName ?? "",
      contactEmail: input.contactEmail,
      reference: (input.poNumber ?? "").trim() || month,
      date: input.date || isoDay(new Date()),
      dueDate: input.dueDate || null,
      lines,
      currency: input.currency ?? "",
      idempotencyKey: input.idempotencyKey ? `gigsaw-${user.agencyId}-${input.idempotencyKey}` : undefined,
    });
    await logActivity(user, "XERO", made.invoiceId, "sent an invoice to Xero", [made.invoiceNumber, input.contactName, month].filter(Boolean).join(", "));
    return { ok: true, ...made };
  } catch (e) {
    if (e instanceof FormError) return { ok: false, error: e.message };
    const m = xeroMessage(e);
    log.warn("Sending an invoice to Xero failed", { agencyId: user.agencyId, reason: m.error });
    return { ok: false, ...m };
  }
}

export type XeroStatusResult =
  | {
      id: string;
      xeroInvoiceId: string;
      ok: true;
      invoiceNumber: string;
      /** Xero's own: DRAFT, SUBMITTED, AUTHORISED, PAID, VOIDED or DELETED. */
      status: string;
      state: XeroInvoiceState;
      label: string;
      amountDueMinor: number;
      amountPaidMinor: number;
      totalMinor: number;
      fullyPaidOn: string | null;
    }
  | { id: string; xeroInvoiceId: string; ok: false; error: string };

/** Up to this many in one go, so a sync stays well inside Xero's 60 calls a minute (40 invoices a call). */
const MAX_SYNC = 400;

/**
 * Reads back what Xero says about each invoice: paid, part paid, voided and so on. `id` is the caller's own (e.g. the
 * bill's) and comes back with each answer. Admins only.
 */
export async function syncXeroStatuses(
  items: { id: string; xeroInvoiceId: string }[],
): Promise<{ ok: true; results: XeroStatusResult[] } | { ok: false; error: string; reconnect?: boolean }> {
  const user = await requireAdmin();
  try {
    const conn = await connectionOrThrow(user.agencyId);
    const list = (items ?? []).slice(0, MAX_SYNC);
    const found = await getInvoiceStatuses(
      conn,
      list.map((i) => i.xeroInvoiceId),
    );
    const results: XeroStatusResult[] = list.map(({ id, xeroInvoiceId }) => {
      if (!isXeroId(xeroInvoiceId ?? "")) return { id, xeroInvoiceId, ok: false, error: "Not sent to Xero yet." };
      const s = found.get(xeroInvoiceId.toLowerCase());
      if (!s) return { id, xeroInvoiceId, ok: false, error: "Xero couldn't find this invoice in the connected organisation." };
      return {
        id,
        xeroInvoiceId,
        ok: true,
        invoiceNumber: s.invoiceNumber,
        status: s.status,
        state: s.state,
        label: XERO_STATE_LABELS[s.state],
        amountDueMinor: s.amountDueMinor,
        amountPaidMinor: s.amountPaidMinor,
        totalMinor: s.totalMinor,
        fullyPaidOn: s.fullyPaidOn,
      };
    });
    return { ok: true, results };
  } catch (e) {
    if (e instanceof FormError) return { ok: false, error: e.message };
    return { ok: false, ...xeroMessage(e) };
  }
}

// ---------------------------------------------------------------------------------------------
// Settings, Xero

const ACCOUNT_CODE = /^[A-Za-z0-9.-]{1,10}$/;
const TAX_TYPE = /^[A-Za-z0-9]{1,50}$/;

/** The sales account, tax rate and due days new invoices use. */
export async function saveXeroSettings(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireAdmin();
  return handleForm(async () => {
    const salesAccountCode = str(form, "salesAccountCode");
    const taxType = str(form, "taxType").toUpperCase();
    const rawDue = str(form, "dueDays");
    if (!ACCOUNT_CODE.test(salesAccountCode)) throw new FormError("Enter the sales account's code from your Xero chart of accounts, like 200.");
    if (!TAX_TYPE.test(taxType)) throw new FormError("Choose the tax rate, like OUTPUT2 for 20% VAT on income.");
    let dueDays: number | null = null;
    if (rawDue) {
      dueDays = Number(rawDue);
      if (!Number.isInteger(dueDays) || dueDays < 0 || dueDays > 365) throw new FormError("Days to pay must be a whole number from 0 to 365, or blank.");
    }
    const data = { salesAccountCode, taxType, dueDays };
    await prisma.xeroConnection.upsert({ where: { agencyId: user.agencyId }, create: { agencyId: user.agencyId, ...data }, update: data });
    await logActivity(user, "SETTINGS", user.agencyId, "changed the Xero invoice settings", `account ${salesAccountCode}, tax ${taxType}`);
    revalidatePath("/settings/xero");
    return { ok: "Saved" };
  });
}

/** Send invoices to another of the organisations allowed when connecting. */
export async function chooseXeroOrganisation(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireAdmin();
  return handleForm(async () => {
    try {
      const t = await chooseXeroTenant(user.agencyId, str(form, "tenantId"));
      await logActivity(user, "SETTINGS", user.agencyId, "chose the Xero organisation", t.tenantName);
      revalidatePath("/settings/xero");
      return { ok: `Invoices now go to ${t.tenantName}.` };
    } catch (e) {
      if (e instanceof XeroError) throw new FormError(e.message);
      throw e;
    }
  });
}

/** "Test the connection": reads the organisation from Xero, a cheap call that needs working tokens. */
export async function testXeroConnection(_: FormState): Promise<FormState> {
  const user = await requireAdmin();
  return handleForm(async () => {
    const conn = await connectionOrThrow(user.agencyId);
    try {
      const org = await getXeroOrganisation(conn);
      revalidatePath("/settings/xero");
      const extra = [org.countryCode, org.baseCurrency].filter(Boolean).join(", ");
      return { ok: `Connected to ${org.name}${extra ? ` (${extra})` : ""}. Xero answered straight away.` };
    } catch (e) {
      revalidatePath("/settings/xero");
      throw new FormError(xeroMessage(e).error);
    }
  });
}

/** Disconnect Xero: Xero is asked to take back the access, and Gigsaw forgets the tokens. Invoice settings are kept. */
export async function disconnectXeroAction() {
  const user = await requireAdmin();
  if (await disconnectXero(user.agencyId)) await logActivity(user, "SETTINGS", user.agencyId, "disconnected Xero");
  revalidatePath("/settings/xero");
  redirect("/settings/xero?xero=disconnected");
}

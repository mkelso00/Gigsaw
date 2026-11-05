"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { requireStaff } from "@/lib/auth";
import { EVENT_TYPES } from "@/lib/constants";
import { checkSignerName, clientIp, checkSignature } from "@/lib/contract-doc";
import { logActivity, prisma } from "@/lib/db";
import { isRealDate } from "@/lib/enquiries";
import { FormError, handleForm, oneOf, str, type FormState } from "@/lib/forms";
import { formatMoney } from "@/lib/money";
import {
  acceptQuote,
  afterAccepted,
  afterDeclined,
  createDraftQuote,
  declineQuote,
  depositLinkFor,
  newQuoteVersion,
  QuoteError,
  publishQuote,
  sendQuote,
} from "@/lib/quote-server";
import { canWithdraw, looksLikeQuoteToken, parseAmount, parseQuoteLines, quoteRef, quoteTotals } from "@/lib/quotes";
import { localDateKey } from "@/lib/time";
import { log } from "@/server/log";

// Quotes: staff make, change, send and withdraw them; the customer accepts or declines at
// /q/<token> with no login. Every staff lookup includes the agency.

/** Turn a QuoteError (a message meant for the person) into a form message. */
async function quoteForm(fn: () => Promise<FormState | void>): Promise<FormState> {
  return handleForm(async () => {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof QuoteError) throw new FormError(e.message);
      throw e;
    }
  });
}

/** "Make a quote" on an enquiry or a customer: a draft, filled in from the enquiry, opened in the editor. */
export async function makeQuote(from: "enquiry" | "contact", id: string, _: FormState): Promise<FormState> {
  const user = await requireStaff();
  let quoteId = "";
  const res = await quoteForm(async () => {
    const q = await createDraftQuote(user, from === "enquiry" ? { enquiryId: id } : { contactId: id });
    await logActivity(user, "QUOTE", q.id, `started quote ${quoteRef(q)}`, q.title);
    quoteId = q.id;
  });
  if (res?.error) return res;
  revalidatePath("/", "layout");
  redirect(`/quotes/${quoteId}/edit`);
}

/** Save the draft from the editor. Only a draft can be changed: a sent quote gets a new version first. */
export async function saveQuote(quoteId: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  const res = await quoteForm(async () => {
    const q = await prisma.quote.findFirst({ where: { id: quoteId, agencyId: user.agencyId } });
    if (!q) throw new FormError("Quote not found");
    if (q.status !== "DRAFT" || q.supersededById) throw new FormError("This quote has been sent, so it can't be changed. Make a new version instead.");
    const [acts, venues] = await Promise.all([
      prisma.artist.findMany({ where: { agencyId: user.agencyId }, select: { id: true } }),
      prisma.venue.findMany({ where: { agencyId: user.agencyId }, select: { id: true } }),
    ]);
    const lines = parseQuoteLines(str(form, "lines"), q.currency, {
      artistIds: new Set(acts.map((a) => a.id)),
      venueIds: new Set(venues.map((v) => v.id)),
    });
    const title = str(form, "title").slice(0, 120);
    if (!title) throw new FormError("Give the quote a name, like Hannah and Sam's wedding");
    const eventType = oneOf(str(form, "eventType"), EVENT_TYPES, "WEDDING");
    const bookingFeeMinor = parseAmount(str(form, "bookingFee"), q.currency, "booking fee") ?? 0;
    const depositMinor = parseAmount(str(form, "deposit"), q.currency, "deposit") ?? 0;
    const today = localDateKey(new Date(), q.timezone);
    const depositDue = str(form, "depositDue");
    if (depositDue && !isRealDate(depositDue)) throw new FormError("Check the deposit due date");
    const validUntil = str(form, "validUntil");
    if (validUntil && !isRealDate(validUntil)) throw new FormError("Check the valid-until date");
    if (validUntil && validUntil < today) throw new FormError("The valid-until date has already passed");
    const total = quoteTotals(lines, bookingFeeMinor).totalMinor;
    if (depositMinor > total) throw new FormError(`The deposit can't be more than the total (${formatMoney(total, q.currency)})`);

    await prisma.$transaction(async (tx) => {
      // Only while it's still a draft: if it was sent from another tab meanwhile, nothing changes.
      const claimed = await tx.quote.updateMany({
        where: { id: q.id, agencyId: user.agencyId, status: "DRAFT", supersededById: null },
        data: {
          title,
          eventType,
          bookingFeeMinor,
          depositMinor,
          depositDue: depositMinor > 0 && depositDue ? depositDue : null,
          validUntil: validUntil || null,
          tellActs: form.get("tellActs") === "on",
          message: str(form, "message").slice(0, 3000),
          terms: str(form, "terms").slice(0, 20000),
        },
      });
      if (claimed.count !== 1) throw new FormError("This quote has just been sent, so it can't be changed. Make a new version instead.");
      await tx.quoteLine.deleteMany({ where: { quoteId: q.id } });
      if (lines.length) await tx.quoteLine.createMany({ data: lines.map((l, i) => ({ ...l, quoteId: q.id, sort: i })) });
    });
    await logActivity(user, "QUOTE", q.id, `saved quote ${quoteRef(q)}`, title);
  });
  if (res?.error) return res;
  revalidatePath("/", "layout");
  redirect(`/quotes/${quoteId}`);
}

/** Send the quote (or send the same one again) to the customer by email. */
export async function sendQuoteNow(quoteId: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  return quoteForm(async () => {
    const r = await sendQuote(user, quoteId, str(form, "to"));
    await logActivity(user, "QUOTE", quoteId, r.resent ? `sent quote ${quoteRef(r.quote)} again` : `sent quote ${quoteRef(r.quote)}`, str(form, "to"));
    revalidatePath("/", "layout");
    return { ok: `Quote ${r.resent ? "sent again" : "sent"} to ${str(form, "to").toLowerCase()}.` };
  });
}

/** Give the quote its customer link without emailing it, for staff to send themselves. */
export async function getQuoteLink(quoteId: string, _: FormState): Promise<FormState> {
  const user = await requireStaff();
  return quoteForm(async () => {
    const q = await publishQuote(user, quoteId);
    await logActivity(user, "QUOTE", quoteId, `made a link for quote ${quoteRef(q)}`);
    revalidatePath("/", "layout");
    return { ok: "Your link is ready. Copy it and send it to the customer." };
  });
}

/** Withdraw a quote that's out with the customer: its link then only says so. */
export async function withdrawQuote(quoteId: string) {
  const user = await requireStaff();
  const q = await prisma.quote.findFirst({ where: { id: quoteId, agencyId: user.agencyId } });
  if (!q || !canWithdraw(q)) return;
  const done = await prisma.quote.updateMany({
    where: { id: q.id, agencyId: user.agencyId, supersededById: null, status: { in: ["SENT", "VIEWED", "EXPIRED"] } },
    data: { status: "WITHDRAWN", withdrawnAt: new Date() },
  });
  if (done.count) await logActivity(user, "QUOTE", q.id, `withdrew quote ${quoteRef(q)}`, q.title);
  revalidatePath("/", "layout");
}

/** Change a quote that's been sent, or quote again after a decline: a new version, opened in the editor. */
export async function newVersion(quoteId: string, _: FormState): Promise<FormState> {
  const user = await requireStaff();
  let nextId = "";
  const res = await quoteForm(async () => {
    const next = await newQuoteVersion(user, quoteId);
    await logActivity(user, "QUOTE", next.id, `made version ${next.version} of quote ${next.number}`, next.title);
    nextId = next.id;
  });
  if (res?.error) return res;
  revalidatePath("/", "layout");
  redirect(`/quotes/${nextId}/edit`);
}

/** Delete a draft. If it was a new version of a sent quote, the sent one's link works again. */
export async function deleteDraftQuote(quoteId: string) {
  const user = await requireStaff();
  const q = await prisma.quote.findFirst({
    where: { id: quoteId, agencyId: user.agencyId, status: "DRAFT" },
    include: { supersedes: { select: { id: true } } },
  });
  if (!q) return;
  await prisma.quote.deleteMany({ where: { id: q.id, agencyId: user.agencyId, status: "DRAFT" } });
  await logActivity(user, "QUOTE", q.id, `deleted the draft of quote ${quoteRef(q)}`, q.title);
  revalidatePath("/", "layout");
  redirect(
    q.supersedes ? `/quotes/${q.supersedes.id}` : q.enquiryId ? `/enquiries?view=quotes` : q.contactId ? `/contacts/${q.contactId}` : "/enquiries?view=quotes",
  );
}

// ---------- The customer's answer (public link, no login) ----------

async function answerFrom(form: FormData, field: string) {
  const h = await headers();
  return {
    note: str(form, field).slice(0, 2000),
    ip: clientIp((k) => h.get(k)),
    agent: (h.get("user-agent") ?? "").slice(0, 500),
  };
}

/** The customer accepts: their typed name, a drawn signature, a tick, and an optional message. */
export async function acceptQuoteAnswer(token: string, _: FormState, form: FormData): Promise<FormState> {
  if (!looksLikeQuoteToken(token)) return { error: "This link isn't valid." };
  const res = await quoteForm(async () => {
    const name = checkSignerName(str(form, "name"));
    if (!name) throw new FormError("Type your full name");
    const signature = checkSignature(str(form, "signature"));
    if (!signature) throw new FormError("Draw your signature in the box");
    if (form.get("agree") !== "on") throw new FormError("Tick the box to say you accept the quote");
    const done = await acceptQuote(token, { name, signature, ...(await answerFrom(form, "note")) });
    // A second tap (or another device) finds it already accepted: nothing more happens.
    if (!done) return;
    try {
      await depositLinkFor(done.quoteId);
    } catch (e) {
      log.error("Quote accepted, but the deposit link couldn't be made", { err: e });
    }
    after(() => afterAccepted(done.quoteId));
  });
  if (res?.error) return res;
  revalidatePath(`/q/${token}`);
  redirect(`/q/${token}`);
}

/** The customer declines, with a reason if they like. */
export async function declineQuoteAnswer(token: string, _: FormState, form: FormData): Promise<FormState> {
  if (!looksLikeQuoteToken(token)) return { error: "This link isn't valid." };
  const res = await quoteForm(async () => {
    const done = await declineQuote(token, { name: "", ...(await answerFrom(form, "reason")) });
    if (!done) return;
    const q = await prisma.quote.findUnique({ where: { token }, select: { id: true } });
    if (q) after(() => afterDeclined(q.id));
  });
  if (res?.error) return res;
  revalidatePath(`/q/${token}`);
  redirect(`/q/${token}`);
}

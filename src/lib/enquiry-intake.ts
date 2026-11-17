import "server-only";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { prisma } from "./db";
import { checkFormStamp, parseEnquiry, readEnquiryConfig, type EnquiryConfig } from "./enquiries";
import { clientIp, enquiryAttempts, enquirySecret, ipHash, MAX_PER_IP_PER_HOUR, notifyTeam, recordEnquiry, replyToCustomer } from "./enquiry-server";
import { FormError } from "./forms";
import { localDateKey } from "./time";
import { log } from "@/server/log";

// Taking an enquiry sent from a business's website: the Gigsaw form at /enquire/<slug>, or the
// business's own form on another site (Shopify, WordPress…) posting to /api/enquire/<slug>. Both go
// through here, so they share the same spam checks, rate limits, customer record and emails.

export const TOO_MANY = "We've had a few enquiries from you already. Please try again later, or contact us directly.";

/** Why an enquiry wasn't taken, for a form on another site to act on (e.g. "stale": get a fresh stamp and send again). */
export type IntakeCode = "off" | "busy" | "fast" | "stale" | "invalid";
export type IntakeResult = { ok: true } | { error: string; code: IntakeCode };

/**
 * A form on another site sends what it has: every field the API knows is read, whatever the
 * business's own Gigsaw form shows, and acts can be named rather than given by id.
 */
const API_FIELDS: EnquiryConfig["fields"] = {
  eventType: true,
  date: true,
  time: true,
  venue: true,
  guests: true,
  budget: true,
  acts: true,
  message: true,
};

export async function receiveWebsiteEnquiry(slug: string, form: FormData, h: Headers, opts: { api?: boolean } = {}): Promise<IntakeResult> {
  const settings = await prisma.settings.findUnique({ where: { enquirySlug: slug }, include: { agency: { select: { name: true, status: true } } } });
  if (!settings || !settings.enquiryOn || settings.agency.status !== "ACTIVE") {
    return { error: "This form isn't taking enquiries at the moment. Please contact us directly.", code: "off" };
  }
  const agencyId = settings.agencyId;
  const secret = await enquirySecret();
  const ip = ipHash(clientIp(h), secret);
  if (!enquiryAttempts.hit(ip)) return { error: TOO_MANY, code: "busy" };

  // A hidden box people never see or fill in: bots do. Bots (and forged time stamps) are told it
  // went, so they don't try again, but nothing is saved.
  const stamp = checkFormStamp(String(form.get("t") ?? ""), secret, Date.now());
  const trap = form.get("company_site");
  if ((typeof trap === "string" && trap) || stamp === "bad") return { ok: true };
  if (stamp === "fast") return { error: "That was quick! Please check your details, then send again.", code: "fast" };
  if (stamp === "old") return { error: "This page has been open a long time. Please copy your message, reload the page and send it again.", code: "stale" };

  const own = readEnquiryConfig(settings.enquiryForm);
  const config: EnquiryConfig = opts.api ? { ...own, fields: API_FIELDS } : own;
  const acts = config.fields.acts
    ? await prisma.artist.findMany({ where: { agencyId, demo: false }, select: { id: true, name: true }, orderBy: { name: "asc" } })
    : [];

  // From another site, acts come by name (as the customer typed or picked them). Ones on file are
  // linked to the enquiry; any others are kept in the message so nothing they asked for is lost.
  if (opts.api) {
    const asked = form.getAll("acts").filter((v): v is string => typeof v === "string" && !!v.trim());
    const byName = new Map(acts.map((a) => [a.name.trim().toLowerCase(), a.id]));
    const ids = new Set(acts.map((a) => a.id));
    const unknown: string[] = [];
    form.delete("acts");
    for (const a of asked.slice(0, 20)) {
      const id = ids.has(a) ? a : byName.get(a.trim().toLowerCase());
      if (id) form.append("acts", id);
      else unknown.push(a.trim().slice(0, 100));
    }
    if (unknown.length) {
      const note = `Act asked about: ${unknown.join(", ")}`;
      const msg = String(form.get("message") ?? "");
      form.set("message", msg ? `${note}\n\n${msg}` : note);
    }
  }

  let d;
  try {
    d = parseEnquiry(form, config, { today: localDateKey(new Date(), settings.defaultTimezone), acts });
  } catch (e) {
    if (e instanceof FormError) return { error: e.message, code: "invalid" };
    throw e;
  }

  const [fromIp, fromEmail] = await Promise.all([
    prisma.enquiry.count({ where: { ipHash: ip, createdAt: { gt: new Date(Date.now() - 3_600_000) } } }),
    prisma.enquiry.count({ where: { agencyId, email: d.email, createdAt: { gt: new Date(Date.now() - 10 * 60_000) } } }),
  ]);
  if (fromIp >= MAX_PER_IP_PER_HOUR) return { error: TOO_MANY, code: "busy" };
  // Pressed send twice, or sent the same thing again straight away: we've already got it.
  if (fromEmail >= 2) return { ok: true };

  const source = String(form.get("source") ?? "")
    .replace(/[^\w.\-/~%:]/g, "")
    .slice(0, 200);
  // The person looking after enquiries (if one is chosen) looks after what they make.
  const agentId = config.notify.startsWith("USER:")
    ? ((await prisma.user.findFirst({ where: { id: config.notify.slice(5), agencyId, role: { in: ["ADMIN", "AGENT"] } }, select: { id: true } }))?.id ?? null)
    : null;

  const enquiry = await recordEnquiry({ settings, d, channel: "WEBSITE", source, ipHash: ip, agentId });

  // Emails and phone notifications go once the customer has had their answer.
  after(async () => {
    try {
      await replyToCustomer(enquiry.id);
      await notifyTeam(enquiry.id);
    } catch (e) {
      log.error("Couldn't send the enquiry emails", { err: e });
    }
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

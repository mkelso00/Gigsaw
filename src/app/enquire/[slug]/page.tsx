import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";
import { submitEnquiry } from "@/actions/enquiries";
import { ActPicker, FrameHeight } from "@/components/enquiry-bits";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field } from "@/components/ui";
import { prisma } from "@/lib/db";
import { DEFAULT_INTRO, DEFAULT_THANKS, ENQUIRY_EVENT_TYPES, formStamp, LIMITS, readEnquiryConfig, SLUG, sourceFrom } from "@/lib/enquiries";
import { enquirySecret } from "@/lib/enquiry-server";
import { messageFor } from "@/lib/message-templates";
import { localDateKey } from "@/lib/time";

// The enquiry form a business puts on its own website, as a link or in a frame (?embed=1). No login.
// Framing is allowed for this page only (next.config.ts). It never shows prices or anything private.

export const dynamic = "force-dynamic";

const load = cache(async (slug: string) => {
  if (!slug || !SLUG.test(slug)) return null;
  const settings = await prisma.settings.findUnique({ where: { enquirySlug: slug }, include: { agency: { select: { name: true, status: true } } } });
  return settings && settings.agency.status === "ACTIVE" ? settings : null;
});

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const settings = await load((await params).slug);
  const brand = settings ? settings.agencyName || settings.agency.name : "";
  return { title: { absolute: brand ? `Send an enquiry · ${brand}` : "Send an enquiry" }, robots: { index: false, follow: false } };
}

export default async function EnquirePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const settings = await load(slug);
  if (!settings) notFound();
  const embed = sp.embed === "1";
  const brand = settings.agencyName || settings.agency.name;
  const config = readEnquiryConfig(settings.enquiryForm);
  const on = config.fields;

  const shell = (children: React.ReactNode, sent = false) => (
    <div className={embed ? "" : "min-h-screen bg-ink-50"}>
      {/* In a frame the page is only as tall as the form, and the website's own background shows round it. */}
      {embed && <style>{"html,body{min-height:0!important;background:transparent!important}"}</style>}
      <div data-enquiry-root className={`mx-auto max-w-2xl text-ink-950 ${embed ? "px-1 py-2" : "px-4 pt-8 pb-14 sm:pt-14"}`}>
        <header className="mb-6 flex items-center gap-3">
          {config.logoUrl ? (
            // A logo on the business's own site, of any size: an img keeps it simple.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={config.logoUrl} alt={brand} className="h-12 max-w-[180px] object-contain" />
          ) : (
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-ink-950 text-sm font-bold text-white">
              {brand
                .split(/\s+/)
                .map((w) => w[0])
                .join("")
                .slice(0, 2)
                .toUpperCase()}
            </span>
          )}
          {!config.logoUrl && <span className="text-[15px] font-semibold tracking-tight">{brand}</span>}
        </header>
        {children}
      </div>
      <FrameHeight sent={sent} />
    </div>
  );

  if (!settings.enquiryOn) {
    return shell(
      <div className="card card-pad">
        <h1 className="text-xl font-semibold tracking-tight">We&apos;re not taking enquiries here at the moment</h1>
        <p className="mt-2 text-ink-600">
          Please get in touch with {brand} directly
          {settings.agencyEmail ? (
            <>
              {" "}
              at{" "}
              <a href={`mailto:${settings.agencyEmail}`} className="link">
                {settings.agencyEmail}
              </a>
            </>
          ) : null}
          .
        </p>
      </div>,
    );
  }

  if (sp.sent === "1") {
    const copy = messageFor(settings.messageTemplates, "ENQUIRY_REPLY", {}).on;
    return shell(
      <div className="card card-pad text-center" role="status">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-2xl text-emerald-700" aria-hidden>
          ✓
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Thank you</h1>
        <p className="mx-auto mt-3 max-w-md whitespace-pre-line text-ink-600">{config.thanks || DEFAULT_THANKS}</p>
        {copy && <p className="mt-3 text-sm text-ink-500">We&apos;ve emailed you a copy of your enquiry.</p>}
      </div>,
      true,
    );
  }

  const h = await headers();
  const [secret, acts] = await Promise.all([
    enquirySecret(),
    on.acts
      ? prisma.artist.findMany({ where: { agencyId: settings.agencyId, demo: false }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 300 })
      : [],
  ]);
  const today = localDateKey(new Date(), settings.defaultTimezone);
  const hasEvent = on.eventType || on.date || on.venue || on.guests || on.budget;

  return shell(
    <>
      <div className="mb-6">
        <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.02em] sm:text-3xl">Send us an enquiry</h1>
        <p className="mt-2 whitespace-pre-line text-ink-600">{config.intro || DEFAULT_INTRO}</p>
      </div>
      <ActionForm action={submitEnquiry.bind(null, slug)} className="space-y-4">
        <input type="hidden" name="t" value={formStamp(Date.now(), secret)} />
        <input type="hidden" name="source" value={sourceFrom(h.get("referer"), h.get("host") ?? "")} />
        {embed && <input type="hidden" name="embed" value="1" />}
        {/* Bots fill this in; people never see it. */}
        <div aria-hidden="true" className="absolute -left-[10000px] h-px w-px overflow-hidden">
          <label>
            Leave this empty
            <input name="company_site" tabIndex={-1} autoComplete="off" />
          </label>
        </div>

        <section className="card card-pad space-y-4">
          <h2 className="section-title">About you</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Your name" className="sm:col-span-2">
              <input name="name" required maxLength={LIMITS.name} autoComplete="name" className="input" />
            </Field>
            <Field label="Email">
              <input name="email" type="email" required maxLength={LIMITS.email} autoComplete="email" inputMode="email" className="input" />
            </Field>
            <Field label="Phone" hint="So we can call you back">
              <input name="phone" type="tel" maxLength={LIMITS.phone} autoComplete="tel" className="input" />
            </Field>
          </div>
        </section>

        {hasEvent && (
          <section className="card card-pad space-y-4">
            <h2 className="section-title">Your event</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {on.eventType && (
                <Field label="Type of event" className="sm:col-span-2">
                  <select name="eventType" required defaultValue="" className="input">
                    <option value="" disabled>
                      Choose one
                    </option>
                    {ENQUIRY_EVENT_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              {on.date && (
                <Field label="Date">
                  <input name="date" type="date" required min={today} className="input" />
                </Field>
              )}
              {on.date && on.time && (
                <Field label="Start time" hint="Roughly is fine">
                  <input name="startTime" type="time" className="input" />
                </Field>
              )}
              {on.venue && (
                <Field label="Venue or town" className="sm:col-span-2">
                  <input name="venue" maxLength={LIMITS.venue} placeholder="e.g. The Old Barn, Chester" className="input" />
                </Field>
              )}
              {on.guests && (
                <Field label="Number of guests">
                  <input name="guests" inputMode="numeric" pattern="[0-9 ,]*" maxLength={7} placeholder="e.g. 120" className="input" />
                </Field>
              )}
              {on.budget && (
                <Field label="Budget" hint="Roughly, so we can suggest the right acts">
                  <input name="budget" maxLength={LIMITS.budget} placeholder="e.g. £1,500" className="input" />
                </Field>
              )}
            </div>
          </section>
        )}

        {on.acts && acts.length > 0 && (
          <section className="card card-pad space-y-3">
            <div>
              <h2 className="section-title">Acts you like</h2>
              <p className="mt-0.5 text-sm text-ink-500">Tick any that catch your eye. Not sure yet? Leave it to us.</p>
            </div>
            <ActPicker acts={acts} />
          </section>
        )}

        {on.message && (
          <section className="card card-pad">
            <Field label="Anything else?">
              <textarea
                name="message"
                rows={5}
                maxLength={LIMITS.message}
                placeholder="Tell us about the day, the music you love, timings, anything we should know"
                className="input"
              />
            </Field>
          </section>
        )}

        <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-ink-500 sm:order-first">We&apos;ll only use your details to reply to your enquiry.</p>
          <SubmitButton className="btn btn-primary h-12 w-full px-6 text-[15px] sm:w-auto" pendingText="Sending…">
            Send enquiry
          </SubmitButton>
        </div>
      </ActionForm>
    </>,
  );
}

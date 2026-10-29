import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { submitJoin } from "@/actions/join";
import { JoinMembers } from "@/components/join-members";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field } from "@/components/ui";
import { ACT_TYPES, ACT_TYPE_LABELS } from "@/lib/act-profile";
import { prisma } from "@/lib/db";

// The agency's private link for new acts: they fill in their details, members, links and bank
// details, and choose a password. The agency approves them before they can log in.

export const metadata: Metadata = { title: "Join", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function JoinPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ sent?: string }> }) {
  const { token } = await params;
  const { sent } = await searchParams;
  if (!token || token.length < 20) notFound();
  const settings = await prisma.settings.findUnique({ where: { joinToken: token }, include: { agency: { select: { name: true, status: true } } } });
  if (!settings || settings.agency.status !== "ACTIVE") notFound();
  const brand = settings.agencyName || settings.agency.name;

  if (sent) {
    return (
      <div className="min-h-screen bg-ink-50 px-4 py-16 text-ink-950">
        <div className="card card-pad mx-auto max-w-lg text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-2xl text-emerald-700">✓</div>
          <h1 className="text-2xl font-semibold tracking-tight">Thanks, that&apos;s sent</h1>
          <p className="mt-3 text-ink-600">
            {brand} will look over your details. Once you&apos;re approved we&apos;ll email you, and you can log in with your email and the password you chose.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ink-50 px-4 py-10 text-ink-950">
      <div className="mx-auto max-w-2xl">
        <div className="mb-8">
          <div className="text-sm font-medium text-ink-500">{brand}</div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Join our acts</h1>
          <p className="mt-2 text-ink-600">
            Tell us about your act. It takes about five minutes. Your bank details are only seen by {brand}, so we can pay you.
          </p>
        </div>

        <ActionForm action={submitJoin.bind(null, token)} className="space-y-6">
          {/* Bots fill this in; people never see it. */}
          <input name="website_confirm" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />

          <section className="card card-pad space-y-4">
            <h2 className="section-title">Your act</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Act name" hint="As you'd like it on the posters">
                <input name="actName" required className="input" />
              </Field>
              <Field label="Type of act">
                <select name="actType" defaultValue="SOLO" className="input">
                  {ACT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {ACT_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Style or genre" hint="e.g. acoustic covers, party band, Irish folk">
                <input name="genre" className="input" />
              </Field>
              <Field label="Where you're based" hint="Town or city">
                <input name="town" className="input" />
              </Field>
            </div>
          </section>

          <section className="card card-pad space-y-4">
            <div>
              <h2 className="section-title">You</h2>
              <p className="text-sm text-ink-500">The main contact for bookings. This is also your login.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Your name">
                <input name="contactName" required autoComplete="name" className="input" />
              </Field>
              <Field label="Mobile">
                <input name="phone" type="tel" required autoComplete="tel" className="input" />
              </Field>
              <Field label="Email" className="sm:col-span-2">
                <input name="email" type="email" required autoComplete="email" className="input" />
              </Field>
              <Field label="Choose a password" hint="At least 8 characters">
                <input name="password" type="password" required minLength={8} autoComplete="new-password" className="input" />
              </Field>
              <Field label="Password again">
                <input name="password2" type="password" required minLength={8} autoComplete="new-password" className="input" />
              </Field>
            </div>
          </section>

          <section className="card card-pad space-y-4">
            <div>
              <h2 className="section-title">Other members</h2>
              <p className="text-sm text-ink-500">Duos and bands: add everyone else in the act. Solo acts can skip this.</p>
            </div>
            <JoinMembers />
          </section>

          <section className="card card-pad space-y-4">
            <h2 className="section-title">Photos, videos and links</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Video" hint="A YouTube or Facebook link of you playing live">
                <input name="videoUrl" inputMode="url" placeholder="youtube.com/…" className="input" />
              </Field>
              <Field label="Photo" hint="A link to a good photo, e.g. Google Drive or Dropbox">
                <input name="photoUrl" inputMode="url" className="input" />
              </Field>
              <Field label="Instagram">
                <input name="instagram" placeholder="@yourname" className="input" />
              </Field>
              <Field label="Website">
                <input name="website" inputMode="url" className="input" />
              </Field>
              <Field label="Set list or songs you play" className="sm:col-span-2">
                <textarea name="setList" rows={4} className="input" />
              </Field>
            </div>
          </section>

          <section className="card card-pad space-y-4">
            <div>
              <h2 className="section-title">Fee and bank details</h2>
              <p className="text-sm text-ink-500">So we know what you usually charge and can pay you after each gig.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Your usual fee for a bar gig (£)" hint="A guide; each gig's fee is agreed with you">
                <input name="usualFee" inputMode="decimal" placeholder="0.00" className="input" />
              </Field>
              <Field label="Name on the account">
                <input name="bankAccountName" className="input" />
              </Field>
              <Field label="Sort code">
                <input name="bankSortCode" inputMode="numeric" placeholder="12-34-56" className="input" />
              </Field>
              <Field label="Account number">
                <input name="bankAccountNumber" inputMode="numeric" placeholder="12345678" className="input" />
              </Field>
              <label className="flex items-center gap-3 sm:col-span-2">
                <input type="checkbox" name="vatRegistered" className="h-4 w-4 accent-ink-950" />
                <span className="text-sm font-medium">I&apos;m VAT registered</span>
              </label>
              <Field label="VAT number" hint="Only if you're VAT registered">
                <input name="vatNumber" className="input" />
              </Field>
            </div>
          </section>

          <section className="card card-pad space-y-4">
            <Field label="Anything else we should know?" hint="Equipment, travel, days you can't do, and so on">
              <textarea name="notes" rows={3} className="input" />
            </Field>
            <SubmitButton pendingText="Sending…">Send my details</SubmitButton>
          </section>
        </ActionForm>
      </div>
    </div>
  );
}

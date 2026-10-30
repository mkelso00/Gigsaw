import type { Metadata } from "next";
import Link from "next/link";
import { saveEnquiryForm } from "@/actions/enquiries";
import { CopyBlock, CopyField } from "@/components/client-bits";
import { ActionForm } from "@/components/forms";
import { Badge, SettingsCard, SettingsPage, SettingsRow, SettingsSection, SettingsToggle } from "@/components/settings-ui";
import { Field } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { getSettings, prisma } from "@/lib/db";
import { DEFAULT_INTRO, DEFAULT_THANKS, embedSnippet, ENQUIRY_FIELDS, readEnquiryConfig, slugify } from "@/lib/enquiries";
import { messageFor } from "@/lib/message-templates";
import { appUrl } from "@/lib/messaging";

export const metadata: Metadata = { title: "Enquiry form" };

export default async function EnquiryFormSettings() {
  const user = await requireAdmin();
  const settings = await getSettings(user.agencyId!);
  const config = readEnquiryConfig(settings.enquiryForm);
  const team = await prisma.user.findMany({
    where: { agencyId: user.agencyId, role: { in: ["ADMIN", "AGENT"] } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, role: true },
  });
  const url = settings.enquirySlug ? `${appUrl()}/enquire/${settings.enquirySlug}` : null;
  const reply = messageFor(settings.messageTemplates, "ENQUIRY_REPLY", {});
  const businessEmail = settings.agencyEmail || settings.alertEmail;

  return (
    <SettingsPage title="Enquiry form">
      <p className="-mt-5 text-sm text-ink-500">
        A form for your own website. New customers send their event details; you get a new customer, an Enquiry booking (or a wedding) and a note of what they
        asked, all under{" "}
        <Link href="/enquiries" className="link">
          Enquiries
        </Link>
        .
      </p>

      {url && settings.enquiryOn && (
        <SettingsSection title="Your form" description="Share the link, or put the form on your website with the code below.">
          <SettingsCard pad className="space-y-5">
            <div>
              <span className="label">Link</span>
              <CopyField value={url} />
              <a href={url} target="_blank" rel="noreferrer" className="link mt-2 inline-block text-sm">
                Open the form
              </a>
            </div>
            <div>
              <span className="label">Code for your website</span>
              <p className="hint mt-0 mb-2">
                Paste it where the form should go (in WordPress, Squarespace or Wix, use a Custom HTML or Embed block). The form grows to fit, so there&apos;s
                no scroll bar inside it.
              </p>
              <CopyBlock value={embedSnippet(url)} />
            </div>
          </SettingsCard>
        </SettingsSection>
      )}

      <ActionForm action={saveEnquiryForm} saveBar className="space-y-9">
        <SettingsSection>
          <SettingsCard>
            <SettingsToggle
              name="enquiryOn"
              defaultChecked={settings.enquiryOn}
              label="Take enquiries with the form"
              hint="Switched off, the form says you're not taking enquiries there and gives your business email instead."
            >
              <div className="p-5">
                <Field label="Web address" hint="Small letters, numbers and dashes. Changing it stops the old link working.">
                  <div className="flex items-center gap-2">
                    <span className="hidden shrink-0 text-sm text-ink-500 sm:inline">{appUrl().replace(/^https?:\/\//, "")}/enquire/</span>
                    <input
                      name="slug"
                      defaultValue={settings.enquirySlug ?? slugify(settings.agencyName)}
                      pattern="[a-z0-9][a-z0-9\-]{1,38}[a-z0-9]"
                      autoCapitalize="none"
                      spellCheck={false}
                      className="input"
                    />
                  </div>
                </Field>
              </div>
            </SettingsToggle>
          </SettingsCard>
        </SettingsSection>

        <SettingsSection title="What it asks" description="Name, email and phone are always asked for. Switch off anything you don't need.">
          <SettingsCard>
            {ENQUIRY_FIELDS.map((f) => (
              <label key={f.key} className="flex cursor-pointer items-start justify-between gap-4 px-5 py-4 hover:bg-ink-50">
                <span>
                  <span className="block text-sm font-medium text-ink-950">{f.label}</span>
                  {"hint" in f && <span className="mt-0.5 block text-sm text-ink-500">{f.hint}</span>}
                  {f.key === "time" && <span className="mt-0.5 block text-sm text-ink-500">Only asked when the date is.</span>}
                </span>
                <input type="checkbox" name={`field:${f.key}`} defaultChecked={config.fields[f.key]} className="switch mt-0.5" />
              </label>
            ))}
          </SettingsCard>
          <p className="mt-3 text-sm text-ink-500">
            With a date, weddings come in as a wedding (under Weddings &amp; events, automatic emails off until you switch them on) and anything else as an
            Enquiry booking with no act yet.
          </p>
        </SettingsSection>

        <SettingsSection title="Wording and look">
          <SettingsCard pad>
            <div className="grid gap-4">
              <Field label="Line under the heading" hint="Leave empty for our wording">
                <textarea name="intro" rows={2} maxLength={300} defaultValue={config.intro} placeholder={DEFAULT_INTRO} className="input" />
              </Field>
              <Field label="Thank-you message" hint="Shown once they've sent it. Leave empty for our wording.">
                <textarea name="thanks" rows={3} maxLength={1000} defaultValue={config.thanks} placeholder={DEFAULT_THANKS} className="input" />
              </Field>
              <Field label="Logo" hint="A link to your logo image, starting https://. Without one, your business name is shown.">
                <input name="logoUrl" type="url" defaultValue={config.logoUrl} placeholder="https://" className="input" />
              </Field>
            </div>
          </SettingsCard>
        </SettingsSection>

        <SettingsSection
          title="Who hears about new enquiries"
          description="By email, and as a phone notification for anyone who's turned those on in their Profile."
        >
          <SettingsCard pad>
            <Field
              label="Tell"
              hint="Each person can switch these emails or phone notifications off for themselves in their Profile. The chosen person also looks after the bookings it makes."
            >
              <select name="notify" defaultValue={config.notify} className="input">
                <option value="BUSINESS">Your business email{businessEmail ? ` (${businessEmail})` : " (not set yet)"}</option>
                <option value="ADMINS">Every admin</option>
                <option value="TEAM">Everyone (admins and agents)</option>
                {team.map((u) => (
                  <option key={u.id} value={`USER:${u.id}`}>
                    Just {u.name}
                  </option>
                ))}
              </select>
            </Field>
          </SettingsCard>
        </SettingsSection>
      </ActionForm>

      <SettingsSection title="Reply to the customer">
        <SettingsCard>
          <SettingsRow
            icon="mail"
            title="Enquiry received"
            sub="An automatic email thanking them, with what they sent. Replies come to you."
            href="/settings/notifications/customers/enquiry_reply"
            right={<Badge tone={reply.on ? "green" : "grey"}>{reply.on ? "On" : "Off"}</Badge>}
          />
        </SettingsCard>
      </SettingsSection>
    </SettingsPage>
  );
}

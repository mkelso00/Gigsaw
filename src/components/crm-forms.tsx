import type { Artist, Contact, Venue } from "@prisma/client";
import { ActionForm, SubmitButton } from "@/components/forms";
import { UseMyLocation } from "@/components/client-bits";
import { Field } from "@/components/ui";
import { ACT_TYPES, ACT_TYPE_LABELS } from "@/lib/act-profile";
import { CONTACT_TYPES, CONTACT_TYPE_LABELS, TIMEZONES } from "@/lib/constants";
import { minorToInput } from "@/lib/money";
import { VENUE_PALETTE, venueColour } from "@/lib/rota";
import type { FormState } from "@/lib/forms";

type Action = (state: FormState, form: FormData) => Promise<FormState>;

export function ArtistForm({ action, artist, agents }: { action: Action; artist?: Artist; agents: { id: string; name: string }[] }) {
  return (
    <ActionForm action={action} className="card card-pad space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Act name" hint="A solo singer, duo or band: one profile per act">
          <input name="name" required defaultValue={artist?.name} className="input" />
        </Field>
        <Field label="Genre">
          <input name="genre" defaultValue={artist?.genre} className="input" />
        </Field>
        <Field label="Email">
          <input name="email" type="email" defaultValue={artist?.email} className="input" />
        </Field>
        <Field label="Phone">
          <input name="phone" type="tel" defaultValue={artist?.phone} className="input" />
        </Field>
        <Field label="Lead agent">
          <select name="agentId" defaultValue={artist?.agentId ?? ""} className="input">
            <option value="">Nobody yet</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Type of act">
          <select name="actType" defaultValue={artist?.actType ?? ""} className="input">
            <option value="">Not set</option>
            {ACT_TYPES.map((t) => (
              <option key={t} value={t}>
                {ACT_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Based in">
          <input name="town" defaultValue={artist?.town} className="input" />
        </Field>
        <Field label="Usual fee" hint="A guide to what they charge for a bar booking">
          <input name="usualFee" inputMode="decimal" defaultValue={minorToInput(artist?.usualFeeMinor)} placeholder="0.00" className="input" />
        </Field>
        <Field label="Calendar colour">
          <input name="colour" type="color" defaultValue={artist?.colour ?? "#6d28d9"} className="h-10 w-20 rounded border border-slate-300" />
        </Field>
      </div>
      <h3 className="pt-2 text-sm font-semibold">Links</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Video">
          <input name="videoUrl" defaultValue={artist?.videoUrl} placeholder="youtube.com/…" className="input" />
        </Field>
        <Field label="Photo">
          <input name="photoUrl" defaultValue={artist?.photoUrl} className="input" />
        </Field>
        <Field label="Instagram">
          <input name="instagram" defaultValue={artist?.instagram ? `@${artist.instagram}` : ""} className="input" />
        </Field>
        <Field label="Website">
          <input name="website" defaultValue={artist?.website} className="input" />
        </Field>
        <Field label="Set list" className="sm:col-span-2">
          <textarea name="setList" rows={3} defaultValue={artist?.setList} className="input" />
        </Field>
      </div>
      <h3 className="pt-2 text-sm font-semibold">Bank details</h3>
      <p className="-mt-2 text-xs text-ink-500">For paying the act. Only the agency sees these.</p>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Name on the account">
          <input name="bankAccountName" defaultValue={artist?.bankAccountName} className="input" />
        </Field>
        <Field label="Sort code">
          <input name="bankSortCode" defaultValue={artist?.bankSortCode} placeholder="12-34-56" className="input" />
        </Field>
        <Field label="Account number">
          <input name="bankAccountNumber" defaultValue={artist?.bankAccountNumber} className="input" />
        </Field>
        <label className="flex items-center gap-3">
          <input type="checkbox" name="vatRegistered" defaultChecked={artist?.vatRegistered} className="h-4 w-4 accent-ink-950" />
          <span className="text-sm font-medium">VAT registered</span>
        </label>
        <Field label="VAT number">
          <input name="vatNumber" defaultValue={artist?.vatNumber} className="input" />
        </Field>
      </div>
      <Field label="Notes">
        <textarea name="notes" rows={3} defaultValue={artist?.notes} className="input" />
      </Field>
      <div className="flex justify-end">
        <SubmitButton>{artist ? "Save changes" : "Add act"}</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function ContactForm({ action, contact, defaultType }: { action: Action; contact?: Contact; defaultType?: string }) {
  return (
    <ActionForm action={action} className="card card-pad space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Type">
          <select name="type" defaultValue={contact?.type ?? defaultType ?? "PROMOTER"} className="input">
            {CONTACT_TYPES.map((t) => (
              <option key={t} value={t}>
                {CONTACT_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Name">
          <input name="name" required defaultValue={contact?.name} className="input" />
        </Field>
        <Field label="Company">
          <input name="company" defaultValue={contact?.company} className="input" />
        </Field>
        <Field label="Email">
          <input name="email" type="email" defaultValue={contact?.email} className="input" />
        </Field>
        <Field label="Phone">
          <input name="phone" type="tel" defaultValue={contact?.phone} className="input" />
        </Field>
        <Field label="Tags" hint="Comma separated, e.g. festival, uk, jazz">
          <input name="tags" defaultValue={contact?.tags} className="input" />
        </Field>
      </div>
      <Field label="Address" hint="Used on contracts and invoices">
        <textarea name="address" rows={3} defaultValue={contact?.address} className="input" />
      </Field>
      <div className="flex justify-end">
        <SubmitButton>{contact ? "Save changes" : "Add contact"}</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function VenueForm({
  action,
  venue,
  defaultTimezone,
  suggestedColour,
}: {
  action: Action;
  venue?: Venue;
  defaultTimezone: string;
  suggestedColour?: string;
}) {
  const mapQuery = venue ? encodeURIComponent([venue.name, venue.address, venue.city, venue.country].filter(Boolean).join(", ")) : "";
  return (
    <ActionForm action={action} className="card card-pad space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Venue name">
          <input name="name" required defaultValue={venue?.name} className="input" />
        </Field>
        <Field label="Capacity">
          <input name="capacity" inputMode="numeric" defaultValue={venue?.capacity ?? ""} className="input" />
        </Field>
        <Field label="Address" className="sm:col-span-2">
          <input name="address" defaultValue={venue?.address} className="input" />
        </Field>
        <Field label="Town or city">
          <input name="city" defaultValue={venue?.city} className="input" />
        </Field>
        <Field label="Country">
          <input name="country" defaultValue={venue?.country} className="input" />
        </Field>
        <Field label="Calendar colour" hint="How this venue shows on the calendar and rota">
          <input
            name="colour"
            type="color"
            defaultValue={venue ? venueColour(venue) : (suggestedColour ?? VENUE_PALETTE[0])}
            className="h-10 w-20 cursor-pointer rounded-lg border border-ink-200"
          />
        </Field>
        <Field label="Time zone" hint="Booking times at this venue are shown in this zone">
          <select name="timezone" defaultValue={venue?.timezone ?? defaultTimezone} className="input">
            {TIMEZONES.map((z) => (
              <option key={z} value={z}>
                {z.replace("_", " ")}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="rounded-lg border border-brand-100 bg-brand-50 p-4">
        <h3 className="text-sm font-semibold text-brand-700">Map pin for arrival tracking</h3>
        <p className="mt-1 text-sm text-slate-600">
          When an artist taps &ldquo;I&apos;ve arrived&rdquo;, Gigsaw compares their phone&apos;s location with this pin. Without a pin, arrivals are recorded
          but can&apos;t be verified. In Google Maps, right-click the venue and click the numbers at the top to copy them.
          {mapQuery && (
            <>
              {" "}
              <a className="link" target="_blank" rel="noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${mapQuery}`}>
                Find this venue on Google Maps
              </a>
            </>
          )}
        </p>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <Field label="Latitude">
            <input name="latitude" inputMode="decimal" defaultValue={venue?.latitude ?? ""} placeholder="51.5392" className="input" />
          </Field>
          <Field label="Longitude">
            <input name="longitude" inputMode="decimal" defaultValue={venue?.longitude ?? ""} placeholder="-0.1426" className="input" />
          </Field>
        </div>
        <div className="mt-3">
          <UseMyLocation />
        </div>
      </div>
      <Field label="Notes" hint="Load-in, parking, stage size and so on">
        <textarea name="notes" rows={3} defaultValue={venue?.notes} className="input" />
      </Field>
      <div className="flex justify-end">
        <SubmitButton>{venue ? "Save changes" : "Add venue"}</SubmitButton>
      </div>
    </ActionForm>
  );
}

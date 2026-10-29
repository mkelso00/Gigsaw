import type { Artist, Contact, Venue } from "@prisma/client";
import { ActionForm, SubmitButton } from "@/components/forms";
import { UseMyLocation } from "@/components/client-bits";
import { Field } from "@/components/ui";
import { CONTACT_TYPES, CONTACT_TYPE_LABELS, TIMEZONES } from "@/lib/constants";
import { VENUE_PALETTE, venueColour } from "@/lib/rota";
import type { FormState } from "@/lib/forms";

type Action = (state: FormState, form: FormData) => Promise<FormState>;

export function ArtistForm({ action, artist, agents }: { action: Action; artist?: Artist; agents: { id: string; name: string }[] }) {
  return (
    <ActionForm action={action} className="card card-pad space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Artist or act name">
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
        <Field label="Default commission %" hint="Leave blank to use the agency default">
          <input name="defaultCommission" inputMode="decimal" defaultValue={artist?.defaultCommission ?? ""} className="input" />
        </Field>
        <Field label="Calendar colour">
          <input name="colour" type="color" defaultValue={artist?.colour ?? "#6d28d9"} className="h-10 w-20 rounded border border-slate-300" />
        </Field>
      </div>
      <Field label="Notes">
        <textarea name="notes" rows={3} defaultValue={artist?.notes} className="input" />
      </Field>
      <div className="flex justify-end">
        <SubmitButton>{artist ? "Save changes" : "Add artist"}</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function ContactForm({ action, contact }: { action: Action; contact?: Contact }) {
  return (
    <ActionForm action={action} className="card card-pad space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Type">
          <select name="type" defaultValue={contact?.type ?? "PROMOTER"} className="input">
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

export function VenueForm({ action, venue, defaultTimezone, suggestedColour }: { action: Action; venue?: Venue; defaultTimezone: string; suggestedColour?: string }) {
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
        <Field label="Time zone" hint="Gig times at this venue are shown in this zone">
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
          When an artist taps &ldquo;I&apos;ve arrived&rdquo;, Gigsaw compares their phone&apos;s location with this pin. Without a pin, arrivals are
          recorded but can&apos;t be verified. In Google Maps, right-click the venue and click the numbers at the top to copy them.
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

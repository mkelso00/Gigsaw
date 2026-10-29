import { makeVenueShareLink, removeVenueShareLink } from "@/actions/crm";
import { CopyField } from "@/components/client-bits";
import { ConfirmButton } from "@/components/forms";

/** Agency-side controls for a venue's read-only line-up link. */
export function VenueShareCard({ venueId, url }: { venueId: string; url: string | null }) {
  return (
    <section className="card card-pad">
      <h2 className="section-title">Venue line-up link</h2>
      <p className="mt-1 mb-4 text-sm text-ink-500">
        A private page for the venue showing who&apos;s playing and when, including slots still to be confirmed and arrivals on the night. It never shows
        fees, deals, contact numbers or other venues.
      </p>
      {url ? (
        <div className="space-y-3">
          <CopyField value={url} />
          <div className="flex flex-wrap gap-2">
            <a href={url} target="_blank" rel="noreferrer" className="btn btn-sm">
              Open it
            </a>
            <form action={makeVenueShareLink.bind(null, venueId)}>
              <ConfirmButton message="Make a new link? The old one will stop working straight away." className="btn btn-sm">
                Make a new link
              </ConfirmButton>
            </form>
            <form action={removeVenueShareLink.bind(null, venueId)}>
              <ConfirmButton message="Turn the link off? The venue won't be able to see their line-up until you make a new one." className="btn btn-sm btn-danger">
                Turn off
              </ConfirmButton>
            </form>
          </div>
        </div>
      ) : (
        <form action={makeVenueShareLink.bind(null, venueId)}>
          <button className="btn btn-primary">Create link for this venue</button>
        </form>
      )}
    </section>
  );
}

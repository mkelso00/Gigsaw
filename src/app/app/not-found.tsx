import { HomeLink, Problem } from "@/components/problem";

// Usually a gig that isn't there any more, or one that isn't this act's.
export default function ActAppNotFound() {
  return (
    <Problem
      tone="dark"
      state="silent"
      label="Not found"
      title="We can't find that page"
      actions={<HomeLink tone="dark" href="/app" label="Back to my bookings" />}
    >
      If it was a gig, it may have been cancelled or given to another act. Your bookings list is always up to date.
    </Problem>
  );
}

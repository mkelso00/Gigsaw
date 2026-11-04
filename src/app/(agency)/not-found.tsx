import { HomeLink, Problem } from "@/components/problem";

// A booking, act, venue or contact that isn't there: deleted, from another business, or a wrong link.
export default function AgencyNotFound() {
  return (
    <Problem state="silent" label="Not found" title="We can't find that page" actions={<HomeLink href="/dashboard" label="Back to the dashboard" />}>
      It may have been deleted, or the link may be wrong. Try searching for it instead.
    </Problem>
  );
}

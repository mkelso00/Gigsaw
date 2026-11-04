import { HomeLink, Problem } from "@/components/problem";

export default function OwnerNotFound() {
  return (
    <Problem state="silent" label="Not found" title="We can't find that page" actions={<HomeLink href="/owner" label="Back to the owner area" />}>
      The business or page may have been removed, or the link may be wrong.
    </Problem>
  );
}

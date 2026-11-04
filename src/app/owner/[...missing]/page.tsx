import { notFound } from "next/navigation";

// Any other address under /owner: Next only shows the root not-found page for addresses that match
// nothing, so this keeps people inside the Owner area with its own not-found page.
export default function Missing() {
  notFound();
}

import type { Metadata } from "next";
import { HomeLink, Problem, ProblemScreen } from "@/components/problem";
import { currentUser, homePath } from "@/lib/auth";

export const metadata: Metadata = { title: "Page not found", robots: { index: false, follow: false } };

// Addresses that match no page at all, and notFound() from pages outside the areas with their own.
export default async function NotFound() {
  // Signed-in people go back to their own home. It must still render if the database is unreachable.
  const user = await currentUser().catch(() => null);
  const home = user ? homePath(user) : "/";
  return (
    <ProblemScreen>
      <Problem
        state="silent"
        label="Page not found"
        title="We can't find that page"
        actions={<HomeLink href={home} label={home === "/" ? "Go to the home page" : "Back to Gigsaw"} />}
      >
        The address may be mistyped, or the page may have moved. Check the link, or start again from home.
      </Problem>
    </ProblemScreen>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { startTransition, useEffect } from "react";
import { HomeLink, Problem, ProblemScreen, type ProblemTone } from "@/components/problem";

// The content of each area's error.tsx. Next shows these when a page throws: the message stays
// hidden (in production Next only sends the digest for server errors), the digest is shown as a
// reference, and "Try again" re-fetches the page from the server.

export type BoundaryProps = { error: Error & { digest?: string }; reset: () => void };

export function ErrorPage({
  error,
  reset,
  home,
  tone = "light",
  title = "Something went wrong on our side",
  children = "Try again in a moment. If it keeps happening, email hello@gigsaw.live and quote the reference below.",
}: BoundaryProps & {
  home?: { href: string; label: string };
  tone?: ProblemTone;
  title?: string;
  children?: React.ReactNode;
}) {
  const router = useRouter();
  useEffect(() => {
    console.error(`Page error${error.digest ? ` (reference ${error.digest})` : ""}`, error);
  }, [error]);
  // reset() alone only re-renders what's already in the browser; refreshing first asks the server again.
  const retry = () =>
    startTransition(() => {
      router.refresh();
      reset();
    });
  return (
    <Problem
      tone={tone}
      state="clip"
      label="Error"
      title={title}
      reference={error.digest}
      detail={process.env.NODE_ENV === "development" ? error.message : undefined}
      actions={
        <>
          {home && <HomeLink tone={tone} {...home} />}
          <button type="button" onClick={retry} className={tone === "dark" ? "btn btn-volt" : "btn btn-primary"}>
            Try again
          </button>
        </>
      }
    >
      {children}
    </Problem>
  );
}

/** For the private links sent to acts, clients and venues, which have no home to go back to. */
export function LinkError(props: BoundaryProps) {
  return (
    <ProblemScreen logo={false}>
      <ErrorPage {...props} title="This link isn't working right now">
        Something went wrong on our side. Try again in a moment, and if it keeps happening, let whoever sent you the link know and quote the reference below.
      </ErrorPage>
    </ProblemScreen>
  );
}

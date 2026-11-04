"use client";

import { ErrorPage, type BoundaryProps } from "@/components/error-pages";

// The act app is dark, so the page is too.
export default function ActAppError(props: BoundaryProps) {
  return (
    <ErrorPage {...props} tone="dark" home={{ href: "/app", label: "Back to my bookings" }}>
      Try again in a moment. If it keeps happening, tell your agent and quote the reference below.
    </ErrorPage>
  );
}

"use client";

import { ErrorPage, type BoundaryProps } from "@/components/error-pages";

export default function OwnerError(props: BoundaryProps) {
  return (
    <ErrorPage {...props} home={{ href: "/owner", label: "Back to the owner area" }}>
      Try again in a moment. The reference below matches the entry in the server log.
    </ErrorPage>
  );
}

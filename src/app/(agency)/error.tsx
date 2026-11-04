"use client";

import { ErrorPage, type BoundaryProps } from "@/components/error-pages";

// Shown inside the app frame, so the sidebar stays and people can carry on elsewhere.
export default function AgencyError(props: BoundaryProps) {
  return <ErrorPage {...props} home={{ href: "/dashboard", label: "Back to the dashboard" }} />;
}

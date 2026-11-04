"use client";

import { ErrorPage, type BoundaryProps } from "@/components/error-pages";

// Inside the website's own header and footer, on its white page.
export default function SiteError(props: BoundaryProps) {
  return (
    <div className="px-4 sm:px-8">
      <ErrorPage {...props} home={{ href: "/", label: "Back to the home page" }} />
    </div>
  );
}

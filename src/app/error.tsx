"use client";

import { ErrorPage, type BoundaryProps } from "@/components/error-pages";
import { ProblemScreen } from "@/components/problem";

// Catches errors in pages without their own boundary, and in the area layouts themselves (a
// segment's error.tsx sits inside its layout, so a layout that throws lands here). The website
// keeps working when the database doesn't, so it's the safe place to send people.
export default function RootError(props: BoundaryProps) {
  return (
    <ProblemScreen>
      <ErrorPage {...props} home={{ href: "/", label: "Go to the home page" }} />
    </ProblemScreen>
  );
}

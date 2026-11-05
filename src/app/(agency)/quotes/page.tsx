import type { Metadata } from "next";
import EnquiriesPage from "../enquiries/page";

export const metadata: Metadata = { title: "Quotes" };

/** Quotes have their own place in the menu: the Enquiries page, opened on its Quotes tab. */
export default async function QuotesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  return EnquiriesPage({ searchParams: Promise.resolve({ ...sp, view: "quotes" }) });
}

import "server-only";
import { prisma } from "./db";
import { readEnquiryConfig } from "./enquiries";

/**
 * The logo for a business's customer pages (proposals, the enquiry form): the one uploaded in Settings, Email
 * design, else the logo link set on the enquiry form, else none (the page shows the business's name). The uploaded
 * one is served from Gigsaw itself, so it can't go missing the way a link to another site can.
 */
export async function publicLogoUrl(agencyId: string, enquiryForm: unknown): Promise<string | null> {
  const uploaded = await prisma.brandLogo.findUnique({ where: { agencyId }, select: { updatedAt: true } });
  if (uploaded) return `/brand/${agencyId}/logo?v=${uploaded.updatedAt.getTime().toString(36)}`;
  return readEnquiryConfig(enquiryForm).logoUrl || null;
}

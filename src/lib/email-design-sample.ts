import { contactLines, type EmailDesign, type EmailLook } from "./email-design";
import type { EmailContent } from "./message-format";

// A made-up enquiry reply, for the Email design preview and the test email. The real one is built in
// replyToCustomer (src/lib/enquiry-server.ts) the same way.

export function sampleEnquiryEmail(business: string, d: EmailDesign, look?: Partial<EmailLook>, email = ""): EmailContent {
  return {
    brand: business,
    preheader: "We've got your enquiry",
    title: "Thanks for your enquiry",
    intro: `Hi Hannah, thanks for getting in touch with ${business}. We've got your enquiry and will come back to you soon. Here's what you sent us:`,
    rows: [
      ["Event", "Wedding"],
      ["Date", "Sat, 14 Aug 2027"],
      ["Venue", "Hollins Hall, Leeds"],
      ["Guests", "120"],
      ["Budget", "£2,500 to £3,500"],
    ],
    rowsTitle: "Your enquiry",
    ...(d.steps.length ? { steps: { title: "What happens next", items: d.steps } } : {}),
    ...(d.website && d.buttonLabel ? { cta: { label: d.buttonLabel, url: d.website } } : {}),
    outro: "If anything's changed, just reply to this email.",
    ...(look ? { look: { header: d.header, accent: d.accent, contact: contactLines(d, email), ...look } } : {}),
  };
}

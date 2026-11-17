"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { logActivity, prisma } from "@/lib/db";
import { isHexColour, parseSteps, readEmailDesign, websiteUrl, type EmailDesign } from "@/lib/email-design";
import { sampleEnquiryEmail } from "@/lib/email-design-sample";
import { FormError, handleForm, str, type FormState } from "@/lib/forms";
import { sendEmail } from "@/lib/messaging";

// Settings → Email design: the colours, logo and footer details on every email the business sends,
// and the enquiry reply's "What happens next".

const MAX_LOGO_BYTES = 1_000_000;

/** What kind of image the bytes really are. Only ones every email app shows: PNG, JPG and GIF. */
async function imageKind(bytes: Uint8Array): Promise<"image/png" | "image/jpeg" | "image/gif" | null> {
  const starts = (sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (starts([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (starts([0x47, 0x49, 0x46, 0x38])) return "image/gif";
  return null;
}

export async function saveEmailDesign(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireAdmin();
  const agencyId = user.agencyId!;
  return handleForm(async () => {
    const header = str(form, "header").toLowerCase();
    const accent = str(form, "accent").toLowerCase();
    if (!isHexColour(header) || !isHexColour(accent)) throw new FormError("Choose a header colour and an accent colour");
    const typedSite = str(form, "website");
    const website = websiteUrl(typedSite);
    if (typedSite && !website) throw new FormError("Check the website address, e.g. yourbusiness.co.uk");
    const phone = str(form, "phone").replace(/\s+/g, " ").slice(0, 40);
    if (phone && !/^[0-9+()\-. ]{7,}$/.test(phone)) throw new FormError("Check the phone number");
    const design: EmailDesign = {
      header,
      accent,
      website,
      phone,
      buttonLabel: str(form, "buttonLabel").replace(/\s+/g, " ").slice(0, 40),
      steps: parseSteps(str(form, "steps")),
    };

    // The logo: a new one replaces the old; ticking Remove takes it away.
    const file = form.get("logo");
    if (file && typeof file !== "string" && file.size > 0) {
      if (file.size > MAX_LOGO_BYTES) throw new FormError("The logo is too big: please use one under 1 MB");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const mime = await imageKind(bytes);
      if (!mime) throw new FormError("The logo must be a PNG, JPG or GIF image (email apps don't all show other kinds)");
      await prisma.brandLogo.upsert({
        where: { agencyId },
        create: { agencyId, mime, data: Buffer.from(bytes) },
        update: { mime, data: Buffer.from(bytes) },
      });
    } else if (str(form, "logoRemove") === "on") {
      await prisma.brandLogo.deleteMany({ where: { agencyId } });
    }

    await prisma.settings.update({ where: { agencyId }, data: { emailDesign: design } });
    await logActivity(user, "SETTINGS", agencyId, "updated the email design");
    revalidatePath("/settings/email-design");
    return { ok: "Saved. Every email you send now uses this look." };
  });
}

/** Send the signed-in admin a sample enquiry reply in the saved design. */
export async function sendTestEmail(_: FormState): Promise<FormState> {
  const user = await requireAdmin();
  return handleForm(async () => {
    const s = await prisma.settings.findUniqueOrThrow({ where: { agencyId: user.agencyId! }, include: { agency: { select: { name: true } } } });
    const business = s.agencyName || s.agency.name;
    const status = await sendEmail({
      kind: "ENQUIRY",
      agencyId: user.agencyId!,
      to: user.email,
      replyTo: s.agencyEmail,
      subject: `Test: how your enquiry reply looks`,
      email: sampleEnquiryEmail(business, readEmailDesign(s.emailDesign)),
    });
    if (status === "SKIPPED") throw new FormError("Couldn't send to your login email address");
    return { ok: status === "SENT" ? `Test sent to ${user.email}.` : `Test made, but email isn't set up here, so it wasn't sent.` };
  });
}

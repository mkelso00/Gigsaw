"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { hashPassword, requireAdmin, requireStaff } from "@/lib/auth";
import { parseActProfile, parseMembers, type JoinMember } from "@/lib/act-profile";
import { logActivity, prisma } from "@/lib/db";
import { FormError, handleForm, required, str, type FormState } from "@/lib/forms";
import { appUrl, sendEmail } from "@/lib/messaging";

// New acts join through the agency's private link (/join/<token>). What they send waits as an
// application until the agency approves it, which makes the act, its members and their login.

const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const COLOURS = ["#e11d48", "#7c3aed", "#2563eb", "#0891b2", "#059669", "#ca8a04", "#ea580c", "#db2777", "#4f46e5", "#16a34a"];

/** Make the join link, or a new one (the old link stops working). */
export async function makeJoinLink() {
  const user = await requireAdmin();
  await prisma.settings.update({ where: { agencyId: user.agencyId! }, data: { joinToken: randomBytes(18).toString("base64url") } });
  await logActivity(user, "SETTINGS", user.agencyId!, "made a new act join link");
  revalidatePath("/", "layout");
}

/** Switch the join link off. */
export async function removeJoinLink() {
  const user = await requireAdmin();
  await prisma.settings.update({ where: { agencyId: user.agencyId! }, data: { joinToken: null } });
  await logActivity(user, "SETTINGS", user.agencyId!, "switched off the act join link");
  revalidatePath("/", "layout");
}

/** A new act sends their details from the join link. */
export async function submitJoin(token: string, _: FormState, form: FormData): Promise<FormState> {
  const res = await handleForm(async () => {
    const settings = await prisma.settings.findUnique({ where: { joinToken: token } });
    if (!token || !settings) throw new FormError("This link no longer works. Ask the agency for a new one.");
    // A hidden field people can't see: bots fill it in, people don't.
    if (str(form, "website_confirm")) return;

    const actName = required(form, "actName", "Act name");
    const contactName = required(form, "contactName", "Your name");
    const email = required(form, "email", "Email").toLowerCase();
    if (!isEmail(email)) throw new FormError("Check your email address");
    const phone = required(form, "phone", "Mobile number");
    const password = str(form, "password");
    if (password.length < 8) throw new FormError("Choose a password of at least 8 characters");
    if (password !== str(form, "password2")) throw new FormError("The two passwords don't match");
    const profile = parseActProfile(form, settings.defaultCurrency);
    const members = parseMembers(form);
    for (const m of members) if (m.email && !isEmail(m.email)) throw new FormError(`Check ${m.name}'s email address`);

    const recent = await prisma.actApplication.count({
      where: { agencyId: settings.agencyId, email, createdAt: { gt: new Date(Date.now() - 10 * 60_000) } },
    });
    if (recent >= 3) throw new FormError("We've already got your details. The agency will be in touch.");

    const app = await prisma.actApplication.create({
      data: {
        agencyId: settings.agencyId,
        actName,
        actType: profile.actType || "SOLO",
        genre: str(form, "genre"),
        town: profile.town,
        contactName,
        email,
        phone,
        members,
        photoUrl: profile.photoUrl,
        videoUrl: profile.videoUrl,
        instagram: profile.instagram,
        website: profile.website,
        setList: profile.setList,
        usualFeeMinor: profile.usualFeeMinor,
        bankAccountName: profile.bankAccountName,
        bankSortCode: profile.bankSortCode,
        bankAccountNumber: profile.bankAccountNumber,
        vatRegistered: profile.vatRegistered,
        vatNumber: profile.vatNumber,
        notes: str(form, "notes"),
        passwordHash: await hashPassword(password),
      },
    });

    // Let the agency know there's someone to look at.
    const to = settings.agencyEmail || settings.alertEmail;
    if (to) {
      await sendEmail({
        kind: "JOIN",
        agencyId: settings.agencyId,
        to,
        replyTo: email,
        subject: `New act wants to join: ${actName}`,
        email: {
          brand: settings.agencyName,
          preheader: `${contactName} sent their details`,
          title: `${actName} wants to join`,
          rows: [
            ["Contact", `${contactName}, ${email}, ${phone}`],
            ["Act", [profile.actType, str(form, "genre"), profile.town].filter(Boolean).join(" · ")],
            ...(members.length ? [["Members", members.map((m) => m.name).join(", ")] as [string, string]] : []),
          ],
          cta: { label: "Review and approve", url: `${appUrl()}/artists/applications#${app.id}` },
        },
      });
    }
  });
  if (res?.error) return res;
  redirect(`/join/${token}?sent=1`);
}

/** Approve an application: make the act, its members, and a login for the contact. */
export async function approveApplication(id: string, _: FormState): Promise<FormState> {
  const user = await requireStaff();
  let artistId = "";
  const res = await handleForm(async () => {
    const a = await prisma.actApplication.findFirst({ where: { id, agencyId: user.agencyId, status: "NEW" } });
    if (!a) throw new FormError("Already dealt with");
    const count = await prisma.artist.count({ where: { agencyId: user.agencyId } });
    const loginTaken = !!(await prisma.user.findUnique({ where: { email: a.email }, select: { id: true } }));

    await prisma.$transaction(async (tx) => {
      const act = await tx.artist.create({
        data: {
          agencyId: user.agencyId,
          name: a.actName,
          genre: a.genre,
          email: a.email,
          phone: a.phone,
          colour: COLOURS[count % COLOURS.length],
          agentId: user.id,
          actType: a.actType,
          town: a.town,
          photoUrl: a.photoUrl,
          videoUrl: a.videoUrl,
          instagram: a.instagram,
          website: a.website,
          setList: a.setList,
          usualFeeMinor: a.usualFeeMinor,
          bankAccountName: a.bankAccountName,
          bankSortCode: a.bankSortCode,
          bankAccountNumber: a.bankAccountNumber,
          vatRegistered: a.vatRegistered,
          vatNumber: a.vatNumber,
          notes: a.notes,
        },
      });
      artistId = act.id;

      // The contact is a person in the act, with their own login, so they see all their acts' gigs.
      const split = (n: string) => {
        const [first, ...rest] = n.trim().split(/\s+/);
        return { firstName: first || n, surname: rest.join(" ") };
      };
      const contact = await tx.person.create({
        data: { agencyId: user.agencyId, ...split(a.contactName), email: a.email, phone: a.phone },
      });
      await tx.personAct.create({ data: { personId: contact.id, artistId: act.id, jobTitle: "Contact" } });
      const others = (a.members as JoinMember[]).filter((m) => m.name.toLowerCase() !== a.contactName.trim().toLowerCase());
      for (const m of others) {
        const p = await tx.person.create({ data: { agencyId: user.agencyId, ...split(m.name), email: m.email, phone: m.phone } });
        await tx.personAct.create({ data: { personId: p.id, artistId: act.id, jobTitle: m.role } });
      }
      if (!loginTaken) {
        await tx.user.create({
          data: { email: a.email, name: a.contactName, passwordHash: a.passwordHash, role: "ARTIST", personId: contact.id, agencyId: user.agencyId },
        });
      }
      await tx.actApplication.update({ where: { id: a.id }, data: { status: "APPROVED", reviewedAt: new Date(), artistId: act.id } });
    });
    await logActivity(user, "ARTIST", artistId, "approved new act", a.actName);

    const settings = await prisma.settings.findUnique({ where: { agencyId: user.agencyId } });
    const agencyName = settings?.agencyName ?? "The agency";
    await sendEmail({
      kind: "JOIN",
      agencyId: user.agencyId,
      to: a.email,
      replyTo: user.email || settings?.agencyEmail,
      subject: `You're on the books with ${agencyName}`,
      email: {
        brand: agencyName,
        preheader: "Your details have been approved",
        title: `Welcome, ${a.actName}`,
        intro: loginTaken
          ? `${agencyName} has approved your details. Log in with your usual Gigsaw account to see your gigs.`
          : `${agencyName} has approved your details. Log in with this email and the password you chose to see your gigs, accept offers and check in on the night.`,
        cta: { label: "Log in", url: `${appUrl()}/login` },
        outro: "Add it to your home screen so it's one tap away on gig nights.",
      },
    });
  });
  if (res?.error) return res;
  revalidatePath("/", "layout");
  redirect(`/artists/${artistId}`);
}

/** Decline an application. Nothing is made; the act isn't emailed. */
export async function declineApplication(id: string) {
  const user = await requireStaff();
  const a = await prisma.actApplication.findFirst({ where: { id, agencyId: user.agencyId, status: "NEW" } });
  if (!a) return;
  await prisma.actApplication.update({ where: { id }, data: { status: "DECLINED", reviewedAt: new Date() } });
  await logActivity(user, "SETTINGS", user.agencyId, "declined act application", a.actName);
  revalidatePath("/", "layout");
}

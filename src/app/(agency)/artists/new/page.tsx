import type { Metadata } from "next";
import { createArtist } from "@/actions/crm";
import { ArtistForm } from "@/components/crm-forms";
import { PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const metadata: Metadata = { title: "Add artist" };

export default async function NewArtistPage() {
  await requireStaff();
  const agents = await prisma.user.findMany({ where: { role: { in: ["ADMIN", "AGENT"] } }, select: { id: true, name: true } });
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Add artist" />
      <ArtistForm action={createArtist} agents={agents} />
    </div>
  );
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { deleteArtist, updateArtist } from "@/actions/crm";
import { ArtistForm } from "@/components/crm-forms";
import { ActionForm, ConfirmButton } from "@/components/forms";
import { PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const metadata: Metadata = { title: "Edit artist" };

export default async function EditArtistPage({ params }: { params: Promise<{ id: string }> }) {
  await requireStaff();
  const { id } = await params;
  const [artist, agents] = await Promise.all([
    prisma.artist.findUnique({ where: { id } }),
    prisma.user.findMany({ where: { role: { in: ["ADMIN", "AGENT"] } }, select: { id: true, name: true } }),
  ]);
  if (!artist) notFound();
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title={`Edit ${artist.name}`} />
      <ArtistForm action={updateArtist.bind(null, artist.id)} artist={artist} agents={agents} />
      <ActionForm action={deleteArtist.bind(null, artist.id)}>
        <ConfirmButton message={`Delete ${artist.name}?`}>Delete artist</ConfirmButton>
      </ActionForm>
    </div>
  );
}

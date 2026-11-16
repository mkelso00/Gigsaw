import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { deleteArtist, updateArtist } from "@/actions/crm";
import { ArtistForm } from "@/components/crm-forms";
import { ActionForm, ConfirmButton } from "@/components/forms";
import { PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { hasAnyPayDetails, peopleOf } from "@/lib/payee";
import { loadPayActs } from "@/lib/payee-server";
import { personName } from "@/lib/person-name";

export const metadata: Metadata = { title: "Edit artist" };

export default async function EditArtistPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaff();
  const { id } = await params;
  const [artist, agents, pay] = await Promise.all([
    prisma.artist.findFirst({ where: { id, agencyId: user.agencyId } }),
    prisma.user.findMany({ where: { agencyId: user.agencyId, role: { in: ["ADMIN", "AGENT"] } }, select: { id: true, name: true } }),
    loadPayActs(user.agencyId, [id]).then((m) => m.get(id)),
  ]);
  if (!artist || !pay) notFound();
  const people = peopleOf(pay).map((p) => ({ id: p.id, name: personName(p) }));
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title={`Edit ${artist.name}`} />
      <ArtistForm
        action={updateArtist.bind(null, artist.id)}
        artist={artist}
        agents={agents}
        showPay={user.role === "ADMIN"}
        people={people}
        leadPersonId={artist.leadPersonId}
        actPay={hasAnyPayDetails(artist)}
      />
      <ActionForm action={deleteArtist.bind(null, artist.id)}>
        <ConfirmButton message={`Delete ${artist.name}?`}>Delete artist</ConfirmButton>
      </ActionForm>
    </div>
  );
}

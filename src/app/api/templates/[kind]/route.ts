import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { csvResponse } from "@/lib/csv";
import { isTemplateKind, templateCsv } from "@/lib/templates";

// A blank template to fill in (with two example rows to type over).
export async function GET(_: Request, { params }: { params: Promise<{ kind: string }> }) {
  const user = await currentUser();
  if (!user?.agencyId || user.role === "ARTIST") return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  const { kind } = await params;
  if (!isTemplateKind(kind)) return NextResponse.json({ error: "Unknown template" }, { status: 404 });
  return csvResponse(`gigsaw-${kind}-template.csv`, templateCsv(kind));
}

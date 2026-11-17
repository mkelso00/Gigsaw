import { prisma } from "@/lib/db";

// A business's email logo (Settings → Email design). Public: email apps load it with no login. The
// link carries ?v= of when it was uploaded, so it can be cached for good and a new logo gets a new link.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ agencyId: string }> }) {
  const { agencyId } = await params;
  const logo = /^[\w-]{10,40}$/.test(agencyId) ? await prisma.brandLogo.findUnique({ where: { agencyId } }) : null;
  if (!logo) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(logo.data), {
    headers: {
      "Content-Type": logo.mime,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}

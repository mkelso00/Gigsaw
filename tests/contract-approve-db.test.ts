import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestAgency, describeDb, removeTestAgency } from "./helpers/db";

// The client signs and approves their contract online (/c/<token>): no printing. Approving books a
// held date or an enquiry (Pending, until the act is confirmed) and keeps their signature on the
// contract, where the booking's Contract box shows it. Database tests: TEST_DATABASE_URL only.

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "10.9.8.7", "user-agent": "vitest" }),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));

type Db = typeof import("@/lib/db");
const HOUR = 3_600_000;
// A real (if tiny) PNG, padded past the 100-byte minimum with a text chunk.
const PNG = (() => {
  const head = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return `data:image/png;base64,${Buffer.concat([head, Buffer.alloc(200, 1)]).toString("base64")}`;
})();
const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
};

describeDb("approving a contract online (database)", () => {
  let prisma: Db["prisma"];
  let agencyId = "";
  let admin: { id: string; agencyId: string };
  let n = 0;

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/db"));
    const t = await createTestAgency(prisma, "approve", { agencyName: "Approve Test Music" });
    agencyId = t.agency.id;
    admin = { id: t.admin.id, agencyId };
  });

  afterAll(async () => {
    if (!prisma) return;
    await removeTestAgency(prisma, agencyId);
    await prisma.$disconnect();
  });

  const makeBooking = async (status: string) => {
    const client = await prisma.contact.create({ data: { agencyId, name: "Hannah Smith", email: `hannah-${++n}@approve.gigsaw.invalid` } });
    const act = await prisma.artist.create({ data: { agencyId, name: `Approve Act ${n}` } });
    const setStart = new Date(Date.now() + 40 * 24 * HOUR);
    return prisma.booking.create({
      data: {
        agencyId,
        reference: `AP-${n}-${Date.now()}`,
        status,
        artistId: act.id,
        promoterId: client.id,
        arriveBy: new Date(setStart.getTime() - HOUR),
        setStart,
        setEnd: new Date(setStart.getTime() + 2 * HOUR),
        feeMinor: 120_000,
        currency: "GBP",
      },
    });
  };

  const sendAndApprove = async (bookingId: string, fields: Record<string, string> = {}) => {
    const { sendContract, liveContractDoc } = await import("@/lib/contracts");
    const { contractHash } = await import("@/lib/contract-doc");
    const { signContract } = await import("@/actions/contracts");
    const { contract } = await sendContract(admin, { kind: "booking", id: bookingId }, { name: "Hannah Smith", email: "hannah@approve.gigsaw.invalid" });
    const live = await liveContractDoc(contract);
    const hash = contractHash(live!.doc);
    const res = await signContract(
      contract.token,
      hash,
      undefined as never,
      form({ signedName: "Hannah Smith", signature: PNG, agree: "on", ...fields }),
    ).catch((e: Error) => e.message);
    return { contract, res };
  };

  it("books a held date once the client signs and approves, and keeps the signature", async () => {
    const b = await makeBooking("HOLD");
    const { contract, res } = await sendAndApprove(b.id);
    expect(res).toBe(`REDIRECT /c/${contract.token}`);
    const signed = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(signed).toMatchObject({ status: "SIGNED", signedName: "Hannah Smith", signature: PNG, signedIp: "10.9.8.7" });
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("PENDING");
    const log = await prisma.activity.findFirst({ where: { agencyId, entityId: b.id, action: "client signed and approved the contract" } });
    expect(log?.detail).toBe("Hannah Smith");
  });

  it("leaves a booking that is already further on as it is", async () => {
    const b = await makeBooking("CONFIRMED");
    await sendAndApprove(b.id);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("CONFIRMED");
  });

  it("won't approve without a drawn signature, and the booking stays held", async () => {
    const b = await makeBooking("HOLD");
    const { contract, res } = await sendAndApprove(b.id, { signature: "" });
    expect(res).toMatchObject({ error: "Draw your signature in the box" });
    expect((await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).status).toBe("SENT");
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("HOLD");
  });
});

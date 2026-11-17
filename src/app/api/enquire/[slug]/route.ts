import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ENQUIRY_EVENT_TYPES, formStamp } from "@/lib/enquiries";
import { receiveWebsiteEnquiry } from "@/lib/enquiry-intake";
import { enquirySecret } from "@/lib/enquiry-server";

// The enquiry form, for a business's own form on another website (a Shopify section, WordPress…).
//
//   GET  /api/enquire/<slug>   → { on, t }   t: a time stamp to send back with the enquiry
//   POST /api/enquire/<slug>   JSON →  { ok: true } or { error, code }
//
// The POST takes: name, email, phone, eventType (WEDDING, PRIVATE_PARTY, CORPORATE, GIG, FESTIVAL,
// OTHER, or "wedding"), date (YYYY-MM-DD), startTime (HH:MM), venue, guests, budget, message, acts
// (names or ids), details ({ "Question": "answer" or ["several", "answers"] }, added to the message),
// source (the page it was sent from), t (from the GET) and company_site (a hidden box left empty;
// anything in it marks a bot). Same checks, limits and emails as the Gigsaw form at /enquire/<slug>.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY = 20_000;

function cors(req: NextRequest) {
  return {
    "Access-Control-Allow-Origin": req.headers.get("origin") || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
}

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: cors(req) });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const s = await prisma.settings.findUnique({ where: { enquirySlug: slug }, select: { enquiryOn: true, agency: { select: { status: true } } } });
  const on = !!s && s.enquiryOn && s.agency.status === "ACTIVE";
  return NextResponse.json({ on, t: on ? formStamp(Date.now(), await enquirySecret()) : null }, { headers: cors(req) });
}

const text = (v: unknown, max = 3000) => (typeof v === "string" ? v.slice(0, max) : typeof v === "number" ? String(v) : "");

/** A wedding, one of Gigsaw's event types, or anything else as "Something else". */
function eventTypeOf(v: unknown) {
  const t = text(v, 40)
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  if (!t) return "";
  return ENQUIRY_EVENT_TYPES.some((x) => x.value === t) ? t : "OTHER";
}

/** The form's own questions ("How did you find us?" …) as lines added to the message. */
function detailLines(v: unknown) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return [];
  const lines: string[] = [];
  for (const [k, raw] of Object.entries(v as Record<string, unknown>).slice(0, 20)) {
    const answer = (
      Array.isArray(raw)
        ? raw
            .map((x) => text(x, 200))
            .filter(Boolean)
            .join(", ")
        : text(raw, 500)
    )
      .replace(/\s+/g, " ")
      .trim();
    const label = text(k, 80).replace(/\s+/g, " ").trim();
    if (label && answer) lines.push(`${label}: ${answer}`);
  }
  return lines;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const headers = cors(req);
  const raw = await req.text();
  let body: Record<string, unknown>;
  try {
    if (raw.length > MAX_BODY) throw new Error("too big");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Please send the enquiry as JSON.", code: "invalid" }, { status: 400, headers });
  }

  const form = new FormData();
  for (const k of ["name", "email", "phone", "date", "startTime", "venue", "guests", "budget", "t", "company_site"]) form.set(k, text(body[k], 500));
  form.set("eventType", eventTypeOf(body.eventType));
  const details = detailLines(body.details);
  const message = text(body.message).trim();
  form.set("message", [message, details.join("\n")].filter(Boolean).join("\n\n"));
  for (const a of [body.acts ?? []].flat().slice(0, 20)) if (text(a, 100).trim()) form.append("acts", text(a, 100).trim());
  form.set("source", text(body.source, 300) || req.headers.get("referer") || req.headers.get("origin") || "");

  const res = await receiveWebsiteEnquiry(slug, form, req.headers, { api: true });
  if ("ok" in res) return NextResponse.json({ ok: true }, { headers });
  const status = res.code === "off" ? 403 : res.code === "busy" ? 429 : 400;
  return NextResponse.json(res, { status, headers });
}

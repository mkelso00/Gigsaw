import { NextResponse, type NextRequest } from "next/server";

// Quick gate: send visitors without a session cookie to the login page.
// The real session check happens on the server in each layout and action.

// The marketing site. Matched exactly: as a prefix, "/" would make every page public.
const PUBLIC_PAGES = new Set(["/", "/features", "/pricing", "/privacy", "/terms"]);

const PUBLIC = [
  "/signup",
  "/v/",
  "/w/",
  "/o/",
  "/join/",
  "/api/venue-calendar",
  "/api/cron",
  "/login",
  "/setup",
  "/forgot-password",
  "/reset-password",
  "/api/calendar",
  "/api/auth/",
  "/manifest.webmanifest",
  "/icon.svg",
  "/apple-icon",
  "/sw.js",
  "/api/stripe/webhook",
];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PAGES.has(pathname) || PUBLIC.some((p) => pathname.startsWith(p))) return NextResponse.next();
  if (!req.cookies.get("gigsaw_session")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  // Layouts can't see the path, so pass it on (used to keep Plan open when a trial has ended).
  const headers = new Headers(req.headers);
  headers.set("x-pathname", pathname);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

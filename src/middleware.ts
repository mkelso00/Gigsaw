import { NextResponse, type NextRequest } from "next/server";

// Quick gate: send visitors without a session cookie to the login page.
// The real session check happens on the server in each layout and action.
const PUBLIC = ["/v/", "/api/venue-calendar", "/api/cron", "/login", "/setup", "/forgot-password", "/reset-password", "/api/calendar", "/manifest.webmanifest", "/icon.svg"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname.startsWith(p))) return NextResponse.next();
  if (!req.cookies.get("gigsaw_session")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

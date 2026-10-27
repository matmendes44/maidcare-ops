import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/cookie";

// Optimistic check only: sends visitors without a session cookie to /login
// before anything renders. Whether the session is actually valid is checked
// against the database by requireUser() next to every data read and action.
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  // Bouncie's webhook has no session; it checks its own key instead
  // the sign-in pages (password, two-step code, setup), the webhooks, which
  // have no session and check their own signatures, and the QR report pages
  if (
    pathname === "/login" ||
    pathname.startsWith("/login/") ||
    pathname === "/api/bouncie/webhook" ||
    pathname === "/api/stripe/webhook" ||
    // the demo's nightly reset (Vercel Cron), which checks CRON_SECRET
    pathname === "/api/demo/reset" ||
    // the QR code report pages: their link's token is the key (app/r)
    pathname.startsWith("/r/") ||
    // estimates sent to customers: the link's token is the key (app/q)
    pathname.startsWith("/q/") ||
    request.cookies.has(SESSION_COOKIE)
  ) {
    return NextResponse.next();
  }

  const url = new URL("/login", request.url);
  if (pathname !== "/") url.searchParams.set("next", pathname + search);
  return NextResponse.redirect(url);
}

export const config = {
  // everything except Next's own assets and the files in public/
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};

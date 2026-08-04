/**
 * Gate the entire app behind Microsoft sign-in.
 *
 * Everything is protected except the login page, the Auth.js routes themselves, and
 * Next's static assets. Data routes under /api answer with 401/403 JSON rather than a
 * redirect, so a fetch from the page gets a usable error instead of an HTML login
 * document.
 *
 * The allowlist is checked here as well as in the signIn callback. signIn stops a
 * disallowed account from ever getting a cookie; this re-check means that removing
 * someone from lib/authAllowlist.ts locks them out on their next request instead of
 * whenever their existing session happens to expire.
 */
import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { isAllowedEmail } from "@/lib/authAllowlist";

export default auth((req) => {
  const { pathname, search } = req.nextUrl;
  const isApi = pathname.startsWith("/api/");

  if (!req.auth) {
    if (isApi) {
      return NextResponse.json(
        { error: "Not signed in. Open the app and sign in with Microsoft." },
        { status: 401 }
      );
    }
    const loginUrl = new URL("/login", req.nextUrl.origin);
    const from = `${pathname}${search}`;
    if (from && from !== "/") loginUrl.searchParams.set("from", from);
    return NextResponse.redirect(loginUrl);
  }

  if (!isAllowedEmail(req.auth.user?.email)) {
    if (isApi) {
      return NextResponse.json(
        { error: "This account is not authorized to use this app." },
        { status: 403 }
      );
    }
    const loginUrl = new URL("/login", req.nextUrl.origin);
    loginUrl.searchParams.set("error", "AccessDenied");
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
});

export const config = {
  /**
   * Match everything except: Auth.js's own endpoints (which must stay reachable to
   * perform a login), the login page, and static assets.
   */
  matcher: [
    "/((?!api/auth|login|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp)$).*)",
  ],
};

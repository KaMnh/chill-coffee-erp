import { NextResponse, type NextRequest } from "next/server";

/**
 * Defense-in-depth (lite). RLS is the real security gate; this middleware only
 * prevents the unauthenticated user from briefly seeing the protected shell
 * (LoadingScreen blink) before client-side redirect kicks in.
 *
 * Mechanism: a sentinel cookie `chill-auth-state` is set/cleared by the client
 * (see `useAuthCookieSync` in `src/hooks/use-auth-cookie-sync.ts`) when the
 * Supabase session changes. Cookie is forgeable, so this is NOT a security
 * boundary — only UX/SEO.
 */
const AUTH_COOKIE = "chill-auth-state";
const PUBLIC_PATHS = ["/auth"];

export function middleware(request: NextRequest) {
  const { pathname } = new URL(request.url);

  // Allow public paths
  if (PUBLIC_PATHS.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  const authCookie = request.cookies.get(AUTH_COOKIE);
  const hasSession = authCookie?.value === "1";
  if (!hasSession) {
    // Currently the app renders the login form inline at `/`, so redirect would
    // just bounce. Pass through but the client guards display the login panel
    // for unauthenticated users. If/when a `/auth/login` route exists, redirect.
    return NextResponse.next();
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon|chill-logo|.*\\.png).*)"]
};

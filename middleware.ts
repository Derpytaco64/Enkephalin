import { NextResponse, type NextRequest } from 'next/server';
import { getSessionCookie } from 'better-auth/cookies';

/**
 * Cookie presence only — no database call and no trust decision. A cookie can
 * be stale, forged or belong to a disabled user, so every guarded route still
 * calls requireUser/requireAdmin. This exists to spare logged-out visitors a
 * render they cannot see.
 */
export function middleware(request: NextRequest) {
  if (getSessionCookie(request)) return NextResponse.next();

  const login = new URL('/login', request.url);
  login.searchParams.set('next', request.nextUrl.pathname);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ['/admin/:path*', '/drugs/:path*', '/study/:path*', '/settings/:path*'],
};

import { NextResponse, type NextRequest } from 'next/server';

/**
 * Desktop hardening: the Electron app starts the server on 127.0.0.1 with a per-launch token in
 * LBS_DESKTOP_TOKEN and gives the same token to its window as a cookie. Other local programs and web
 * pages can reach 127.0.0.1 too, but they do not have the token, so they cannot use the API.
 * Without LBS_DESKTOP_TOKEN (web mode) nothing changes.
 */
const DESKTOP_TOKEN_COOKIE = 'lbs_desktop_token';

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function proxy(request: NextRequest) {
  const expected = process.env.LBS_DESKTOP_TOKEN;
  if (!expected) return NextResponse.next();

  const provided = request.cookies.get(DESKTOP_TOKEN_COOKIE)?.value ?? request.headers.get('x-lbs-desktop-token') ?? '';
  if (!safeEqual(provided, expected)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: '/api/:path*',
};

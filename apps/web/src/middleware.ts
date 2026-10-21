import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  try {
    decodeURIComponent(request.nextUrl.pathname);
  } catch {
    return NextResponse.rewrite(new URL("/this-page-does-not-exist", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/share/:path*",
};


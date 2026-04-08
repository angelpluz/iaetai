import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const PROTECTED_PATHS = ["/chat", "/dashboard"];
const AUTH_PAGES = ["/login", "/register"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isProtected = PROTECTED_PATHS.some(
    (path) => pathname === path || pathname.startsWith(path + "/")
  );
  const isAuthPage = AUTH_PAGES.some((p) => pathname === p);

  const token = request.cookies.get("auth_token")?.value;

  let isValid = false;
  if (token) {
    try {
      const secret = new TextEncoder().encode(process.env.JWT_SECRET!);
      await jwtVerify(token, secret);
      isValid = true;
    } catch {
      isValid = false;
    }
  }

  // Already logged in → bounce away from login/register
  if (isAuthPage && isValid) {
    return NextResponse.redirect(new URL("/chat", request.url));
  }

  if (!isProtected) {
    return NextResponse.next();
  }

  if (!token) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (!isValid) {
    // Token expired or invalid
    const response = NextResponse.redirect(new URL("/login", request.url));
    response.cookies.set("auth_token", "", { maxAge: 0, path: "/" });
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/chat/:path*", "/dashboard/:path*", "/login", "/register"],
};

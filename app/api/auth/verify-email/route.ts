import { NextRequest, NextResponse } from "next/server";

const GW = process.env.API_GATEWAY_URL || "http://localhost:4272";

export async function GET(request: NextRequest) {
  const token = new URL(request.url).searchParams.get("token") ?? "";

  if (!token) {
    return NextResponse.json({ error: "Token is required" }, { status: 400 });
  }

  const res = await fetch(
    `${GW}/api/v1/users/verify-email?token=${encodeURIComponent(token)}`,
    { cache: "no-store" }
  );

  const data = await res.json();

  if (!res.ok) {
    return NextResponse.json(data, { status: res.status });
  }

  // Set new JWT cookie with verified=true claims
  const response = NextResponse.json({ ok: true, user: data.user });
  response.cookies.set("auth_token", data.accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60,
  });

  return response;
}

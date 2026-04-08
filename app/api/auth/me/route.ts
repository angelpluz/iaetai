import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { cookies } from "next/headers";

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get("auth_token")?.value;

  if (!token) {
    return NextResponse.json({ user: null }, { status: 401 });
  }

  try {
    const secret = new TextEncoder().encode(process.env.JWT_SECRET!);
    const { payload } = await jwtVerify(token, secret);
    return NextResponse.json({
      user: {
        uid: payload.sub,
        email: payload.email ?? null,
        username: (payload.username as string | undefined) ?? payload.sub,
        role: payload.role ?? "user",
      },
    });
  } catch {
    return NextResponse.json({ user: null }, { status: 401 });
  }
}

import { NextResponse } from "next/server";
import { gatewayRegister } from "@/lib/apiGateway";

export async function POST(request: Request) {
  try {
    const { email, username, password } = await request.json();

    if (!email || !username || !password) {
      return NextResponse.json(
        { error: "email, username and password are required" },
        { status: 400 }
      );
    }

    const data = await gatewayRegister(email, username, password);

    const response = NextResponse.json({ ok: true, user: data.user });
    response.cookies.set("auth_token", data.accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60,
    });

    return response;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Registration failed";
    const status = message.includes("already") ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

import { NextResponse } from "next/server";
import { gatewayRegister } from "@/lib/apiGateway";

type RegisterBody = {
  email?: string;
  username?: string;
  password?: string;
  whitelistRef?: string;
};

function normalizeKey(value: string) {
  return value.trim().toUpperCase();
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RegisterBody;
    const email = body.email?.trim();
    const username = body.username?.trim();
    const password = body.password;
    const whitelistRef = normalizeKey(body.whitelistRef ?? "");

    if (!email || !username || !password || !whitelistRef) {
      return NextResponse.json(
        { error: "email, username, password, and whitelistRef are required" },
        { status: 400 }
      );
    }

    const data = await gatewayRegister(email, username, password, whitelistRef);
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
    const lowered = message.toLowerCase();
    const status = lowered.includes("already")
      ? 409
      : lowered.includes("invalid alpha whitelist key")
        ? 403
        : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

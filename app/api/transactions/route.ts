import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

const GW = process.env.API_GATEWAY_URL || "http://localhost:4272";

async function readGatewayBody(res: Response): Promise<unknown> {
  const raw = await res.text();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

async function getToken(): Promise<string> {
  const jar = await cookies();
  return jar.get("auth_token")?.value ?? "";
}

export async function GET(request: NextRequest) {
  const token = await getToken();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const qs = new URLSearchParams();
  const passthroughKeys = [
    "limit",
    "offset",
    "mode",
    "day",
    "month",
    "year",
    "from",
    "to",
    "type",
    "category",
    "shape",
  ];

  for (const key of passthroughKeys) {
    const value = searchParams.get(key);
    if (value !== null && value !== "") qs.set(key, value);
  }

  if (!qs.get("limit")) qs.set("limit", "100");
  if (!qs.get("offset")) qs.set("offset", "0");

  const res = await fetch(`${GW}/api/v1/transactions?${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  const data = await readGatewayBody(res);
  if (!res.ok) {
    return NextResponse.json({
      transactions: [],
      gatewayStatus: res.status,
      gatewayError: data,
    });
  }
  return NextResponse.json(data, { status: res.status });
}

export async function POST(request: NextRequest) {
  const token = await getToken();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();

  const res = await fetch(`${GW}/api/v1/transactions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  const data = await readGatewayBody(res);
  return NextResponse.json(data, { status: res.status });
}

export async function DELETE(request: NextRequest) {
  const token = await getToken();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const res = await fetch(`${GW}/api/v1/transactions/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });

  const data = await readGatewayBody(res);
  return NextResponse.json(data, { status: res.status });
}

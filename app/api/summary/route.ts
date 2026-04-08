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

export async function GET(request: NextRequest) {
  const jar = await cookies();
  const token = jar.get("auth_token")?.value ?? "";
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const qs = new URLSearchParams();
  const passthroughKeys = ["mode", "day", "month", "year", "from", "to", "type", "category"];

  for (const key of passthroughKeys) {
    const value = searchParams.get(key);
    if (value !== null && value !== "") qs.set(key, value);
  }

  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  const res = await fetch(`${GW}/api/v1/transactions/summary${suffix}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  const data = await readGatewayBody(res);
  if (!res.ok) {
    return NextResponse.json({
      totalIncome: 0,
      totalExpense: 0,
      balance: 0,
      categories: [],
      gatewayStatus: res.status,
      gatewayError: data,
    });
  }
  return NextResponse.json(data, { status: res.status });
}

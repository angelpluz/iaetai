import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export const runtime = "nodejs";

type Language = "th" | "en";
type BudgetCaps = {
  incomeCap: number;
  categories: Record<string, number>;
  customCategories: string[];
};

const GW = process.env.API_GATEWAY_URL || "http://localhost:4272";
const DASHBOARD_PREFERENCES_PATH =
  process.env.API_DASHBOARD_PREFERENCES_PATH || "/api/v1/users/preferences";
const FIXED_CATEGORY_KEYS = ["food", "transport", "shopping", "bill", "transfer", "other"] as const;

const DEFAULT_CAPS: BudgetCaps = {
  incomeCap: 0,
  categories: {
    food: 0,
    transport: 0,
    shopping: 0,
    bill: 0,
    transfer: 0,
    other: 0,
  },
  customCategories: [],
};

function sanitizeLanguage(value: unknown): Language {
  return value === "en" ? "en" : "th";
}

function sanitizeCaps(value: unknown): BudgetCaps {
  const input = value && typeof value === "object" ? (value as Partial<BudgetCaps>) : {};
  const categoriesInput =
    input.categories && typeof input.categories === "object"
      ? (input.categories as Record<string, unknown>)
      : {};

  const mergedCategories: Record<string, number> = { ...DEFAULT_CAPS.categories };
  for (const [key, raw] of Object.entries(categoriesInput)) {
    const number = typeof raw === "number" ? raw : Number(raw);
    if (Number.isFinite(number) && number >= 0) {
      mergedCategories[key] = number;
    }
  }

  const customCategorySet = new Set<string>();
  if (Array.isArray(input.customCategories)) {
    for (const entry of input.customCategories) {
      const key = String(entry).trim().toLowerCase();
      if (!key || FIXED_CATEGORY_KEYS.includes(key as (typeof FIXED_CATEGORY_KEYS)[number])) continue;
      customCategorySet.add(key);
      if (!(key in mergedCategories)) mergedCategories[key] = 0;
    }
  }

  const incomeCapNumber = typeof input.incomeCap === "number" ? input.incomeCap : Number(input.incomeCap ?? 0);
  const incomeCap = Number.isFinite(incomeCapNumber) && incomeCapNumber >= 0 ? incomeCapNumber : 0;

  return {
    incomeCap,
    categories: mergedCategories,
    customCategories: Array.from(customCategorySet),
  };
}

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

function pickPreferencesPayload(body: unknown): { lang: unknown; caps: unknown } {
  const fallback = { lang: "th", caps: DEFAULT_CAPS };
  if (!body || typeof body !== "object") return fallback;

  const root = body as Record<string, unknown>;
  const data = root.data && typeof root.data === "object" ? (root.data as Record<string, unknown>) : null;
  const candidate = data ?? root;

  return {
    lang: candidate.lang,
    caps: candidate.caps,
  };
}

export async function GET() {
  const token = await getToken();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const res = await fetch(`${GW}${DASHBOARD_PREFERENCES_PATH}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  const body = await readGatewayBody(res);
  if (res.status === 404 || res.status === 405) {
    return NextResponse.json({ lang: "th", caps: DEFAULT_CAPS, source: "fallback" });
  }

  if (!res.ok) {
    return NextResponse.json(
      { error: "Gateway error", gatewayStatus: res.status, gatewayError: body },
      { status: res.status }
    );
  }

  const payload = pickPreferencesPayload(body);
  return NextResponse.json({
    lang: sanitizeLanguage(payload.lang),
    caps: sanitizeCaps(payload.caps),
  });
}

export async function PUT(request: Request) {
  const token = await getToken();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const raw = await request.json().catch(() => ({}));
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  const payload = {
    lang: sanitizeLanguage(body.lang),
    caps: sanitizeCaps(body.caps),
  };

  const res = await fetch(`${GW}${DASHBOARD_PREFERENCES_PATH}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  if (res.status === 404 || res.status === 405) {
    return NextResponse.json({ ok: false, unsupported: true, source: "fallback" });
  }

  const responseBody = await readGatewayBody(res);
  if (!res.ok) {
    return NextResponse.json(
      { error: "Gateway error", gatewayStatus: res.status, gatewayError: responseBody },
      { status: res.status }
    );
  }

  return NextResponse.json({ ok: true, data: responseBody ?? null });
}

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type Language = "th" | "en";
type BudgetCaps = {
  incomeCap: number;
  categories: Record<string, number>;
  customCategories: string[];
};

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

async function getUserIdFromCookie(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("auth_token")?.value;
  if (!token) return null;

  try {
    const secret = new TextEncoder().encode(process.env.JWT_SECRET ?? "");
    const { payload } = await jwtVerify(token, secret);
    return typeof payload.sub === "string" && payload.sub.trim() ? payload.sub : null;
  } catch {
    return null;
  }
}

export async function GET() {
  const userId = await getUserIdFromCookie();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const pref = await prisma.dashboardPreference.findUnique({ where: { userId } });
  if (!pref) {
    return NextResponse.json({
      lang: "th",
      caps: DEFAULT_CAPS,
    });
  }

  let parsedCaps: unknown = DEFAULT_CAPS;
  try {
    parsedCaps = JSON.parse(pref.capsJson);
  } catch {
    parsedCaps = DEFAULT_CAPS;
  }

  return NextResponse.json({
    lang: sanitizeLanguage(pref.lang),
    caps: sanitizeCaps(parsedCaps),
  });
}

export async function PUT(request: Request) {
  const userId = await getUserIdFromCookie();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const payload = body && typeof body === "object" ? (body as Record<string, unknown>) : {};

  const lang = sanitizeLanguage(payload.lang);
  const caps = sanitizeCaps(payload.caps);

  await prisma.dashboardPreference.upsert({
    where: { userId },
    update: {
      lang,
      capsJson: JSON.stringify(caps),
    },
    create: {
      userId,
      lang,
      capsJson: JSON.stringify(caps),
    },
  });

  return NextResponse.json({ ok: true });
}

"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type Language = "th" | "en";
const FIXED_CATEGORY_KEYS = ["food", "transport", "shopping", "bill", "transfer", "other"] as const;
type FixedCategoryKey = (typeof FIXED_CATEGORY_KEYS)[number];

interface Summary {
  totalExpense: number;
  totalIncome: number;
  balance: number;
  categories: { category: string; total: number }[];
}

interface Transaction {
  id: string;
  item: string;
  amount: number;
  type: string;
  category: string;
  merchant: string;
  datetime: string;
}

interface BudgetCaps {
  incomeCap: number;
  categories: Record<string, number>;
  customCategories: string[];
}

type FilterMode = "all" | "day" | "month" | "year" | "range";
type FilterType = "all" | "expense" | "income";

interface DashboardFilter {
  mode: FilterMode;
  day: string;
  month: string;
  year: string;
  from: string;
  to: string;
  type: FilterType;
  category: string;
}

const CAPS_STORAGE_KEY = "iaet:budget-caps:v1";
const LANG_STORAGE_KEY = "iaet:dashboard-lang:v1";

const CATEGORY_META: { key: FixedCategoryKey; labels: Record<Language, string>; code: string }[] = [
  { key: "food", labels: { th: "อาหาร", en: "Food" }, code: "FD" },
  { key: "transport", labels: { th: "เดินทาง", en: "Transport" }, code: "TR" },
  { key: "shopping", labels: { th: "ช้อปปิ้ง", en: "Shopping" }, code: "SH" },
  { key: "bill", labels: { th: "บิล", en: "Bills" }, code: "BL" },
  { key: "transfer", labels: { th: "โอนเงิน", en: "Transfer" }, code: "TF" },
  { key: "other", labels: { th: "อื่นๆ", en: "Other" }, code: "OT" },
];

const COPY: Record<
  Language,
  {
    dashboardTitle: string;
    dashboardSubtitle: string;
    backToChat: string;
    loading: string;
    totalExpense: string;
    totalIncome: string;
    balance: string;
    budgetCaps: string;
    budgetCapsDesc: string;
    resetCaps: string;
    incomeCap: string;
    expenseRemainingFromIncomeCap: string;
    formula: string;
    incomeProgress: string;
    cap: string;
    noCap: string;
    spent: string;
    remaining: string;
    usage: string;
    overCap: string;
    allTransactions: string;
    noTransactions: string;
    addCategory: string;
    addCategoryPlaceholder: string;
    add: string;
    remove: string;
    insights: string;
    categoriesManaged: string;
  }
> = {
  th: {
    dashboardTitle: "แดชบอร์ดการเงิน",
    dashboardSubtitle: "ภาพรวมรายรับ รายจ่าย งบประมาณ และรายการล่าสุดของคุณ",
    backToChat: "กลับไปหน้าแชต",
    loading: "กำลังโหลดข้อมูล...",
    totalExpense: "รายจ่ายรวม",
    totalIncome: "รายรับรวม",
    balance: "ยอดคงเหลือ",
    budgetCaps: "งบประมาณรายหมวด",
    budgetCapsDesc: "ตั้งเพดานรายจ่ายต่อหมวดและติดตามความคืบหน้าแบบเรียลไทม์",
    resetCaps: "รีเซ็ตงบทั้งหมด",
    incomeCap: "เป้ารายรับสำหรับคุมรายจ่าย",
    expenseRemainingFromIncomeCap: "รายจ่ายคงเหลือตามเป้ารายรับ",
    formula: "สูตร: เป้ารายรับ - รายจ่ายรวม",
    incomeProgress: "ความคืบหน้ารายรับ",
    cap: "เพดาน",
    noCap: "ยังไม่กำหนด",
    spent: "ใช้ไป",
    remaining: "คงเหลือ",
    usage: "การใช้งาน",
    overCap: "เกินเพดาน",
    allTransactions: "รายการทั้งหมด",
    noTransactions: "ยังไม่มีรายการ",
    addCategory: "เพิ่มหมวดแบบกำหนดเอง",
    addCategoryPlaceholder: "เช่น pet, gift, travel",
    add: "เพิ่ม",
    remove: "ลบ",
    insights: "ภาพรวม",
    categoriesManaged: "หมวดที่กำลังติดตาม",
  },
  en: {
    dashboardTitle: "Finance Dashboard",
    dashboardSubtitle: "A clear view of cash flow, budget caps, and recent activity.",
    backToChat: "Back to chat",
    loading: "Loading data...",
    totalExpense: "Total expense",
    totalIncome: "Total income",
    balance: "Net balance",
    budgetCaps: "Budget caps",
    budgetCapsDesc: "Set category limits and track usage in real time.",
    resetCaps: "Reset all caps",
    incomeCap: "Income goal for expense coverage",
    expenseRemainingFromIncomeCap: "Expense room left from income goal",
    formula: "Formula: income goal - total expense",
    incomeProgress: "Income progress",
    cap: "Cap",
    noCap: "No cap yet",
    spent: "Spent",
    remaining: "Remaining",
    usage: "Usage",
    overCap: "Over cap",
    allTransactions: "All transactions",
    noTransactions: "No transactions yet.",
    addCategory: "Add custom category",
    addCategoryPlaceholder: "e.g. pet, gift, travel",
    add: "Add",
    remove: "Remove",
    insights: "Overview",
    categoriesManaged: "Tracked categories",
  },
};

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

const CATEGORY_CODE_MAP: Record<string, string> = Object.fromEntries(
  CATEGORY_META.map((category) => [category.key, category.code])
) as Record<string, string>;

function parseNumberInput(value: string): number {
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function formatCurrency(value: number) {
  return `THB ${value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

function monthStringFromDate(value: string) {
  return value ? value.slice(0, 7) : "";
}

function yearStringFromDate(value: string) {
  return value ? value.slice(0, 4) : "";
}

function buildFilterQuery(filter: DashboardFilter): string {
  const qs = new URLSearchParams();
  qs.set("mode", filter.mode);

  if (filter.mode === "day" && filter.day) qs.set("day", filter.day);
  if (filter.mode === "month" && filter.month) qs.set("month", filter.month);
  if (filter.mode === "year" && filter.year) qs.set("year", filter.year);
  if (filter.mode === "range") {
    if (filter.from) qs.set("from", filter.from);
    if (filter.to) qs.set("to", filter.to);
  }

  if (filter.type !== "all") qs.set("type", filter.type);
  if (filter.category && filter.category !== "all") qs.set("category", filter.category);

  return qs.toString();
}

function readCapsFromStorage(): BudgetCaps {
  if (typeof window === "undefined") return DEFAULT_CAPS;

  try {
    const raw = window.localStorage.getItem(CAPS_STORAGE_KEY);
    if (!raw) return DEFAULT_CAPS;

    const parsed = JSON.parse(raw) as Partial<BudgetCaps>;
    const parsedCategories =
      parsed.categories && typeof parsed.categories === "object"
        ? (parsed.categories as Record<string, unknown>)
        : {};

    const mergedCategories: Record<string, number> = { ...DEFAULT_CAPS.categories };
    for (const [key, value] of Object.entries(parsedCategories)) {
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
        mergedCategories[key] = value;
      }
    }

    const customCategories = Array.isArray(parsed.customCategories)
      ? parsed.customCategories
          .map((value) => String(value).trim().toLowerCase())
          .filter((value) => value.length > 0 && !FIXED_CATEGORY_KEYS.includes(value as FixedCategoryKey))
      : [];

    return {
      incomeCap: typeof parsed.incomeCap === "number" ? Math.max(parsed.incomeCap, 0) : 0,
      categories: mergedCategories,
      customCategories,
    };
  } catch {
    return DEFAULT_CAPS;
  }
}

function readLanguageFromStorage(): Language {
  if (typeof window === "undefined") return "th";
  const value = window.localStorage.getItem(LANG_STORAGE_KEY);
  return value === "en" ? "en" : "th";
}

function getCategoryLabel(category: string, lang: Language): string {
  const key = category.toLowerCase() as FixedCategoryKey;
  const found = CATEGORY_META.find((item) => item.key === key);
  return found ? found.labels[lang] : category;
}

function normalizeCategoryInput(raw: string): string {
  return raw.trim().toLowerCase();
}

function getCategoryCode(key: string): string {
  const found = CATEGORY_META.find((item) => item.key === key);
  if (found) return found.code;

  const compact = key.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  if (!compact) return "CU";
  return compact.slice(0, 2).padEnd(2, "X");
}

function normalizeTransactionsResponse(data: unknown): Transaction[] {
  if (Array.isArray(data)) return data as Transaction[];
  if (data && typeof data === "object" && "transactions" in data) {
    const maybeTransactions = (data as { transactions?: unknown }).transactions;
    if (Array.isArray(maybeTransactions)) return maybeTransactions as Transaction[];
  }
  return [];
}

function normalizeSummaryResponse(data: unknown): Summary {
  const fallback: Summary = {
    totalExpense: 0,
    totalIncome: 0,
    balance: 0,
    categories: [],
  };

  if (!data || typeof data !== "object") return fallback;

  const record = data as Record<string, unknown>;
  return {
    totalExpense: typeof record.totalExpense === "number" ? record.totalExpense : 0,
    totalIncome: typeof record.totalIncome === "number" ? record.totalIncome : 0,
    balance: typeof record.balance === "number" ? record.balance : 0,
    categories: Array.isArray(record.categories)
      ? (record.categories as { category: string; total: number }[])
      : [],
  };
}

function StatCard({
  label,
  value,
  eyebrow,
  tone,
}: {
  label: string;
  value: number;
  eyebrow: string;
  tone: "expense" | "income" | "balance";
}) {
  const toneClasses: Record<typeof tone, string> = {
    expense: "bg-[linear-gradient(145deg,rgba(255,255,255,0.96),rgba(255,238,240,0.92))] border-rose-100",
    income: "bg-[linear-gradient(145deg,rgba(255,255,255,0.96),rgba(235,255,250,0.92))] border-emerald-100",
    balance: "bg-[linear-gradient(145deg,rgba(255,255,255,0.96),rgba(236,244,255,0.94))] border-blue-100",
  };

  return (
    <div className={`app-card rounded-[28px] border px-5 py-5 sm:px-6 ${toneClasses[tone]}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">{eyebrow}</p>
      <p className="mt-4 text-sm font-medium text-slate-500">{label}</p>
      <p className="mt-2 break-words text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
        {formatCurrency(value)}
      </p>
    </div>
  );
}

export default function DashboardPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [lang, setLang] = useState<Language>(() => readLanguageFromStorage());
  const [caps, setCaps] = useState<BudgetCaps>(() => readCapsFromStorage());
  const [newCategoryInput, setNewCategoryInput] = useState("");
  const [filter, setFilter] = useState<DashboardFilter>(() => {
    const today = todayDateString();
    return {
      mode: "day",
      day: today,
      month: monthStringFromDate(today),
      year: yearStringFromDate(today),
      from: today,
      to: today,
      type: "all",
      category: "all",
    };
  });

  const t = COPY[lang];

  const fetchDashboardData = useCallback(async () => {
    setLoading(true);
    const query = buildFilterQuery(filter);
    const suffix = query ? `?${query}` : "";

    try {
      const [summaryResponse, transactionsResponse] = await Promise.all([
        fetch(`/api/summary${suffix}`),
        fetch(`/api/transactions${suffix}`),
      ]);
      const summaryData = normalizeSummaryResponse(await summaryResponse.json());
      const transactionsData = normalizeTransactionsResponse(await transactionsResponse.json());

      setSummary(summaryData);
      setTransactions(transactionsData);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(CAPS_STORAGE_KEY, JSON.stringify(caps));
  }, [caps]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(LANG_STORAGE_KEY, lang);
  }, [lang]);

  const categoryFilterOptions = useMemo(() => {
    const values = new Set<string>(["all"]);
    for (const key of FIXED_CATEGORY_KEYS) values.add(key);
    for (const tx of transactions) {
      const key = String(tx.category || "other").toLowerCase();
      if (key) values.add(key);
    }
    return Array.from(values);
  }, [transactions]);

  const periodLabel = useMemo(() => {
    if (filter.mode === "day" && filter.day) return filter.day;
    if (filter.mode === "month" && filter.month) return filter.month;
    if (filter.mode === "year" && filter.year) return filter.year;
    if (filter.mode === "range") {
      if (filter.from && filter.to) return `${filter.from} - ${filter.to}`;
      if (filter.from) return `${filter.from} - ...`;
      if (filter.to) return `... - ${filter.to}`;
    }
    return lang === "th" ? "ทั้งหมด" : "All time";
  }, [filter, lang]);

  const computed = useMemo(() => {
    const expenseByCategory: Record<string, number> = {};

    for (const key of FIXED_CATEGORY_KEYS) {
      expenseByCategory[key] = 0;
    }

    let totalExpense = 0;
    let totalIncome = 0;

    for (const tx of transactions) {
      const amount = Number(tx.amount) || 0;
      const type = String(tx.type || "").toLowerCase();
      const category = String(tx.category || "other").toLowerCase();

      if (type === "income") {
        totalIncome += amount;
        continue;
      }

      totalExpense += amount;
      expenseByCategory[category] = (expenseByCategory[category] ?? 0) + amount;
    }

    const fallbackSummary = {
      totalExpense,
      totalIncome,
      balance: totalIncome - totalExpense,
    };

    const totals = summary
      ? {
          totalExpense: summary.totalExpense || fallbackSummary.totalExpense,
          totalIncome: summary.totalIncome || fallbackSummary.totalIncome,
          balance: summary.balance || fallbackSummary.balance,
        }
      : fallbackSummary;

    const categoryKeyOrder = new Set<string>();
    for (const key of FIXED_CATEGORY_KEYS) categoryKeyOrder.add(key);
    for (const key of caps.customCategories) categoryKeyOrder.add(key);
    for (const key of Object.keys(expenseByCategory)) categoryKeyOrder.add(key);

    const categoryRows = Array.from(categoryKeyOrder).map((key) => {
      const spent = expenseByCategory[key] ?? 0;
      const cap = caps.categories[key] ?? 0;
      const remaining = cap > 0 ? cap - spent : 0;
      const percent = cap > 0 ? Math.min((spent / cap) * 100, 100) : 0;
      const overBy = cap > 0 ? Math.max(spent - cap, 0) : 0;
      const label = getCategoryLabel(key, lang);
      const canRemove = caps.customCategories.includes(key);

      return {
        key,
        code: getCategoryCode(key),
        label,
        canRemove,
        spent,
        cap,
        remaining,
        percent,
        overBy,
      };
    });

    const incomeCap = caps.incomeCap;
    const incomeRemaining = incomeCap > 0 ? incomeCap - totals.totalExpense : 0;
    const incomeProgress = incomeCap > 0 ? Math.min((totals.totalIncome / incomeCap) * 100, 100) : 0;

    return {
      totals,
      categoryRows,
      incomeCap,
      incomeRemaining,
      incomeProgress,
    };
  }, [transactions, summary, caps, lang]);

  function addCustomCategory() {
    const key = normalizeCategoryInput(newCategoryInput);
    if (!key) return;

    setCaps((prev) => {
      if (prev.customCategories.includes(key) || FIXED_CATEGORY_KEYS.includes(key as FixedCategoryKey)) {
        return prev;
      }

      return {
        ...prev,
        customCategories: [...prev.customCategories, key],
        categories: {
          ...prev.categories,
          [key]: prev.categories[key] ?? 0,
        },
      };
    });

    setNewCategoryInput("");
  }

  function removeCustomCategory(key: string) {
    setCaps((prev) => {
      if (!prev.customCategories.includes(key)) return prev;

      const restCategories = Object.fromEntries(
        Object.entries(prev.categories).filter(([categoryKey]) => categoryKey !== key)
      ) as Record<string, number>;

      return {
        ...prev,
        customCategories: prev.customCategories.filter((category) => category !== key),
        categories: restCategories,
      };
    });
  }

  return (
    <div className="flex flex-1 flex-col px-3 pb-4 pt-2 sm:px-4 sm:pb-5 sm:pt-3">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
        <section className="glass-panel rounded-[30px] px-4 py-5 sm:px-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <span className="inline-flex w-fit rounded-full bg-[color:var(--accent-soft)] px-3 py-1 text-xs font-semibold text-[color:var(--accent-strong)]">
                {t.insights}
              </span>
              <div>
                <h1 className="text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">{t.dashboardTitle}</h1>
                <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-600">{t.dashboardSubtitle}</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-full bg-white p-1 shadow-sm ring-1 ring-slate-200">
                <button
                  onClick={() => setLang("th")}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                    lang === "th" ? "bg-slate-950 text-white" : "text-slate-600 hover:text-slate-950"
                  }`}
                >
                  TH
                </button>
                <button
                  onClick={() => setLang("en")}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                    lang === "en" ? "bg-slate-950 text-white" : "text-slate-600 hover:text-slate-950"
                  }`}
                >
                  EN
                </button>
              </div>

              <Link
                href="/chat"
                className="rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-slate-950/10 hover:bg-slate-800"
              >
                {t.backToChat}
              </Link>
            </div>
          </div>
        </section>

        <section className="app-card rounded-[26px] border px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm font-semibold text-slate-900">
                {lang === "th" ? "ตัวกรองช่วงเวลาและเงื่อนไข" : "Date and condition filters"}
              </p>
              <p className="text-xs text-slate-500">
                {lang === "th" ? `ช่วงที่กำลังดู: ${periodLabel}` : `Viewing: ${periodLabel}`}
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
              <label className="space-y-1">
                <span className="text-xs font-medium text-slate-500">{lang === "th" ? "โหมดเวลา" : "Mode"}</span>
                <select
                  value={filter.mode}
                  onChange={(event) =>
                    setFilter((prev) => ({
                      ...prev,
                      mode: event.target.value as FilterMode,
                    }))
                  }
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                >
                  <option value="all">{lang === "th" ? "ทั้งหมด" : "All time"}</option>
                  <option value="day">{lang === "th" ? "รายวัน" : "Day"}</option>
                  <option value="month">{lang === "th" ? "รายเดือน" : "Month"}</option>
                  <option value="year">{lang === "th" ? "รายปี" : "Year"}</option>
                  <option value="range">{lang === "th" ? "ช่วงวันที่" : "Date range"}</option>
                </select>
              </label>

              {filter.mode === "day" ? (
                <label className="space-y-1">
                  <span className="text-xs font-medium text-slate-500">{lang === "th" ? "วันที่" : "Day"}</span>
                  <input
                    type="date"
                    value={filter.day}
                    onChange={(event) =>
                      setFilter((prev) => ({
                        ...prev,
                        day: event.target.value,
                        month: monthStringFromDate(event.target.value),
                        year: yearStringFromDate(event.target.value),
                        from: event.target.value || prev.from,
                        to: event.target.value || prev.to,
                      }))
                    }
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                  />
                </label>
              ) : null}

              {filter.mode === "month" ? (
                <label className="space-y-1">
                  <span className="text-xs font-medium text-slate-500">{lang === "th" ? "เดือน" : "Month"}</span>
                  <input
                    type="month"
                    value={filter.month}
                    onChange={(event) =>
                      setFilter((prev) => ({
                        ...prev,
                        month: event.target.value,
                        year: event.target.value ? event.target.value.slice(0, 4) : prev.year,
                      }))
                    }
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                  />
                </label>
              ) : null}

              {filter.mode === "year" ? (
                <label className="space-y-1">
                  <span className="text-xs font-medium text-slate-500">{lang === "th" ? "ปี" : "Year"}</span>
                  <input
                    type="number"
                    min={2000}
                    max={2100}
                    value={filter.year}
                    onChange={(event) => setFilter((prev) => ({ ...prev, year: event.target.value }))}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                  />
                </label>
              ) : null}

              {filter.mode === "range" ? (
                <>
                  <label className="space-y-1">
                    <span className="text-xs font-medium text-slate-500">{lang === "th" ? "จากวันที่" : "From"}</span>
                    <input
                      type="date"
                      value={filter.from}
                      onChange={(event) => setFilter((prev) => ({ ...prev, from: event.target.value }))}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-medium text-slate-500">{lang === "th" ? "ถึงวันที่" : "To"}</span>
                    <input
                      type="date"
                      value={filter.to}
                      onChange={(event) => setFilter((prev) => ({ ...prev, to: event.target.value }))}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                    />
                  </label>
                </>
              ) : null}

              <label className="space-y-1">
                <span className="text-xs font-medium text-slate-500">{lang === "th" ? "ประเภทรายการ" : "Type"}</span>
                <select
                  value={filter.type}
                  onChange={(event) => setFilter((prev) => ({ ...prev, type: event.target.value as FilterType }))}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                >
                  <option value="all">{lang === "th" ? "ทั้งหมด" : "All"}</option>
                  <option value="expense">{lang === "th" ? "รายจ่าย" : "Expense"}</option>
                  <option value="income">{lang === "th" ? "รายรับ" : "Income"}</option>
                </select>
              </label>

              <label className="space-y-1">
                <span className="text-xs font-medium text-slate-500">{lang === "th" ? "หมวด" : "Category"}</span>
                <select
                  value={filter.category}
                  onChange={(event) => setFilter((prev) => ({ ...prev, category: event.target.value }))}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                >
                  {categoryFilterOptions.map((key) => (
                    <option key={key} value={key}>
                      {key === "all" ? (lang === "th" ? "ทุกหมวด" : "All categories") : getCategoryLabel(key, lang)}
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex items-end">
                <button
                  onClick={() => {
                    const today = todayDateString();
                    setFilter({
                      mode: "day",
                      day: today,
                      month: monthStringFromDate(today),
                      year: yearStringFromDate(today),
                      from: today,
                      to: today,
                      type: "all",
                      category: "all",
                    });
                  }}
                  className="w-full rounded-xl bg-slate-100 px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-200"
                >
                  {lang === "th" ? "รีเซ็ตตัวกรอง" : "Reset filters"}
                </button>
              </div>
            </div>
          </div>
        </section>

        {loading ? (
          <div className="glass-panel rounded-[30px] px-6 py-14 text-center text-sm text-slate-500">{t.loading}</div>
        ) : (
          <>
            <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <StatCard label={t.totalExpense} value={computed.totals.totalExpense} eyebrow="Expense" tone="expense" />
              <StatCard label={t.totalIncome} value={computed.totals.totalIncome} eyebrow="Income" tone="income" />
              <StatCard label={t.balance} value={computed.totals.balance} eyebrow="Balance" tone="balance" />
            </section>

            <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
              <div className="app-card rounded-[30px] px-4 py-5 sm:px-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">{t.categoriesManaged}</p>
                    <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{t.budgetCaps}</h2>
                    <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-600">{t.budgetCapsDesc}</p>
                  </div>

                  <button
                    onClick={() => setCaps(DEFAULT_CAPS)}
                    className="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-rose-50 hover:text-rose-700"
                  >
                    {t.resetCaps}
                  </button>
                </div>

                <div className="mt-6 grid gap-4 md:grid-cols-[0.95fr_1.05fr]">
                  <label className="block space-y-2 rounded-[24px] border border-slate-200 bg-slate-50/80 px-4 py-4">
                    <span className="text-sm font-medium text-slate-700">{t.incomeCap}</span>
                    <input
                      type="number"
                      min={0}
                      value={caps.incomeCap}
                      onChange={(event) =>
                        setCaps((prev) => ({
                          ...prev,
                          incomeCap: parseNumberInput(event.target.value),
                        }))
                      }
                      className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                      placeholder="50000"
                    />
                  </label>

                  <div className="rounded-[24px] bg-slate-950 px-4 py-4 text-white">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-300">{t.expenseRemainingFromIncomeCap}</p>
                    <p className={`mt-3 text-2xl font-semibold tracking-tight ${computed.incomeRemaining >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                      {formatCurrency(computed.incomeRemaining)}
                    </p>
                    {computed.incomeCap > 0 ? (
                      <>
                        <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/15">
                          <div
                            className="h-full rounded-full bg-[linear-gradient(90deg,#5eead4,#38bdf8)]"
                            style={{ width: `${computed.incomeProgress}%` }}
                          />
                        </div>
                        <p className="mt-2 text-xs text-slate-300">
                          {t.incomeProgress}: {computed.incomeProgress.toFixed(1)}%
                        </p>
                      </>
                    ) : null}
                    <p className="mt-2 text-xs text-slate-400">{t.formula}</p>
                  </div>
                </div>

                <div className="mt-6 rounded-[24px] border border-dashed border-slate-300 bg-slate-50/70 px-4 py-4">
                  <p className="text-sm font-semibold text-slate-800">{t.addCategory}</p>
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <input
                      type="text"
                      value={newCategoryInput}
                      onChange={(event) => setNewCategoryInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") addCustomCategory();
                      }}
                      placeholder={t.addCategoryPlaceholder}
                      className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                    />
                    <button
                      onClick={addCustomCategory}
                      className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800"
                    >
                      {t.add}
                    </button>
                  </div>
                </div>

                <div className="mt-6 grid gap-3">
                  {computed.categoryRows.map((row) => {
                    const isOver = row.cap > 0 && row.spent > row.cap;

                    return (
                      <div key={row.key} className="rounded-[24px] border border-slate-200 bg-white px-4 py-4 shadow-sm">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                                {row.code}
                              </span>
                              <span className="text-sm font-semibold text-slate-900">{row.label}</span>
                              {row.canRemove ? (
                                <button
                                  onClick={() => removeCustomCategory(row.key)}
                                  className="rounded-full bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-100"
                                >
                                  {t.remove}
                                </button>
                              ) : null}
                            </div>
                          </div>

                          <label className="flex items-center gap-3 text-sm text-slate-600">
                            <span>{t.cap}</span>
                            <input
                              type="number"
                              min={0}
                              value={caps.categories[row.key]}
                              onChange={(event) =>
                                setCaps((prev) => ({
                                  ...prev,
                                  categories: {
                                    ...prev.categories,
                                    [row.key]: parseNumberInput(event.target.value),
                                  },
                                }))
                              }
                              className="w-28 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                            />
                          </label>
                        </div>

                        <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className={`h-full rounded-full ${isOver ? "bg-[linear-gradient(90deg,#fb7185,#ef4444)]" : "bg-[linear-gradient(90deg,#2563eb,#38bdf8)]"}`}
                            style={{ width: `${row.percent}%` }}
                          />
                        </div>

                        <div className="mt-4 grid gap-2 text-xs text-slate-600 sm:grid-cols-3">
                          <p>
                            {t.spent}: <span className="font-semibold text-slate-900">{formatCurrency(row.spent)}</span>
                          </p>
                          <p>
                            {t.remaining}:{" "}
                            <span className={`font-semibold ${row.remaining >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                              {row.cap > 0 ? formatCurrency(Math.max(row.remaining, 0)) : t.noCap}
                            </span>
                          </p>
                          <p>
                            {isOver ? t.overCap : t.usage}:{" "}
                            <span className={`font-semibold ${isOver ? "text-rose-700" : "text-blue-700"}`}>
                              {row.cap > 0
                                ? isOver
                                  ? formatCurrency(row.overBy)
                                  : `${row.percent.toFixed(1)}%`
                                : t.noCap}
                            </span>
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="app-card rounded-[30px] px-4 py-5 sm:px-6">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Activity</p>
                    <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
                      {t.allTransactions} ({transactions.length})
                    </h2>
                  </div>
                </div>

                {transactions.length === 0 ? (
                  <div className="mt-6 rounded-[24px] border border-dashed border-slate-300 bg-slate-50/70 px-4 py-10 text-center text-sm text-slate-500">
                    {t.noTransactions}
                  </div>
                ) : (
                  <div className="mt-6 flex max-h-[52rem] flex-col gap-3 overflow-y-auto pr-1">
                    {transactions.map((tx) => (
                      <div
                        key={tx.id}
                        className="rounded-[24px] border border-slate-200 bg-white px-4 py-4 shadow-sm"
                      >
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                                {CATEGORY_CODE_MAP[tx.category] ?? "OT"} {getCategoryLabel(tx.category, lang)}
                              </span>
                            </div>
                            <p className="mt-3 truncate text-sm font-semibold text-slate-900">{tx.merchant || tx.item}</p>
                            <p className="mt-1 text-xs text-slate-500">
                              {new Date(tx.datetime).toLocaleDateString("th-TH", {
                                day: "numeric",
                                month: "short",
                                year: "2-digit",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </p>
                          </div>

                          <div className="text-left sm:text-right">
                            <p className={`text-lg font-semibold ${tx.type === "income" ? "text-emerald-600" : "text-rose-500"}`}>
                              {tx.type === "income" ? "+" : "-"}
                              {formatCurrency(Number(tx.amount || 0))}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

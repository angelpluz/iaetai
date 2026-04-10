import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  ...(process.env.OPENAI_BASE_URL ? { baseURL: process.env.OPENAI_BASE_URL } : {}),
});
const RAW_CHAT_MODEL =
  process.env.OPENAI_MODEL ?? process.env.LARGE_MODEL ?? process.env.DEFAULT_MODEL ?? "gpt-5-nano";
const CHAT_MODEL = RAW_CHAT_MODEL.replace(/^openai\//, "");
const RAW_EXTRACTION_MODEL =
  process.env.EXTRACTION_MODEL ?? process.env.FAST_MODEL ?? process.env.SMALL_MODEL ?? "gpt-5-nano";
const EXTRACTION_MODEL = RAW_EXTRACTION_MODEL.replace(/^openai\//, "");
const GW = process.env.API_GATEWAY_URL || "http://localhost:4272";

const TRANSACTION_CATEGORIES = ["food", "transport", "shopping", "bill", "transfer", "other"] as const;
type TransactionCategory = (typeof TRANSACTION_CATEGORIES)[number];
type TransactionType = "expense" | "income";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

type AssistantEmotion = "friendly" | "happy" | "concerned" | "encouraging" | "neutral";
type AssistantPersona = "friendly" | "professional" | "coach" | "playful";

interface ParsedTransaction {
  item: string;
  amount: number;
  type: TransactionType;
  category: TransactionCategory;
  merchant: string;
  bank: string | null;
  datetime: string;
  reference: string | null;
}

interface TransactionPayload {
  item: string;
  amount: number;
  type: TransactionType;
  category: TransactionCategory;
  merchant: string;
  bank: string | null;
  datetime: string;
  reference: string | null;
}

interface SaveResult {
  saved: boolean;
  transaction: unknown;
  hasToken: boolean;
  status?: number;
  error?: string;
  body?: unknown;
  requestPayload?: unknown;
}

interface TextExtractionResult {
  shouldSave: boolean;
  item: string | null;
  amount: number | null;
  type: TransactionType | null;
  category: TransactionCategory | null;
  merchant: string | null;
  bank: string | null;
  datetime: string | null;
  reference: string | null;
}

type SummaryMode = "all" | "day" | "month" | "year" | "range";
type SummaryReplyStyle = "direct" | "assistant";

interface SummaryFilter {
  mode: SummaryMode;
  day?: string;
  month?: string;
  year?: string;
  from?: string;
  to?: string;
  type?: "expense" | "income";
  category?: string;
}

interface SummaryIntent {
  shouldSummarize: boolean;
  filter: SummaryFilter;
  replyStyle: SummaryReplyStyle;
}

interface GatewaySummaryData {
  totalExpense: number;
  totalIncome: number;
  balance: number;
  categories: Array<{ category: string; total: number }>;
}

interface GatewayTransactionRow {
  id: string;
  item: string;
  amount: number;
  type: "expense" | "income";
  category: string;
  merchant: string;
  datetime: string;
}

interface GatewaySummaryContext {
  summary: GatewaySummaryData;
  txRows: GatewayTransactionRow[];
  totalIncome: number;
  totalExpense: number;
  balance: number;
  periodLabel: string;
}

const TRANSACTION_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["item", "amount", "type", "category", "merchant", "bank", "datetime", "reference"],
  properties: {
    item: { type: "string" },
    amount: { type: "number" },
    type: { type: "string", enum: ["expense", "income"] },
    category: { type: "string", enum: [...TRANSACTION_CATEGORIES] },
    merchant: { type: "string" },
    bank: {
      anyOf: [{ type: "string" }, { type: "null" }],
    },
    datetime: { type: "string" },
    reference: {
      anyOf: [{ type: "string" }, { type: "null" }],
    },
  },
};

const TEXT_EXTRACTION_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [
    "shouldSave",
    "item",
    "amount",
    "type",
    "category",
    "merchant",
    "bank",
    "datetime",
    "reference",
  ],
  properties: {
    shouldSave: { type: "boolean" },
    item: { anyOf: [{ type: "string" }, { type: "null" }] },
    amount: { anyOf: [{ type: "number" }, { type: "null" }] },
    type: {
      anyOf: [{ type: "string", enum: ["expense", "income"] }, { type: "null" }],
    },
    category: {
      anyOf: [{ type: "string", enum: [...TRANSACTION_CATEGORIES] }, { type: "null" }],
    },
    merchant: { anyOf: [{ type: "string" }, { type: "null" }] },
    bank: { anyOf: [{ type: "string" }, { type: "null" }] },
    datetime: { anyOf: [{ type: "string" }, { type: "null" }] },
    reference: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
};

const SUMMARY_INTENT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [
    "shouldSummarize",
    "replyStyle",
    "mode",
    "day",
    "month",
    "year",
    "from",
    "to",
    "type",
    "category",
  ],
  properties: {
    shouldSummarize: { type: "boolean" },
    replyStyle: { type: "string", enum: ["direct", "assistant"] },
    mode: { type: "string", enum: ["all", "day", "month", "year", "range"] },
    day: { anyOf: [{ type: "string" }, { type: "null" }] },
    month: { anyOf: [{ type: "string" }, { type: "null" }] },
    year: { anyOf: [{ type: "string" }, { type: "null" }] },
    from: { anyOf: [{ type: "string" }, { type: "null" }] },
    to: { anyOf: [{ type: "string" }, { type: "null" }] },
    type: {
      anyOf: [{ type: "string", enum: ["expense", "income"] }, { type: "null" }],
    },
    category: {
      anyOf: [{ type: "string", enum: [...TRANSACTION_CATEGORIES] }, { type: "null" }],
    },
  },
};

const OCR_TEXT_PARSE_PROMPT = `Extract exactly one finalized financial transaction from OCR text.
Fix common OCR issues (O→0, l→1, "10o.00"→100.00).

Rules:
- Return one transaction only.
- Use the final paid/received amount (keywords like total, grand total, amount paid, net, ยอดสุทธิ, ยอดชำระ, จำนวนเงิน).
- Ignore line-item prices, subtotal/tax/discount lines, and running balances.
- If multiple totals exist, pick the amount the customer actually paid/received.
- category must be one of: food, transport, shopping, bill, transfer, other.
- If date/time missing, use current time.
- bank/reference should be null when not shown.
`;

const SUMMARY_INTENT_PROMPT = `You are an intent classifier for a personal finance assistant.
Decide whether a user message should query the transaction database.

Use shouldSummarize=true for:
- totals, sums, balances
- category/merchant rankings
- "all data", "all transactions", lists, history
- spending/income questions grounded in the user's saved records
- advice or analysis that must use the saved transaction history

Use replyStyle:
- direct: simple totals/lists/summaries
- assistant: natural questions, comparisons, explanations, advice, anomaly checks

Category mapping:
- fd, food, อาหาร => food
- tr, transport, เดินทาง, รถ => transport
- sh, shopping, ช้อป => shopping
- bl, bill, บิล, ค่าน้ำ, ค่าไฟ, ค่าเน็ต => bill
- tf, transfer, โอน => transfer

Time interpretation:
- "today" / "วันนี้" => day
- "yesterday" / "เมื่อวาน" => day
- "this month" / "เดือนนี้" => month
- "this year" / "ปีนี้" => year
- "all data" / "ทั้งหมด" / "ทุกรายการ" => all

Today in Bangkok is {today}.`;

const CHAT_SYSTEM = `You are a helpful AI expense tracking assistant for Thai users.
Help users track expenses, answer questions about spending, and provide financial insights.
Be concise and friendly. Reply in the same language as the user (Thai or English).`;

function personaInstruction(persona: AssistantPersona): string {
  switch (persona) {
    case "professional":
      return "Persona: professional financial assistant. Tone is clear, direct, and structured.";
    case "coach":
      return "Persona: budgeting coach. Tone is supportive, practical, and action-oriented.";
    case "playful":
      return "Persona: playful assistant. Tone is light and lively, but still useful and concise.";
    case "friendly":
    default:
      return "Persona: friendly assistant. Tone is warm, approachable, and concise.";
  }
}

const EMOTION_FORMAT_RULE = `Format rule:
- Start every reply with exactly one tag in the first line:
  [[emotion:friendly]] or [[emotion:happy]] or [[emotion:concerned]] or [[emotion:encouraging]] or [[emotion:neutral]]
- After that tag, write the normal reply text.
- Keep response concise and conversational.`;

const TEXT_AUTO_SAVE_PROMPT = `You are a transaction intent detector for an expense tracking app.
Given a single user message, decide if it should be auto-saved as a finished transaction.

Rules:
- shouldSave=true only when the message clearly states money already paid/received.
- shouldSave=false for questions, plans, reminders, or unclear amounts.
- amount must be number (no currency symbols). If unknown use null.
- type must be "expense" or "income".`;

const THAI_MONTH_ALIASES: Array<{ month: number; aliases: string[] }> = [
  { month: 1, aliases: ["มกราคม", "มกรา", "ม.ค.", "มค", "jan", "january"] },
  { month: 2, aliases: ["กุมภาพันธ์", "กุมภา", "ก.พ.", "กพ", "feb", "february"] },
  { month: 3, aliases: ["มีนาคม", "มีนา", "มี.ค.", "มีค", "mar", "march"] },
  { month: 4, aliases: ["เมษายน", "เมษา", "เม.ย.", "เมย", "เมษ", "apr", "april"] },
  { month: 5, aliases: ["พฤษภาคม", "พฤษภา", "พ.ค.", "พค", "may"] },
  { month: 6, aliases: ["มิถุนายน", "มิถุนา", "มิ.ย.", "มิย", "jun", "june"] },
  { month: 7, aliases: ["กรกฎาคม", "กรกฎา", "ก.ค.", "กค", "jul", "july"] },
  { month: 8, aliases: ["สิงหาคม", "สิงหา", "ส.ค.", "สค", "aug", "august"] },
  { month: 9, aliases: ["กันยายน", "กันยา", "ก.ย.", "กย", "sep", "september"] },
  { month: 10, aliases: ["ตุลาคม", "ตุลา", "ต.ค.", "ตค", "oct", "october"] },
  { month: 11, aliases: ["พฤศจิกายน", "พฤศจิกา", "พ.ย.", "พย", "nov", "november"] },
  { month: 12, aliases: ["ธันวาคม", "ธันวา", "ธ.ค.", "ธค", "dec", "december"] },
];

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toBangkokDateLiteral(date: Date): string {
  const bangkokMs = date.getTime() + 7 * 60 * 60 * 1000;
  const shifted = new Date(bangkokMs);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function currentBangkokYear(now: Date): number {
  return Number(toBangkokDateLiteral(now).slice(0, 4));
}

function normalizeCalendarYear(raw: string, fallbackYear: number): number {
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return fallbackYear;

  let year = numeric;
  if (year > 2400) year -= 543;
  if (year < 100) year += 2000;
  if (year < 1900 || year > 2200) return fallbackYear;
  return year;
}

function toDateLiteral(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  const yyyy = String(year).padStart(4, "0");
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function parseSlashDateLiteral(raw: string, fallbackYear: number): string | null {
  const parts = raw.split("/").map((part) => part.trim());
  if (parts.length < 2 || parts.length > 3) return null;

  const day = Number(parts[0]);
  const month = Number(parts[1]);
  const year = parts.length === 3 ? normalizeCalendarYear(parts[2], fallbackYear) : fallbackYear;
  return toDateLiteral(year, month, day);
}

function parseIsoDateLiteral(raw: string): string | null {
  const match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return null;
  return toDateLiteral(Number(match[1]), Number(match[2]), Number(match[3]));
}

function parseThaiMonthDateLiteral(text: string, fallbackYear: number): string | null {
  const lowered = text.toLowerCase();

  for (const monthInfo of THAI_MONTH_ALIASES) {
    for (const alias of monthInfo.aliases) {
      const pattern = new RegExp(`(?:วันที่\\s*)?(\\d{1,2})\\s*${escapeRegExp(alias)}(?:\\s*(\\d{2,4}))?`, "i");
      const match = lowered.match(pattern);
      if (!match) continue;

      const day = Number(match[1]);
      const year = match[2] ? normalizeCalendarYear(match[2], fallbackYear) : fallbackYear;
      const literal = toDateLiteral(year, monthInfo.month, day);
      if (literal) return literal;
    }
  }

  return null;
}

function parseThaiMonthOnly(text: string, fallbackYear: number): { month: string; year: string } | null {
  const lowered = text.toLowerCase();

  for (const monthInfo of THAI_MONTH_ALIASES) {
    for (const alias of monthInfo.aliases) {
      const pattern = new RegExp(`(?:เดือน\\s*)?${escapeRegExp(alias)}(?:\\s*(\\d{2,4}))?`, "i");
      const match = lowered.match(pattern);
      if (!match) continue;

      const year = match[1] ? normalizeCalendarYear(match[1], fallbackYear) : fallbackYear;
      return {
        month: `${year}-${String(monthInfo.month).padStart(2, "0")}`,
        year: String(year),
      };
    }
  }

  return null;
}

function parseRangeLiterals(text: string, fallbackYear: number): { from: string; to: string } | null {
  const isoMatches = Array.from(text.matchAll(/\b\d{4}-\d{1,2}-\d{1,2}\b/g))
    .map((entry) => parseIsoDateLiteral(entry[0]))
    .filter((value): value is string => Boolean(value));

  if (isoMatches.length >= 2) {
    const sorted = [...isoMatches].sort();
    return { from: sorted[0], to: sorted[sorted.length - 1] };
  }

  const slashMatches = Array.from(text.matchAll(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g))
    .map((entry) => parseSlashDateLiteral(entry[0], fallbackYear))
    .filter((value): value is string => Boolean(value));

  if (slashMatches.length >= 2) {
    const sorted = [...slashMatches].sort();
    return { from: sorted[0], to: sorted[sorted.length - 1] };
  }

  return null;
}

function createDefaultSummaryFilter(today: string): SummaryFilter {
  return {
    mode: "day",
    day: today,
  };
}

function looksLikeConversationalFinanceQuestion(text: string): boolean {
  return /ไหม|มั้ย|หรือเปล่า|ยังไง|อย่างไร|ทำไม|เพราะอะไร|ปัญหา|ผิดปกติ|แนะนำ|ควร|ช่วยดู|วิเคราะห์|เปรียบเทียบ|เทียบ|แนวโน้ม|แพงสุด|สูงสุด|ต่ำสุด|ไหน|อะไร|how|why|which|compare|trend|advice|anomaly|problem/u.test(
    text
  );
}

function looksLikePotentialDbFinanceQuestion(text: string): boolean {
  return /ยอด|รวม|ทั้งหมด|ข้อมูล|รายการ|ธุรกรรม|รายจ่าย|รายรับ|ใช้เงิน|เงิน|หมวด|หมวดหมู่|ร้าน|merchant|category|food|transport|shopping|bill|transfer|expense|income|fd|tr|sh|bl|tf|อาหาร|เดินทาง|ช้อป|บิล|โอน/u.test(
    text
  );
}

function parseSummaryIntent(text: string): SummaryIntent {
  const normalized = text.trim().toLowerCase();
  const now = new Date();
  const today = toBangkokDateLiteral(now);
  const yesterday = toBangkokDateLiteral(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  const fallbackYear = currentBangkokYear(now);
  const replyStyle: SummaryReplyStyle = looksLikeConversationalFinanceQuestion(normalized) ? "assistant" : "direct";

  const hasSummaryKeyword =
    /สรุป|ยอดรวม|รวมยอด|รวมให้|(?:^|\s)รวม(?:\s|$)|เท่าไหร่|เท่าไร|กี่บาท|summary|summarize|total|sum|เช็คยอด|ดูรายจ่าย|ดูรายรับ|ดูธุรกรรม|ทั้งหมด/u.test(
      normalized
    );
  const hasFinanceKeyword =
    /รายจ่าย|ค่าใช้จ่าย|รายรับ|ธุรกรรม|expense|income|transaction|food|transport|shopping|bill|transfer|อาหาร|เดินทาง|ช้อป|บิล|โอน|บาท|฿|thb|\bfd\b|\btr\b|\bsh\b|\bbl\b|\btf\b/u.test(
      normalized
    );
  const hasTimeOrScopeKeyword = /วันนี้|เมื่อวาน|วันที่|เดือน|ปี|ช่วง|ทั้งหมด|between|from|to|all|month|year/u.test(
    normalized
  );
  const hasAllDataKeyword = /ข้อมูลทั้งหมด|ทั้งหมดที่มี|all data|all transactions|ทุกธุรกรรม|ทุกรายการ/u.test(
    normalized
  );
  const shouldSummarize =
    hasAllDataKeyword ||
    (hasSummaryKeyword && (hasFinanceKeyword || hasTimeOrScopeKeyword)) ||
    (hasFinanceKeyword && hasTimeOrScopeKeyword);

  const filter: SummaryFilter = createDefaultSummaryFilter(today);

  if (/ทั้งหมด|all time|ทุกช่วง|all data|all transactions|ทุกธุรกรรม|ทุกรายการ/u.test(normalized)) {
    filter.mode = "all";
    delete filter.day;
  }

  const range = parseRangeLiterals(normalized, fallbackYear);
  if (range && /ถึง|between|from|to|ช่วง/u.test(normalized)) {
    filter.mode = "range";
    filter.from = range.from;
    filter.to = range.to;
    delete filter.day;
  }

  if (/เมื่อวาน|yesterday/u.test(normalized)) {
    filter.mode = "day";
    filter.day = yesterday;
    delete filter.from;
    delete filter.to;
  } else if (/วันนี้|today/u.test(normalized)) {
    filter.mode = "day";
    filter.day = today;
    delete filter.from;
    delete filter.to;
  }

  const explicitIso = normalized.match(/\b\d{4}-\d{1,2}-\d{1,2}\b/);
  if (explicitIso) {
    const literal = parseIsoDateLiteral(explicitIso[0]);
    if (literal) {
      filter.mode = "day";
      filter.day = literal;
      delete filter.from;
      delete filter.to;
    }
  }

  const explicitSlash = normalized.match(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/);
  if (explicitSlash) {
    const literal = parseSlashDateLiteral(explicitSlash[0], fallbackYear);
    if (literal) {
      filter.mode = "day";
      filter.day = literal;
      delete filter.from;
      delete filter.to;
    }
  }

  const thaiLiteral = parseThaiMonthDateLiteral(normalized, fallbackYear);
  if (thaiLiteral) {
    filter.mode = "day";
    filter.day = thaiLiteral;
    delete filter.from;
    delete filter.to;
  }

  if (/เดือนนี้|this month/u.test(normalized)) {
    filter.mode = "month";
    filter.month = today.slice(0, 7);
    delete filter.day;
    delete filter.from;
    delete filter.to;
  }

  const monthInput = normalized.match(/เดือน\s*(\d{1,2})(?:\s*\/\s*(\d{2,4}))?/u);
  if (monthInput) {
    const month = Number(monthInput[1]);
    if (month >= 1 && month <= 12) {
      const year = monthInput[2] ? normalizeCalendarYear(monthInput[2], fallbackYear) : fallbackYear;
      filter.mode = "month";
      filter.month = `${year}-${String(month).padStart(2, "0")}`;
      filter.year = String(year);
      delete filter.day;
      delete filter.from;
      delete filter.to;
    }
  } else {
    const thaiMonth = parseThaiMonthOnly(normalized, fallbackYear);
    if (thaiMonth && !thaiLiteral) {
      filter.mode = "month";
      filter.month = thaiMonth.month;
      filter.year = thaiMonth.year;
      delete filter.day;
      delete filter.from;
      delete filter.to;
    }
  }

  if (/ปีนี้|this year/u.test(normalized)) {
    filter.mode = "year";
    filter.year = String(fallbackYear);
    delete filter.day;
    delete filter.month;
    delete filter.from;
    delete filter.to;
  }

  const yearInput = normalized.match(/ปี\s*(\d{2,4})/u);
  if (yearInput) {
    filter.mode = "year";
    filter.year = String(normalizeCalendarYear(yearInput[1], fallbackYear));
    delete filter.day;
    delete filter.month;
    delete filter.from;
    delete filter.to;
  }

  const hasIncomeHint = /รายรับ|income|รับเงิน|\binc\b/u.test(normalized);
  const hasExpenseHint = /รายจ่าย|ค่าใช้จ่าย|expense|ใช้จ่าย|\bexp\b/u.test(normalized);
  if (hasIncomeHint && !hasExpenseHint) {
    filter.type = "income";
  } else if (hasExpenseHint && !hasIncomeHint) {
    filter.type = "expense";
  }

  if (/\bfd\b|อาหาร|food/u.test(normalized)) filter.category = "food";
  if (/\btr\b|เดินทาง|transport|รถ|ค่าโดยสาร/u.test(normalized)) filter.category = "transport";
  if (/\bsh\b|ช้อป|shopping/u.test(normalized)) filter.category = "shopping";
  if (/\bbl\b|บิล|bill|ค่าน้ำ|ค่าไฟ|ค่าเน็ต/u.test(normalized)) filter.category = "bill";
  if (/\btf\b|โอน|transfer/u.test(normalized)) filter.category = "transfer";

  return { shouldSummarize, filter, replyStyle };
}

function buildSummaryQuery(filter: SummaryFilter, includePagination: boolean): URLSearchParams {
  const qs = new URLSearchParams();
  qs.set("mode", filter.mode);
  if (filter.mode === "day" && filter.day) qs.set("day", filter.day);
  if (filter.mode === "month" && filter.month) qs.set("month", filter.month);
  if (filter.mode === "year" && filter.year) qs.set("year", filter.year);
  if (filter.mode === "range") {
    if (filter.from) qs.set("from", filter.from);
    if (filter.to) qs.set("to", filter.to);
  }
  if (filter.type) qs.set("type", filter.type);
  if (filter.category) qs.set("category", filter.category);
  if (includePagination) {
    qs.set("limit", "200");
    qs.set("offset", "0");
  }
  return qs;
}

function parseSummaryBody(body: unknown): GatewaySummaryData {
  if (!body || typeof body !== "object") {
    return { totalExpense: 0, totalIncome: 0, balance: 0, categories: [] };
  }
  const row = body as Record<string, unknown>;
  return {
    totalExpense: typeof row.totalExpense === "number" ? row.totalExpense : 0,
    totalIncome: typeof row.totalIncome === "number" ? row.totalIncome : 0,
    balance: typeof row.balance === "number" ? row.balance : 0,
    categories: Array.isArray(row.categories)
      ? (row.categories as Array<{ category: string; total: number }>)
      : [],
  };
}

function parseTransactionsBody(body: unknown): GatewayTransactionRow[] {
  const source = Array.isArray(body)
    ? body
    : body && typeof body === "object" && Array.isArray((body as { transactions?: unknown }).transactions)
      ? ((body as { transactions: unknown[] }).transactions ?? [])
      : [];

  return source.map((entry, index) => {
    const row = typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>) : {};
    const type = normalizeType(row.type);
    return {
      id: String(row.id ?? index),
      item: cleanText(row.item) || "รายการ",
      amount: normalizeAmount(row.amount),
      type,
      category: cleanText(row.category) || "other",
      merchant: cleanText(row.merchant) || cleanText(row.item) || "ไม่ระบุร้าน",
      datetime: cleanText(row.datetime),
    };
  });
}

function formatTHB(value: number): string {
  return `THB ${Number(value || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatPeriodLabel(filter: SummaryFilter): string {
  if (filter.mode === "day" && filter.day) {
    const date = new Date(`${filter.day}T00:00:00+07:00`);
    return `วันที่ ${date.toLocaleDateString("th-TH", {
      day: "numeric",
      month: "short",
      year: "numeric",
    })}`;
  }
  if (filter.mode === "month" && filter.month) return `เดือน ${filter.month}`;
  if (filter.mode === "year" && filter.year) return `ปี ${filter.year}`;
  if (filter.mode === "range") return `ช่วง ${filter.from ?? "?"} ถึง ${filter.to ?? "?"}`;
  return "ทุกช่วงเวลา";
}

function normalizeCategoryLabel(category: string): string {
  const key = category.toLowerCase();
  if (key === "food") return "อาหาร";
  if (key === "transport") return "เดินทาง";
  if (key === "shopping") return "ช้อปปิ้ง";
  if (key === "bill") return "บิล";
  if (key === "transfer") return "โอน";
  return category || "อื่นๆ";
}

async function parseGatewayResponseBody(response: Response): Promise<unknown> {
  const raw = await response.text();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

function normalizeSummaryIntentRecord(raw: Record<string, unknown>, fallbackToday: string): SummaryIntent {
  const filter: SummaryFilter = createDefaultSummaryFilter(fallbackToday);

  const mode =
    raw.mode === "all" || raw.mode === "day" || raw.mode === "month" || raw.mode === "year" || raw.mode === "range"
      ? raw.mode
      : filter.mode;
  filter.mode = mode;

  const day = cleanText(raw.day);
  const month = cleanText(raw.month);
  const year = cleanText(raw.year);
  const from = cleanText(raw.from);
  const to = cleanText(raw.to);

  if (mode === "all") {
    delete filter.day;
  } else if (mode === "day") {
    filter.day = day || fallbackToday;
  } else if (mode === "month") {
    filter.month = month || fallbackToday.slice(0, 7);
    delete filter.day;
  } else if (mode === "year") {
    filter.year = year || fallbackToday.slice(0, 4);
    delete filter.day;
  } else if (mode === "range") {
    if (from) filter.from = from;
    if (to) filter.to = to;
    delete filter.day;
  }

  const type = raw.type === "expense" || raw.type === "income" ? raw.type : null;
  if (type) filter.type = type;

  const category =
    raw.category === "food" ||
    raw.category === "transport" ||
    raw.category === "shopping" ||
    raw.category === "bill" ||
    raw.category === "transfer" ||
    raw.category === "other"
      ? raw.category
      : null;
  if (category) filter.category = category;

  const replyStyle: SummaryReplyStyle = raw.replyStyle === "assistant" ? "assistant" : "direct";

  return {
    shouldSummarize: Boolean(raw.shouldSummarize),
    filter,
    replyStyle,
  };
}

async function inferSummaryIntentWithAI(text: string): Promise<SummaryIntent | null> {
  const today = toBangkokDateLiteral(new Date());
  const prompt = `${SUMMARY_INTENT_PROMPT.replace("{today}", today)}\n\nUser message:\n${text}`;
  const raw = await callStructuredResponse(prompt, "summary_intent", SUMMARY_INTENT_SCHEMA);
  if (!raw) return null;
  return normalizeSummaryIntentRecord(raw, today);
}

async function loadGatewaySummaryContext(
  filter: SummaryFilter
): Promise<{ ok: boolean; data?: GatewaySummaryContext; error?: string; reply?: string; emotion?: AssistantEmotion }> {
  const jar = await cookies();
  const token = jar.get("auth_token")?.value ?? "";
  if (!token) {
    return {
      ok: false,
      reply: "ยังไม่พบสิทธิ์ผู้ใช้ กรุณาเข้าสู่ระบบใหม่ก่อนสรุปรายการ",
      emotion: "concerned",
      error: "missing auth token",
    };
  }

  const summaryQuery = buildSummaryQuery(filter, false);
  const transactionQuery = buildSummaryQuery(filter, true);

  const [summaryRes, txRes] = await Promise.all([
    fetch(`${GW}/api/v1/transactions/summary?${summaryQuery.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    }),
    fetch(`${GW}/api/v1/transactions?${transactionQuery.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    }),
  ]);

  const [summaryBody, txBody] = await Promise.all([
    parseGatewayResponseBody(summaryRes),
    parseGatewayResponseBody(txRes),
  ]);

  if (!summaryRes.ok && !txRes.ok) {
    const summaryError = extractGatewayErrorMessage(summaryBody);
    const txError = extractGatewayErrorMessage(txBody);
    return {
      ok: false,
      reply: "ดึงข้อมูลสรุปไม่สำเร็จ ลองใหม่อีกครั้งได้เลย",
      emotion: "concerned",
      error: summaryError || txError || `summary ${summaryRes.status} / tx ${txRes.status}`,
    };
  }

  const summary = parseSummaryBody(summaryBody);
  const txRows = parseTransactionsBody(txBody);

  const computedTotals = txRows.reduce(
    (acc, row) => {
      if (row.type === "income") acc.totalIncome += row.amount;
      else acc.totalExpense += row.amount;
      return acc;
    },
    { totalIncome: 0, totalExpense: 0 }
  );

  const totalIncome = summaryRes.ok ? summary.totalIncome : computedTotals.totalIncome;
  const totalExpense = summaryRes.ok ? summary.totalExpense : computedTotals.totalExpense;
  const balance = summaryRes.ok ? summary.balance : totalIncome - totalExpense;
  const periodLabel = formatPeriodLabel(filter);

  return {
    ok: true,
    data: {
      summary,
      txRows,
      totalIncome,
      totalExpense,
      balance,
      periodLabel,
    },
  };
}

function buildFinanceContextBlock(context: GatewaySummaryContext): string {
  const categoryLines = context.summary.categories
    .slice()
    .sort((a, b) => Number(b.total || 0) - Number(a.total || 0))
    .slice(0, 5)
    .map((row) => `- ${normalizeCategoryLabel(String(row.category))}: ${formatTHB(Number(row.total || 0))}`);

  const transactionLines = context.txRows
    .slice()
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 12)
    .map((row) => {
      const date = cleanText(row.datetime);
      return `- ${row.merchant || row.item} | ${row.type} | ${normalizeCategoryLabel(row.category)} | ${formatTHB(row.amount)} | ${date}`;
    });

  return [
    `ช่วงข้อมูล: ${context.periodLabel}`,
    `จำนวนรายการ: ${context.txRows.length}`,
    `รายจ่ายรวม: ${formatTHB(context.totalExpense)}`,
    `รายรับรวม: ${formatTHB(context.totalIncome)}`,
    `คงเหลือสุทธิ: ${formatTHB(context.balance)}`,
    "หมวดหลัก:",
    ...(categoryLines.length > 0 ? categoryLines : ["- ไม่มีข้อมูลหมวด"]),
    "รายการอ้างอิง:",
    ...(transactionLines.length > 0 ? transactionLines : ["- ไม่มีรายการ"]),
  ].join("\n");
}

async function summarizeFromGateway(filter: SummaryFilter): Promise<{ ok: boolean; reply: string; emotion: AssistantEmotion; error?: string }> {
  const loaded = await loadGatewaySummaryContext(filter);
  if (!loaded.ok) {
    return {
      ok: false,
      reply: loaded.reply ?? "ดึงข้อมูลสรุปไม่สำเร็จ ลองใหม่อีกครั้งได้เลย",
      emotion: loaded.emotion ?? "concerned",
      error: loaded.error,
    };
  }

  const context = loaded.data as GatewaySummaryContext;
  if (context.txRows.length === 0) {
    return {
      ok: true,
      reply: `ดึงข้อมูลจากระบบให้แล้ว (${context.periodLabel}) แต่ยังไม่พบรายการตามเงื่อนไขนี้`,
      emotion: "neutral",
    };
  }

  const categoryLines = context.summary.categories
    .slice()
    .sort((a, b) => Number(b.total || 0) - Number(a.total || 0))
    .slice(0, 3)
    .map((row) => `- ${normalizeCategoryLabel(String(row.category))}: ${formatTHB(Number(row.total || 0))}`);

  const topType = filter.type === "income" ? "income" : "expense";
  const topTx = context.txRows
    .filter((row) => row.type === topType)
    .sort((a, b) => b.amount - a.amount)[0];

  const lines: string[] = [
    `สรุปจากข้อมูลจริงในระบบ (${context.periodLabel})`,
    `- จำนวนรายการ: ${context.txRows.length} รายการ`,
    `- รายจ่ายรวม: ${formatTHB(context.totalExpense)}`,
    `- รายรับรวม: ${formatTHB(context.totalIncome)}`,
    `- คงเหลือสุทธิ: ${formatTHB(context.balance)}`,
  ];

  if (categoryLines.length > 0) {
    lines.push("- หมวดที่ใช้สูงสุด:");
    lines.push(...categoryLines);
  }

  if (topTx) {
    lines.push(
      `- รายการสูงสุด: ${topTx.merchant || topTx.item} ${formatTHB(topTx.amount)}`
    );
  }

  return {
    ok: true,
    reply: lines.join("\n"),
    emotion: "happy",
  };
}

async function answerFinanceQuestionFromGateway(
  question: string,
  filter: SummaryFilter,
  persona: AssistantPersona
): Promise<{ ok: boolean; reply: string; emotion: AssistantEmotion; error?: string }> {
  const loaded = await loadGatewaySummaryContext(filter);
  if (!loaded.ok) {
    return {
      ok: false,
      reply: loaded.reply ?? "ดึงข้อมูลจากระบบไม่สำเร็จ",
      emotion: loaded.emotion ?? "concerned",
      error: loaded.error,
    };
  }

  const context = loaded.data as GatewaySummaryContext;
  if (context.txRows.length === 0) {
    return {
      ok: true,
      reply: `ดึงข้อมูลจากระบบให้แล้ว (${context.periodLabel}) แต่ยังไม่พบรายการตามเงื่อนไขนี้`,
      emotion: "neutral",
    };
  }

  const system = [
    CHAT_SYSTEM,
    personaInstruction(persona),
    "You are answering with real transaction data from the app database.",
    "Use only the provided data context. Do not invent transactions or totals.",
    "Answer naturally in the same language as the user.",
    "Be concise but human. If the user asks for advice, ground it in the actual data.",
    EMOTION_FORMAT_RULE,
  ].join("\n");

  const raw = await callOpenAI(
    [
      {
        role: "user",
        content: `User question:\n${question}\n\nDatabase context:\n${buildFinanceContextBlock(context)}`,
      },
    ],
    system
  );

  const parsed = extractEmotionAndText(raw);
  return {
    ok: true,
    reply: parsed.text,
    emotion: parsed.emotion,
  };
}

async function callOpenAI(messages: ChatMessage[], system?: string, model = CHAT_MODEL): Promise<string> {
  const response = await openai.responses.create({
    model,
    ...(system ? { instructions: system } : {}),
    input: messages.map((m) => ({ role: m.role, content: m.content })),
  });
  return response.output_text ?? "";
}

async function generateConversationalReply(
  messages: ChatMessage[],
  persona: AssistantPersona,
  saveContext?: {
    attempted: boolean;
    saved: boolean;
    amount?: number;
    merchant?: string;
    category?: string;
    error?: string;
  }
): Promise<{ text: string; emotion: AssistantEmotion }> {
  let system = `${CHAT_SYSTEM}\n${personaInstruction(persona)}`;

  if (saveContext?.attempted) {
    if (saveContext.saved) {
      system += `\nThe user's latest transaction was auto-saved successfully.
Mention that it is saved, then continue as a natural chat assistant.
Keep it concise and friendly.`;
    } else {
      system += `\nAuto-save was attempted but failed: ${saveContext.error ?? "unknown error"}.
Explain the save problem briefly, then continue normal helpful chat.
Keep it concise and friendly.`;
    }
  }

  const raw = await callOpenAI(messages, `${system}\n\n${EMOTION_FORMAT_RULE}`);
  return extractEmotionAndText(raw);
}

function extractEmotionAndText(raw: string): { text: string; emotion: AssistantEmotion } {
  const normalized = String(raw ?? "").trim();
  const match = normalized.match(/^\[\[emotion:(friendly|happy|concerned|encouraging|neutral)\]\]\s*/i);
  if (!match) {
    return { text: normalized, emotion: "friendly" };
  }

  const emotion = match[1].toLowerCase() as AssistantEmotion;
  const text = normalized.replace(match[0], "").trim();
  return {
    text: text || normalized,
    emotion,
  };
}

function normalizeAmount(raw: unknown): number {
  if (typeof raw === "number") return raw;
  const str = String(raw ?? "0")
    .replace(/[^\d.]/g, "")
    .replace(/o/gi, "0");
  return parseFloat(str) || 0;
}

function normalizeType(raw: unknown): TransactionType {
  const text = String(raw ?? "").trim().toLowerCase();
  if (text === "income" || text === "รายรับ" || text === "รับเงิน") return "income";
  return "expense";
}

function normalizeCategory(raw: unknown): TransactionCategory {
  const text = String(raw ?? "").trim().toLowerCase();
  if (text === "food" || text.includes("อาหาร")) return "food";
  if (text === "transport" || text.includes("เดินทาง") || text.includes("ค่าโดยสาร")) return "transport";
  if (text === "shopping" || text.includes("ช้อป")) return "shopping";
  if (text === "bill" || text.includes("บิล") || text.includes("ค่าน้ำ") || text.includes("ค่าไฟ")) return "bill";
  if (text === "transfer" || text.includes("โอน")) return "transfer";
  return "other";
}

function cleanText(raw: unknown): string {
  return String(raw ?? "").trim();
}

async function callStructuredResponse(
  prompt: string,
  schemaName: string,
  schema: Record<string, unknown>,
  model = EXTRACTION_MODEL
): Promise<Record<string, unknown> | null> {
  const response = await openai.responses.create({
    model,
    input: [{ role: "user", content: prompt }],
    text: {
      format: {
        type: "json_schema",
        name: schemaName,
        strict: true,
        schema,
      },
    },
  });

  const raw = (response.output_text ?? "").trim();
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function toParsedTransaction(raw: Record<string, unknown>): ParsedTransaction {
  const item = cleanText(raw.item) || "Payment";
  return {
    item,
    amount: normalizeAmount(raw.amount),
    type: normalizeType(raw.type),
    category: normalizeCategory(raw.category),
    merchant: cleanText(raw.merchant) || item,
    bank: cleanText(raw.bank) || null,
    datetime: cleanText(raw.datetime) || toBangkokIsoNoMs(new Date()),
    reference: cleanText(raw.reference) || null,
  };
}

async function parseTransactionFromOcrText(text: string): Promise<ParsedTransaction | null> {
  const parsed = await callStructuredResponse(
    `${OCR_TEXT_PARSE_PROMPT}\n\nOCR Text:\n${text}`,
    "ocr_transaction",
    TRANSACTION_RESPONSE_SCHEMA
  );
  if (!parsed) return null;
  return toParsedTransaction(parsed);
}

async function extractTransactionFromText(text: string): Promise<TextExtractionResult | null> {
  const obj = await callStructuredResponse(
    `${TEXT_AUTO_SAVE_PROMPT}\n\nUser message:\n${text}`,
    "text_autosave_transaction",
    TEXT_EXTRACTION_SCHEMA
  );
  if (!obj) return null;

  const amount = obj.amount === null || obj.amount === undefined ? null : normalizeAmount(obj.amount);
  const type = obj.type === "income" || obj.type === "expense" ? (obj.type as TransactionType) : null;
  const category =
    obj.category === "food" ||
    obj.category === "transport" ||
    obj.category === "shopping" ||
    obj.category === "bill" ||
    obj.category === "transfer" ||
    obj.category === "other"
      ? (obj.category as TransactionCategory)
      : null;

  return {
    shouldSave: Boolean(obj.shouldSave),
    item: obj.item ? String(obj.item) : null,
    amount,
    type,
    category,
    merchant: obj.merchant ? String(obj.merchant) : null,
    bank: obj.bank ? String(obj.bank) : null,
    datetime: obj.datetime ? String(obj.datetime) : null,
    reference: obj.reference ? String(obj.reference) : null,
  };
}

function shouldAttemptTextAutoSave(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;

  const hasAmount = /(?:^|[^\d])\d[\d,]*(?:\.\d{1,2})?(?:[^\d]|$)/u.test(normalized);
  const hasMoneyWord = /บาท|baht|thb|฿/u.test(normalized);
  const hasActionKeyword =
    /จ่าย|ซื้อ|กิน|ค่า|เติม|โอน|รับเงิน|ได้รับ|paid|spent|bought|transfer|received|income|expense/u.test(
      normalized
    );
  const looksLikeQuestionOrSummary = /\?|ไหม|มั้ย|หรือเปล่า|ช่วย|ควร|สรุป|summary|total|how|what|why/u.test(
    normalized
  );

  return hasAmount && (hasMoneyWord || hasActionKeyword) && !looksLikeQuestionOrSummary;
}

function isMockSaveCommand(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return (
    normalized === "/mock-save" ||
    normalized === "/test-save" ||
    normalized === "mock save" ||
    normalized === "test save" ||
    normalized === "เช็คบันทึก" ||
    normalized === "ทดสอบบันทึก"
  );
}

function toBangkokIsoNoMs(date: Date): string {
  const bangkokMs = date.getTime() + 7 * 60 * 60 * 1000;
  const shifted = new Date(bangkokMs);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  const hh = String(shifted.getUTCHours()).padStart(2, "0");
  const mm = String(shifted.getUTCMinutes()).padStart(2, "0");
  const ss = String(shifted.getUTCSeconds()).padStart(2, "0");
  return `${y}-${m}-${d}T${hh}:${mm}:${ss}+07:00`;
}

function toSqlDatetime(date: Date): string {
  const bangkokMs = date.getTime() + 7 * 60 * 60 * 1000;
  const shifted = new Date(bangkokMs);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  const hh = String(shifted.getUTCHours()).padStart(2, "0");
  const mm = String(shifted.getUTCMinutes()).padStart(2, "0");
  const ss = String(shifted.getUTCSeconds()).padStart(2, "0");
  return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
}

function normalizeDatetime(input: string): string {
  try {
    const trimmed = String(input ?? "").trim();
    if (trimmed && trimmed !== "today" && !isNaN(Date.parse(trimmed))) {
      return toSqlDatetime(new Date(trimmed));
    }
  } catch {
    // fall back to current time
  }
  return toSqlDatetime(new Date());
}

function extractGatewayErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const rec = body as Record<string, unknown>;
  const candidates = [rec.error, rec.message, rec.detail];
  for (const val of candidates) {
    if (typeof val === "string" && val.trim()) return val.trim();
  }
  return null;
}

async function saveTransactionToGateway(payload: TransactionPayload): Promise<SaveResult> {
  const jar = await cookies();
  const token = jar.get("auth_token")?.value ?? "";

  if (!token) {
    return {
      saved: false,
      transaction: null,
      hasToken: false,
      error: "ไม่พบ auth token",
    };
  }

  try {
    const normalizedPayload: Record<string, unknown> = {
      item: cleanText(payload.item) || "Payment",
      amount: normalizeAmount(payload.amount),
      type: normalizeType(payload.type),
      category: normalizeCategory(payload.category),
      merchant: cleanText(payload.merchant) || cleanText(payload.item) || "Payment",
      datetime: normalizeDatetime(payload.datetime),
    };

    const bank = cleanText(payload.bank);
    if (bank) normalizedPayload.bank = bank;

    const reference = cleanText(payload.reference);
    if (reference) normalizedPayload.reference = reference;

    const sendPayload = async (candidatePayload: Record<string, unknown>) =>
      fetch(`${GW}/api/v1/transactions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(candidatePayload),
      });

    const candidatePayload = normalizedPayload;
    const gwRes = await sendPayload(candidatePayload);

    const rawBody = await gwRes.text();
    let body: unknown = null;
    try {
      body = rawBody ? JSON.parse(rawBody) : null;
    } catch {
      body = rawBody;
    }

    if (!gwRes.ok) {
      const message = extractGatewayErrorMessage(body);
      return {
        saved: false,
        transaction: null,
        hasToken: true,
        status: gwRes.status,
        error: message ? `Gateway status ${gwRes.status}: ${message}` : `Gateway status ${gwRes.status}`,
        body,
        requestPayload: candidatePayload,
      };
    }

    const transaction =
      typeof body === "object" && body !== null && "transaction" in body
        ? (body as { transaction?: unknown }).transaction ?? body
        : body;

    return {
      saved: true,
      transaction: transaction ?? null,
      hasToken: true,
      status: gwRes.status,
      body,
      requestPayload: candidatePayload,
    };
  } catch (err) {
    return {
      saved: false,
      transaction: null,
      hasToken: true,
      error: err instanceof Error ? err.message : String(err),
      requestPayload: payload,
    };
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const messages: ChatMessage[] = body.messages ?? [];
  const ocrText: string | undefined = body.ocrText;
  const parsedImageTransactionRaw: unknown = body.parsedImageTransaction;
  const parsedImageTransaction =
    parsedImageTransactionRaw && typeof parsedImageTransactionRaw === "object"
      ? toParsedTransaction(parsedImageTransactionRaw as Record<string, unknown>)
      : null;
  const personaRaw = String(body.persona ?? "friendly");
  const persona: AssistantPersona =
    personaRaw === "professional" || personaRaw === "coach" || personaRaw === "playful" || personaRaw === "friendly"
      ? (personaRaw as AssistantPersona)
      : "friendly";
  const lastUserMessage = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";

  try {
    // ── Mock save mode: type /mock-save in chat to verify save pipeline ──────
    if (!ocrText && !parsedImageTransaction && isMockSaveCommand(lastUserMessage)) {
      const mockPayload: TransactionPayload = {
        item: "Mock transaction",
        amount: 123.45,
        type: "expense",
        category: "other",
        merchant: "Mock Store",
        bank: null,
        datetime: normalizeDatetime(new Date().toISOString()),
        reference: `mock-${Date.now()}`,
      };

      const saveResult = await saveTransactionToGateway(mockPayload);

      if (!saveResult.saved) {
        return Response.json({
          reply: `Mock save ไม่สำเร็จ: ${saveResult.error ?? "unknown error"}`,
          emotion: "concerned",
          saved: false,
          mock: true,
          saveCheck: {
            hasToken: saveResult.hasToken,
            status: saveResult.status ?? null,
            error: saveResult.error ?? null,
            body: saveResult.body ?? null,
            requestPayload: saveResult.requestPayload ?? null,
          },
        });
      }

      return Response.json({
        reply: "Mock save สำเร็จ ✅ ระบบบันทึกผ่าน chat ใช้งานได้",
        emotion: "happy",
        saved: true,
        transaction: saveResult.transaction,
        mock: true,
      });
    }

    // ── Summary mode: read from gateway and summarize existing records ───────
    if (!ocrText && !parsedImageTransaction) {
      let summaryIntent = parseSummaryIntent(lastUserMessage);
      if (!summaryIntent.shouldSummarize && looksLikePotentialDbFinanceQuestion(lastUserMessage)) {
        const aiSummaryIntent = await inferSummaryIntentWithAI(lastUserMessage);
        if (aiSummaryIntent?.shouldSummarize) {
          summaryIntent = aiSummaryIntent;
        }
      }

      if (summaryIntent.shouldSummarize) {
        const summaryResult =
          summaryIntent.replyStyle === "assistant"
            ? await answerFinanceQuestionFromGateway(lastUserMessage, summaryIntent.filter, persona)
            : await summarizeFromGateway(summaryIntent.filter);
        if (!summaryResult.ok) {
          return Response.json({
            reply: `ดึงข้อมูลสรุปไม่สำเร็จ: ${summaryResult.error ?? "unknown error"}`,
            emotion: "concerned",
            saved: false,
          });
        }

        return Response.json({
          reply: summaryResult.reply,
          emotion: summaryResult.emotion,
          saved: false,
          summarized: true,
        });
      }
    }

    // ── Image mode: parse OCR → save transaction ──────────────────────────────
    if (parsedImageTransaction || ocrText) {
      const parsed = parsedImageTransaction ?? (ocrText ? await parseTransactionFromOcrText(ocrText) : null);

      if (!parsed) {
        return Response.json({
          reply: "อ่านสลิปได้ แต่ไม่สามารถแยกข้อมูลได้ กรุณาลองใหม่",
          emotion: "concerned",
          saved: false,
        });
      }

      const amount = normalizeAmount(parsed.amount);

      if (amount <= 0) {
        return Response.json({
          reply: `อ่านสลิปได้แล้ว แต่ไม่พบจำนวนเงิน\nร้าน: ${parsed.merchant || parsed.item}\nกรุณาบอกจำนวนเงินที่ชำระ`,
          emotion: "concerned",
          saved: false,
          parsedData: parsed,
        });
      }

      const saveResult = await saveTransactionToGateway({
        item: parsed.item || "Payment",
        amount,
        type: parsed.type,
        category: parsed.category,
        merchant: parsed.merchant || "",
        bank: parsed.bank || null,
        datetime: normalizeDatetime(parsed.datetime),
        reference: parsed.reference || null,
      });

      if (!saveResult.saved) {
        return Response.json({
          reply: `อ่านสลิปได้ แต่บันทึกไม่สำเร็จ: ${saveResult.error ?? "unknown error"}`,
          emotion: "concerned",
          saved: false,
          parsedData: parsed,
          saveCheck: {
            hasToken: saveResult.hasToken,
            status: saveResult.status ?? null,
            error: saveResult.error ?? null,
            body: saveResult.body ?? null,
            requestPayload: saveResult.requestPayload ?? null,
          },
        });
      }

      return Response.json({
        reply: `บันทึกสำเร็จ ✅\n${parsed.merchant || parsed.item} ฿${amount.toLocaleString("th-TH")} (${parsed.category})`,
        emotion: "happy",
        transaction: saveResult.transaction,
        saved: true,
      });
    }

    // ── Text auto-save mode ────────────────────────────────────────────────────
    if (lastUserMessage) {
      const extracted = shouldAttemptTextAutoSave(lastUserMessage)
        ? await extractTransactionFromText(lastUserMessage)
        : null;

      if (extracted?.shouldSave && (extracted.amount ?? 0) > 0) {
        const amount = extracted.amount ?? 0;
        const saveResult = await saveTransactionToGateway({
          item: extracted.item || extracted.merchant || "Payment",
          amount,
          type: extracted.type || "expense",
          category: extracted.category || "other",
          merchant: extracted.merchant || "",
          bank: extracted.bank || null,
          datetime: normalizeDatetime(extracted.datetime ?? ""),
          reference: extracted.reference || null,
        });

        if (!saveResult.saved) {
          const aiReply = await generateConversationalReply(messages, persona, {
            attempted: true,
            saved: false,
            error: saveResult.error ?? "unknown error",
          });

          return Response.json({
            reply: aiReply.text,
            emotion: aiReply.emotion,
            saved: false,
            saveCheck: {
              hasToken: saveResult.hasToken,
              status: saveResult.status ?? null,
              error: saveResult.error ?? null,
              body: saveResult.body ?? null,
              requestPayload: saveResult.requestPayload ?? null,
            },
          });
        }

        const aiReply = await generateConversationalReply(messages, persona, {
          attempted: true,
          saved: true,
          amount,
          merchant: extracted.merchant || extracted.item || "Payment",
          category: extracted.category || "other",
        });

        return Response.json({
          reply: aiReply.text,
          emotion: aiReply.emotion,
          saved: true,
          transaction: saveResult.transaction,
          autoSaved: true,
        });
      }
    }

    // ── Text chat mode ─────────────────────────────────────────────────────────
    const aiReply = await generateConversationalReply(messages, persona);
    return Response.json({ reply: aiReply.text, emotion: aiReply.emotion, saved: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ reply: `เกิดข้อผิดพลาด: ${message}`, emotion: "concerned", saved: false }, { status: 500 });
  }
}

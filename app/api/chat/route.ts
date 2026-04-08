import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  ...(process.env.OPENAI_BASE_URL ? { baseURL: process.env.OPENAI_BASE_URL } : {}),
});
const RAW_MODEL =
  process.env.OPENAI_MODEL ?? process.env.LARGE_MODEL ?? process.env.DEFAULT_MODEL ?? "gpt-5-nano";
const MODEL = RAW_MODEL.replace(/^openai\//, "");
const GW = process.env.API_GATEWAY_URL || "http://localhost:4272";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

type AssistantEmotion = "friendly" | "happy" | "concerned" | "encouraging" | "neutral";
type AssistantPersona = "friendly" | "professional" | "coach" | "playful";

interface ParsedTransaction {
  item: string;
  amount: number;
  type: string;
  category: string;
  merchant: string;
  bank: string | null;
  datetime: string;
  reference: string | null;
}

interface TransactionPayload {
  item: string;
  amount: number;
  type: string;
  category: string;
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
  type: "expense" | "income" | null;
  category: "food" | "transport" | "shopping" | "bill" | "transfer" | "other" | null;
  merchant: string | null;
  bank: string | null;
  datetime: string | null;
  reference: string | null;
}

type SummaryMode = "all" | "day" | "month" | "year" | "range";

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

const AI_PARSE_PROMPT = `Extract financial transaction data from OCR text. Fix OCR errors (O→0, l→1, "10o.00"→100.00).
Return ONLY valid JSON, no extra text:
{
  "item": "description of the payment",
  "amount": 100.00,
  "type": "expense",
  "category": "food|transport|shopping|bill|transfer|other",
  "merchant": "store or sender name",
  "bank": "bank name or null",
  "datetime": "ISO datetime string (use today if not found)",
  "reference": "transaction reference or null"
}

OCR Text:
`;

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

Return ONLY valid JSON:
{
  "shouldSave": true,
  "item": "short description",
  "amount": 100.5,
  "type": "expense",
  "category": "food|transport|shopping|bill|transfer|other",
  "merchant": "merchant or person name",
  "bank": null,
  "datetime": null,
  "reference": null
}

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

function parseSummaryIntent(text: string): SummaryIntent {
  const normalized = text.trim().toLowerCase();
  const now = new Date();
  const today = toBangkokDateLiteral(now);
  const yesterday = toBangkokDateLiteral(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  const fallbackYear = currentBangkokYear(now);

  const hasSummaryKeyword =
    /สรุป|ยอดรวม|รวมยอด|รวมให้|เท่าไหร่|เท่าไร|กี่บาท|summary|summarize|total|เช็คยอด|ดูรายจ่าย|ดูรายรับ|ดูธุรกรรม/u.test(
      normalized
    );
  const hasFinanceKeyword = /รายจ่าย|ค่าใช้จ่าย|รายรับ|ธุรกรรม|expense|income|transaction/u.test(normalized);
  const hasTimeOrScopeKeyword = /วันนี้|เมื่อวาน|วันที่|เดือน|ปี|ช่วง|ทั้งหมด|between|from|to|all/u.test(normalized);
  const shouldSummarize = hasSummaryKeyword || (hasFinanceKeyword && hasTimeOrScopeKeyword);

  const filter: SummaryFilter = {
    mode: "day",
    day: today,
  };

  if (/ทั้งหมด|all time|ทุกช่วง/u.test(normalized)) {
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

  const hasIncomeHint = /รายรับ|income|รับเงิน/u.test(normalized);
  const hasExpenseHint = /รายจ่าย|ค่าใช้จ่าย|expense|ใช้จ่าย/u.test(normalized);
  if (hasIncomeHint && !hasExpenseHint) {
    filter.type = "income";
  } else if (hasExpenseHint && !hasIncomeHint) {
    filter.type = "expense";
  }

  if (/อาหาร|food/u.test(normalized)) filter.category = "food";
  if (/เดินทาง|transport|รถ|ค่าโดยสาร/u.test(normalized)) filter.category = "transport";
  if (/ช้อป|shopping/u.test(normalized)) filter.category = "shopping";
  if (/บิล|bill|ค่าน้ำ|ค่าไฟ|ค่าเน็ต/u.test(normalized)) filter.category = "bill";
  if (/โอน|transfer/u.test(normalized)) filter.category = "transfer";

  return { shouldSummarize, filter };
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

async function summarizeFromGateway(filter: SummaryFilter): Promise<{ ok: boolean; reply: string; emotion: AssistantEmotion; error?: string }> {
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
  if (txRows.length === 0) {
    return {
      ok: true,
      reply: `ดึงข้อมูลจากระบบให้แล้ว (${periodLabel}) แต่ยังไม่พบรายการตามเงื่อนไขนี้`,
      emotion: "neutral",
    };
  }

  const categoryLines = summary.categories
    .slice()
    .sort((a, b) => Number(b.total || 0) - Number(a.total || 0))
    .slice(0, 3)
    .map((row) => `- ${normalizeCategoryLabel(String(row.category))}: ${formatTHB(Number(row.total || 0))}`);

  const topType = filter.type === "income" ? "income" : "expense";
  const topTx = txRows
    .filter((row) => row.type === topType)
    .sort((a, b) => b.amount - a.amount)[0];

  const lines: string[] = [
    `สรุปจากข้อมูลจริงในระบบ (${periodLabel})`,
    `- จำนวนรายการ: ${txRows.length} รายการ`,
    `- รายจ่ายรวม: ${formatTHB(totalExpense)}`,
    `- รายรับรวม: ${formatTHB(totalIncome)}`,
    `- คงเหลือสุทธิ: ${formatTHB(balance)}`,
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

async function callOpenAI(messages: ChatMessage[], system?: string): Promise<string> {
  const response = await openai.responses.create({
    model: MODEL,
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

function normalizeType(raw: unknown): "expense" | "income" {
  const text = String(raw ?? "").trim().toLowerCase();
  if (text === "income" || text === "รายรับ" || text === "รับเงิน") return "income";
  return "expense";
}

function normalizeCategory(raw: unknown): "food" | "transport" | "shopping" | "bill" | "transfer" | "other" {
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

async function extractTransactionFromText(text: string): Promise<TextExtractionResult | null> {
  const raw = await callOpenAI([
    {
      role: "user",
      content: `${TEXT_AUTO_SAVE_PROMPT}\n\nUser message:\n${text}`,
    },
  ]);

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  const amount = obj.amount === null || obj.amount === undefined ? null : normalizeAmount(obj.amount);
  const type = obj.type === "income" || obj.type === "expense" ? obj.type : null;
  const category =
    obj.category === "food" ||
    obj.category === "transport" ||
    obj.category === "shopping" ||
    obj.category === "bill" ||
    obj.category === "transfer" ||
    obj.category === "other"
      ? obj.category
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
      return toBangkokIsoNoMs(new Date(trimmed));
    }
  } catch {
    // fall back to current time
  }
  return toBangkokIsoNoMs(new Date());
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

    let candidatePayload = normalizedPayload;
    let gwRes = await sendPayload(candidatePayload);

    // Gateway currently fails on datetime ending with "Z"; fallback to SQL datetime.
    if (!gwRes.ok && gwRes.status >= 500 && typeof candidatePayload.datetime === "string") {
      const fallbackDate = new Date(String(candidatePayload.datetime));
      if (!isNaN(fallbackDate.getTime())) {
        candidatePayload = { ...candidatePayload, datetime: toSqlDatetime(fallbackDate) };
        gwRes = await sendPayload(candidatePayload);
      }
    }

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
  const personaRaw = String(body.persona ?? "friendly");
  const persona: AssistantPersona =
    personaRaw === "professional" || personaRaw === "coach" || personaRaw === "playful" || personaRaw === "friendly"
      ? (personaRaw as AssistantPersona)
      : "friendly";
  const lastUserMessage = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";

  try {
    // ── Mock save mode: type /mock-save in chat to verify save pipeline ──────
    if (!ocrText && isMockSaveCommand(lastUserMessage)) {
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
    if (!ocrText) {
      const summaryIntent = parseSummaryIntent(lastUserMessage);
      if (summaryIntent.shouldSummarize) {
        const summaryResult = await summarizeFromGateway(summaryIntent.filter);
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
    if (ocrText) {
      const aiResponse = await callOpenAI([
        { role: "user", content: AI_PARSE_PROMPT + ocrText },
      ]);

      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return Response.json({
          reply: "อ่านสลิปได้ แต่ไม่สามารถแยกข้อมูลได้ กรุณาลองใหม่",
          emotion: "concerned",
          saved: false,
        });
      }

      let parsed: ParsedTransaction;
      try {
        parsed = JSON.parse(jsonMatch[0]) as ParsedTransaction;
      } catch {
        return Response.json({
          reply: "AI วิเคราะห์ข้อมูลไม่สำเร็จ กรุณาลองใหม่",
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
        type: parsed.type || "expense",
        category: parsed.category || "other",
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
      const extracted = await extractTransactionFromText(lastUserMessage);

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

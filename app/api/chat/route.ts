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

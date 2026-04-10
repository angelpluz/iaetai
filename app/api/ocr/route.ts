import { NextRequest } from "next/server";
import OpenAI from "openai";

type TransactionType = "expense" | "income";
type TransactionCategory = "food" | "transport" | "shopping" | "bill" | "transfer" | "other";

interface ParsedReceiptTransaction {
  item: string;
  amount: number;
  type: TransactionType;
  category: TransactionCategory;
  merchant: string;
  bank: string | null;
  datetime: string;
  reference: string | null;
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  ...(process.env.OPENAI_BASE_URL ? { baseURL: process.env.OPENAI_BASE_URL } : {}),
});

const RAW_OCR_MODEL = process.env.OCR_MODEL ?? process.env.FAST_MODEL ?? process.env.SMALL_MODEL ?? "gpt-5-nano";
const OCR_MODEL = RAW_OCR_MODEL.replace(/^openai\//, "");

const detailEnv = (process.env.OCR_IMAGE_DETAIL ?? "").toLowerCase();
const OCR_IMAGE_DETAIL: "low" | "auto" | "high" =
  detailEnv === "high" ? "high" : detailEnv === "auto" ? "auto" : "low";

const RECEIPT_TRANSACTION_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["item", "amount", "type", "category", "merchant", "bank", "datetime", "reference"],
  properties: {
    item: { type: "string" },
    amount: { type: "number" },
    type: { type: "string", enum: ["expense", "income"] },
    category: { type: "string", enum: ["food", "transport", "shopping", "bill", "transfer", "other"] },
    merchant: { type: "string" },
    bank: { anyOf: [{ type: "string" }, { type: "null" }] },
    datetime: { type: "string" },
    reference: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
};

const OCR_PROMPT = `Analyze this receipt/slip and extract exactly one finalized transaction for personal finance tracking.

Rules:
- Return one transaction only.
- Use the final amount paid/received (Total, Grand Total, Net, Amount Paid, ยอดสุทธิ, ยอดชำระ, จำนวนเงิน).
- Ignore line-item prices, subtotal, tax, service charge, discount rows, and running balances.
- If multiple amount candidates exist, choose the final payable/received amount.
- category must be one of: food, transport, shopping, bill, transfer, other.
- bank/reference should be null when not found.`;

function asParsedReceiptTransaction(raw: unknown): ParsedReceiptTransaction | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  const item = String(obj.item ?? "").trim();
  const merchant = String(obj.merchant ?? "").trim();
  const type = String(obj.type ?? "").trim().toLowerCase();
  const category = String(obj.category ?? "").trim().toLowerCase();
  const datetime = String(obj.datetime ?? "").trim();

  const amountRaw = obj.amount;
  const amount =
    typeof amountRaw === "number"
      ? amountRaw
      : Number(String(amountRaw ?? "0").replace(/[^\d.]/g, "").replace(/o/gi, "0"));

  const bank = String(obj.bank ?? "").trim() || null;
  const reference = String(obj.reference ?? "").trim() || null;

  if (!item || !merchant || !Number.isFinite(amount)) return null;
  if (type !== "expense" && type !== "income") return null;
  if (!["food", "transport", "shopping", "bill", "transfer", "other"].includes(category)) return null;

  return {
    item,
    amount,
    type,
    category: category as TransactionCategory,
    merchant,
    bank,
    datetime: datetime || new Date().toISOString(),
    reference,
  };
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return Response.json({ error: "No file uploaded" }, { status: 400 });
    }

    if (!file.type || !file.type.startsWith("image/")) {
      return Response.json({ error: "Only image files are supported" }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const base64 = Buffer.from(bytes).toString("base64");

    const response = await openai.responses.create({
      model: OCR_MODEL,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: OCR_PROMPT },
            {
              type: "input_image",
              image_url: `data:${file.type};base64,${base64}`,
              detail: OCR_IMAGE_DETAIL,
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "receipt_transaction",
          strict: true,
          schema: RECEIPT_TRANSACTION_SCHEMA,
        },
      },
    });

    const raw = (response.output_text ?? "").trim();
    if (!raw) {
      return Response.json({ error: "OCR parsed empty response" }, { status: 422 });
    }

    let parsedRaw: unknown;
    try {
      parsedRaw = JSON.parse(raw);
    } catch {
      return Response.json({ error: "OCR returned invalid JSON" }, { status: 422 });
    }

    const parsed = asParsedReceiptTransaction(parsedRaw);
    if (!parsed) {
      return Response.json({ error: "OCR result missing required fields" }, { status: 422 });
    }

    return Response.json({ result: parsed });
  } catch (err) {
    const message = err instanceof Error ? err.message : "OCR failed";
    return Response.json({ error: message }, { status: 500 });
  }
}

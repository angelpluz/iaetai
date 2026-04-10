import { NextRequest } from "next/server";
import OpenAI from "openai";

type TransactionType = "expense" | "income";
type TransactionCategory = "food" | "transport" | "shopping" | "bill" | "transfer" | "other";
type ImageKind = "financial_document" | "visual_item" | "other";

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

interface ImageAnalysisResult {
  kind: ImageKind;
  summary: string;
  canAutoSave: boolean;
  suggestedItem: string | null;
  suggestedCategory: TransactionCategory | null;
  transaction: ParsedReceiptTransaction | null;
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

const TRANSACTION_SCHEMA: Record<string, unknown> = {
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

const IMAGE_ANALYSIS_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "summary", "canAutoSave", "suggestedItem", "suggestedCategory", "transaction"],
  properties: {
    kind: { type: "string", enum: ["financial_document", "visual_item", "other"] },
    summary: { type: "string" },
    canAutoSave: { type: "boolean" },
    suggestedItem: { anyOf: [{ type: "string" }, { type: "null" }] },
    suggestedCategory: {
      anyOf: [{ type: "string", enum: ["food", "transport", "shopping", "bill", "transfer", "other"] }, { type: "null" }],
    },
    transaction: {
      anyOf: [TRANSACTION_SCHEMA, { type: "null" }],
    },
  },
};

const IMAGE_ANALYSIS_PROMPT = `Analyze this image for a personal finance assistant.

First decide the image kind:
- financial_document: receipt, invoice, bill statement, transfer slip, payment screenshot, or any document with clear transaction details.
- visual_item: a normal photo of food, products, objects, shopping items, transport, or a real-world scene.
- other: image is unclear, unrelated, or not enough to infer anything useful.

Critical rules:
- Do not classify a normal food photo as a bill.
- Do not auto-save visual_item photos as transactions.
- Only set canAutoSave=true when the image is clearly a financial_document and contains enough data for one transaction.
- For visual_item photos, describe what it looks like and suggest the best category.
- For food photos, suggestedCategory should usually be food.
- For shopping/product photos, suggestedCategory should usually be shopping.
- For utility/invoice documents, category should usually be bill.
- If the image is a receipt/slip, extract exactly one final transaction using the final paid/received amount.
- Ignore line-item prices, subtotal, tax, discount rows, and running balances when extracting a financial document.
- Write summary in Thai.
`;

function normalizeTransaction(raw: unknown): ParsedReceiptTransaction | null {
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

function normalizeImageAnalysis(raw: unknown): ImageAnalysisResult | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  const kind =
    obj.kind === "financial_document" || obj.kind === "visual_item" || obj.kind === "other" ? obj.kind : null;
  if (!kind) return null;

  const suggestedCategory =
    obj.suggestedCategory === "food" ||
    obj.suggestedCategory === "transport" ||
    obj.suggestedCategory === "shopping" ||
    obj.suggestedCategory === "bill" ||
    obj.suggestedCategory === "transfer" ||
    obj.suggestedCategory === "other"
      ? (obj.suggestedCategory as TransactionCategory)
      : null;

  const transaction = normalizeTransaction(obj.transaction);
  const canAutoSave = Boolean(obj.canAutoSave) && kind === "financial_document" && Boolean(transaction);

  return {
    kind,
    summary: String(obj.summary ?? "").trim() || "วิเคราะห์รูปให้แล้ว",
    canAutoSave,
    suggestedItem: String(obj.suggestedItem ?? "").trim() || null,
    suggestedCategory,
    transaction,
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
            { type: "input_text", text: IMAGE_ANALYSIS_PROMPT },
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
          name: "image_finance_analysis",
          strict: true,
          schema: IMAGE_ANALYSIS_SCHEMA,
        },
      },
    });

    const raw = (response.output_text ?? "").trim();
    if (!raw) {
      return Response.json({ error: "Image analysis returned empty response" }, { status: 422 });
    }

    let parsedRaw: unknown;
    try {
      parsedRaw = JSON.parse(raw);
    } catch {
      return Response.json({ error: "Image analysis returned invalid JSON" }, { status: 422 });
    }

    const analysis = normalizeImageAnalysis(parsedRaw);
    if (!analysis) {
      return Response.json({ error: "Image analysis result missing required fields" }, { status: 422 });
    }

    return Response.json({ analysis });
  } catch (err) {
    const message = err instanceof Error ? err.message : "OCR failed";
    return Response.json({ error: message }, { status: 500 });
  }
}

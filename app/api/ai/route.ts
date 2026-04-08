import { NextRequest } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  ...(process.env.OPENAI_BASE_URL ? { baseURL: process.env.OPENAI_BASE_URL } : {}),
});
const RAW_MODEL = process.env.OPENAI_MODEL ?? process.env.DEFAULT_MODEL ?? "gpt-5-nano";
const MODEL = RAW_MODEL.replace(/^openai\//, "");

const PROMPT = `Extract financial transaction data from OCR text. Fix OCR errors (O→0, l→1, "10o.00"→100.00).

Return ONLY valid JSON, no extra text:
{
  "item": "description of payment",
  "amount": 100.00,
  "type": "expense",
  "category": "food|transport|shopping|bill|transfer|other",
  "merchant": "store name",
  "bank": "bank name or null",
  "datetime": "ISO datetime string",
  "reference": "reference number or null"
}

OCR Text:
`;

export async function POST(request: NextRequest) {
  let text = "";
  try {
    const body = await request.json();
    text = body.text as string;

    if (!text) {
      return Response.json({ error: "No text provided" }, { status: 400 });
    }

    const response = await openai.responses.create({
      model: MODEL,
      input: PROMPT + text,
    });

    const content = response.output_text ?? "";

    // Extract JSON from the response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return Response.json({ raw: content });
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return Response.json({ result: parsed });
  } catch (err) {
    return Response.json(
      {
        error: err instanceof Error ? err.message : "AI parsing failed",
        fallback: text,
      },
      { status: 500 }
    );
  }
}

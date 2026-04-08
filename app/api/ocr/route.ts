import { NextRequest } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  ...(process.env.OPENAI_BASE_URL ? { baseURL: process.env.OPENAI_BASE_URL } : {}),
});

const RAW_OCR_MODEL =
  process.env.OCR_MODEL ??
  process.env.LARGE_MODEL ??
  process.env.DEFAULT_MODEL ??
  process.env.OPENAI_MODEL ??
  "gpt-5-nano";
const OCR_MODEL = RAW_OCR_MODEL.replace(/^openai\//, "");

const OCR_PROMPT = `Extract all text from this image.
Return plain text only.
Preserve line breaks when possible.
Do not add explanations.`;

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
            },
          ],
        },
      ],
    });

    const text = (response.output_text ?? "").trim();
    return Response.json({ text });
  } catch (err) {
    const message = err instanceof Error ? err.message : "OCR failed";
    return Response.json({ error: message }, { status: 500 });
  }
}

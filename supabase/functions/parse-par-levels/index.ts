import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ---------------------------------------------------------------------------
// Retry helper — exponential backoff on 429 / 503
// ---------------------------------------------------------------------------
async function callGeminiWithRetry(
  body: unknown,
  maxRetries = 3
): Promise<unknown> {
  const delays = [2000, 4000, 8000];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      return res.json();
    }

    const status = res.status;
    const errorText = await res.text();

    if ((status === 429 || status === 503) && attempt < maxRetries) {
      const delay = delays[attempt] ?? 8000;
      console.warn(
        `Gemini ${status} on attempt ${attempt + 1}/${maxRetries + 1}, retrying in ${delay}ms…`
      );
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }

    throw new Error(`Gemini API error (${status}): ${errorText}`);
  }

  throw new Error("Gemini API: max retries exceeded");
}

// ---------------------------------------------------------------------------
// Prompt — extracts quantity and unit separately
// ---------------------------------------------------------------------------
const PARSE_PROMPT = `You are a par level data parser for any restaurant kitchen.
Parse this par level sheet and extract all items with their par quantity and measurement unit.

The par sheet typically has columns like: Item, Par (or similar).
Each item has a par value which is a number paired with a unit of measurement.
For example: "2 qts", "3 bags", "40ea.", "1 cambro", "12 orders", "1/3 pan".

For each item row, extract:
- "item_name": the ingredient or prep item name (e.g., "Chicken Tenders", "Queso")
- "par_quantity": the numeric par value as a number (e.g., 2, 3, 40, 0.33 for 1/3)
- "par_unit": the unit of measurement (e.g., "qts", "bags", "ea.", "cambro", "orders", "bottles", "pan", "tub")

IMPORTANT:
- Ignore header rows, section labels (like "Frozen:", "Cooler:", "Hot:"), and empty rows.
- If the par value contains a fraction like "1/3", convert it to a decimal (0.33).
- If the par value is like "2 1/3", convert it to a decimal (2.33).
- Keep the unit exactly as written in the sheet.

Return a JSON array of these objects. Return ONLY the JSON array, no markdown.`;

// ---------------------------------------------------------------------------
// XLSX → CSV
// ---------------------------------------------------------------------------
function spreadsheetToCSV(buffer: ArrayBuffer): string {
  const workbook = XLSX.read(new Uint8Array(buffer), { type: "array" });
  const parts: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (workbook.SheetNames.length > 1) {
      parts.push(`=== Sheet: ${sheetName} ===`);
    }
    parts.push(XLSX.utils.sheet_to_csv(sheet));
  }
  return parts.join("\n\n");
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return new Response(JSON.stringify({ error: "No file provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const fileBytes = await file.arrayBuffer();
    const fileName = file.name.toLowerCase();

    const isSpreadsheet =
      fileName.endsWith(".xlsx") ||
      fileName.endsWith(".xls") ||
      fileName.endsWith(".csv");

    // Build Gemini content parts
    let contentParts: unknown[];

    if (isSpreadsheet) {
      let csvText: string;
      if (fileName.endsWith(".csv")) {
        csvText = new TextDecoder().decode(fileBytes);
      } else {
        csvText = spreadsheetToCSV(fileBytes);
      }
      contentParts = [
        { text: PARSE_PROMPT },
        { text: `Here is the par level data in CSV format:\n\n${csvText}` },
      ];
    } else {
      const base64Content = btoa(
        String.fromCharCode(...new Uint8Array(fileBytes))
      );
      contentParts = [
        { text: PARSE_PROMPT },
        {
          inline_data: {
            mime_type: "application/pdf",
            data: base64Content,
          },
        },
      ];
    }

    // Call Gemini with retry
    const geminiData = (await callGeminiWithRetry({
      contents: [{ parts: contentParts }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: "application/json",
      },
    })) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };

    const responseText =
      geminiData.candidates?.[0]?.content?.parts?.[0]?.text ?? "[]";

    const parsedItems: Array<{
      item_name: string;
      par_quantity: number;
      par_unit: string;
    }> = JSON.parse(responseText);

    let count = 0;
    const newItems: string[] = [];
    const duplicateItems: string[] = [];

    for (const item of parsedItems) {
      const { data: existing } = await supabase
        .from("ingredients")
        .select("id")
        .ilike("name", item.item_name)
        .single();

      if (existing) {
        // Update par_level and unit on existing ingredient
        await supabase
          .from("ingredients")
          .update({
            par_level: item.par_quantity,
            unit: item.par_unit,
          })
          .eq("id", existing.id);
        duplicateItems.push(item.item_name);
      } else {
        // Create new ingredient with par_level and unit
        const { error: createError } = await supabase
          .from("ingredients")
          .insert({
            name: item.item_name,
            par_level: item.par_quantity,
            unit: item.par_unit,
          });

        if (createError) {
          console.error(`Failed to create ingredient: ${item.item_name}`, createError);
          continue;
        }
        newItems.push(item.item_name);
      }

      count++;
    }

    return new Response(
      JSON.stringify({
        count,
        items_processed: parsedItems.length,
        new_items: newItems,
        duplicate_items: duplicateItems,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CLAUDE_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = "claude-haiku-4-5-20251001";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const PARSE_PROMPT = `You are a sales data parser for a restaurant POS system.
Parse the attached sales report PDF and extract ONLY individual food items with their units sold.

Rules:
- Extract each food item's name exactly as printed, its category, and units sold.
- SKIP category headers (e.g. "Appetizers", "BBQ", "Handhelds").
- SKIP subtotal/total rows (e.g. "Item Category Totals:", "Totals:").
- SKIP page headers, footers, dates, and metadata.
- SKIP non-food modifiers like "SALAD OUT FIRST", "SALAD WITH MEAL".
- SKIP "Open Food" entries (these are catch-all items, not specific dishes).
- Only include items with units_sold > 0.

Return a JSON array where each element has:
- "item_name": the exact item name as shown in the report
- "category": the category it belongs to (e.g., "Appetizers", "Handhelds", "BBQ")
- "units_sold": the number of units sold (as a number)

Return ONLY the JSON array. No markdown, no explanation, no backticks.`;

// ---------------------------------------------------------------------------
// Retry helper — exponential backoff on 429 / 529 / 503
// ---------------------------------------------------------------------------

async function callClaudeWithRetry(
  body: Record<string, unknown>,
  maxRetries = 3
): Promise<{ content: Array<{ type: string; text?: string }> }> {
  const delays = [2000, 4000, 8000];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(CLAUDE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      return res.json();
    }

    const status = res.status;
    const errorText = await res.text();

    // Retry on rate limit (429), overloaded (529), or service unavailable (503)
    if (
      (status === 429 || status === 529 || status === 503) &&
      attempt < maxRetries
    ) {
      const delay = delays[attempt] ?? 8000;
      console.warn(
        `Claude ${status} on attempt ${attempt + 1}/${maxRetries + 1}, retrying in ${delay}ms…`
      );
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }

    throw new Error(`Claude API error (${status}): ${errorText}`);
  }

  throw new Error("Claude API: max retries exceeded");
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
    const base64Content = btoa(
      String.fromCharCode(...new Uint8Array(fileBytes))
    );

    // Determine MIME type
    const mimeType = file.name.toLowerCase().endsWith(".pdf")
      ? "application/pdf"
      : file.type || "application/pdf";

    // ── Call Claude to parse the PDF ──
    console.log(`[parse-sales] Parsing ${file.name} with Claude…`);

    const claudeResponse = await callClaudeWithRetry({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: {
                type: "base64",
                media_type: mimeType,
                data: base64Content,
              },
            },
            {
              type: "text",
              text: PARSE_PROMPT,
            },
          ],
        },
      ],
    });

    // Extract text response from Claude
    const responseText =
      claudeResponse.content
        ?.filter((block) => block.type === "text")
        .map((block) => block.text ?? "")
        .join("") ?? "[]";

    // Clean up any markdown fencing Claude might add despite instructions
    const cleanedText = responseText
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/, "")
      .trim();

    const parsedItems: Array<{
      item_name: string;
      category: string;
      units_sold: number;
    }> = JSON.parse(cleanedText);

    console.log(`[parse-sales] Parsed ${parsedItems.length} items`);

    // ── Extract report date from filename (e.g., "1_13_26.pdf") ──
    const dateMatch = file.name.match(
      /(\d{1,2})[\/_-](\d{1,2})[\/_-](\d{2,4})/
    );
    let reportDate = new Date().toISOString().split("T")[0];
    if (dateMatch) {
      const month = dateMatch[1].padStart(2, "0");
      const day = dateMatch[2].padStart(2, "0");
      const year =
        dateMatch[3].length === 2 ? `20${dateMatch[3]}` : dateMatch[3];
      reportDate = `${year}-${month}-${day}`;
    }

    // ── Upload file to storage ──
    const storagePath = `sales-reports/${reportDate}/${file.name}`;
    await supabase.storage.from("uploads").upload(storagePath, fileBytes, {
      contentType: file.type,
      upsert: true,
    });

    const {
      data: { publicUrl },
    } = supabase.storage.from("uploads").getPublicUrl(storagePath);

    // ── Create sales report record ──
    const { data: report, error: reportError } = await supabase
      .from("sales_reports")
      .insert({
        report_date: reportDate,
        file_url: publicUrl,
        file_name: file.name,
        status: "processing",
      })
      .select("id")
      .single();

    if (reportError) throw reportError;

    // ── Fetch existing menu items for matching ──
    const { data: menuItems } = await supabase
      .from("menu_items")
      .select("id, name, pos_name");

    const menuItemMap = new Map<string, string>();
    for (const mi of menuItems ?? []) {
      menuItemMap.set(mi.name.toLowerCase(), mi.id);
      if (mi.pos_name) {
        menuItemMap.set(mi.pos_name.toLowerCase(), mi.id);
      }
    }

    // ── Insert parsed sales data ──
    const salesDataRows = parsedItems.map((item) => {
      const matchedId =
        menuItemMap.get(item.item_name.toLowerCase()) ?? null;
      return {
        sales_report_id: report.id,
        menu_item_id: matchedId,
        raw_item_name: item.item_name,
        units_sold: item.units_sold,
        report_date: reportDate,
      };
    });

    if (salesDataRows.length > 0) {
      const { error: insertError } = await supabase
        .from("sales_data")
        .insert(salesDataRows);
      if (insertError) throw insertError;
    }

    // ── Mark report as completed ──
    await supabase
      .from("sales_reports")
      .update({ status: "completed" })
      .eq("id", report.id);

    return new Response(
      JSON.stringify({
        report_id: report.id,
        report_date: reportDate,
        items: salesDataRows,
        count: salesDataRows.length,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[parse-sales] Error: ${message}`);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

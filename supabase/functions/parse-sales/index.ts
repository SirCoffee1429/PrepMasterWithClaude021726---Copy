import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

const PARSE_PROMPT = `You are a sales data parser for a restaurant POS system.
Parse the following sales report and extract ONLY food items with their units sold.
Skip category totals, subtotals, and non-food items.

Return a JSON array where each element has:
- "item_name": the exact item name as shown
- "category": the category it belongs to (e.g., "Appetizers", "Handhelds", "BBQ")
- "units_sold": the number of units sold (as a number)

Only include items with units_sold > 0.
Return ONLY the JSON array, no markdown or other text.`;

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

    // Determine correct MIME type
    const mimeType = file.name.toLowerCase().endsWith(".pdf")
      ? "application/pdf"
      : file.type || "application/pdf";

    // Call Gemini to parse the PDF
    const geminiResponse = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: PARSE_PROMPT },
              {
                inline_data: {
                  mime_type: mimeType,
                  data: base64Content,
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
        },
      }),
    });

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      throw new Error(`Gemini API error: ${errorText}`);
    }

    const geminiData = await geminiResponse.json();
    const responseText =
      geminiData.candidates?.[0]?.content?.parts?.[0]?.text ?? "[]";
    const parsedItems: Array<{
      item_name: string;
      category: string;
      units_sold: number;
    }> = JSON.parse(responseText);

    // Try to extract report date from filename (e.g., "1_13_26.pdf")
    const dateMatch = file.name.match(/(\d{1,2})[\/_-](\d{1,2})[\/_-](\d{2,4})/);
    let reportDate = new Date().toISOString().split("T")[0];
    if (dateMatch) {
      const month = dateMatch[1].padStart(2, "0");
      const day = dateMatch[2].padStart(2, "0");
      const year =
        dateMatch[3].length === 2 ? `20${dateMatch[3]}` : dateMatch[3];
      reportDate = `${year}-${month}-${day}`;
    }

    // Upload file to storage
    const storagePath = `sales-reports/${reportDate}/${file.name}`;
    await supabase.storage.from("uploads").upload(storagePath, fileBytes, {
      contentType: file.type,
      upsert: true,
    });

    const { data: { publicUrl } } = supabase.storage
      .from("uploads")
      .getPublicUrl(storagePath);

    // Create sales report record
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

    // Fetch existing menu items for matching
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

    // Insert parsed sales data
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

    // Mark report as completed
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
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

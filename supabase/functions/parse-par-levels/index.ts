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

const PARSE_PROMPT = `You are a par level data parser for a restaurant kitchen.
Parse this par level sheet and extract all items with their par quantities per day of the week.

The par sheet has columns for days: Tue, Wed, Thu, Fri, Sat, Sun (the club is closed Monday).
Each row has an Item name, a Par value, and Prep values for each day.

Return a JSON array where each element has:
- "item_name": the ingredient/prep item name
- "par_levels": an object mapping day abbreviations to numbers:
  { "Sun": <number>, "Mon": 0, "Tue": <number>, "Wed": <number>, "Thu": <number>, "Fri": <number>, "Sat": <number> }
  Use 0 for Monday (closed) and for any empty/missing values.

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
    const fileName = file.name.toLowerCase();
    let mimeType = file.type;
    if (fileName.endsWith(".pdf")) {
      mimeType = "application/pdf";
    } else if (fileName.endsWith(".xlsx")) {
      mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    } else if (fileName.endsWith(".xls")) {
      mimeType = "application/vnd.ms-excel";
    }

    // Call Gemini to parse the par level sheet
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
      par_levels: Record<string, number>;
    }> = JSON.parse(responseText);

    const dayMap: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };

    // For each parsed item, find or create ingredient, then upsert par levels
    let count = 0;

    for (const item of parsedItems) {
      // Find existing ingredient by name (case-insensitive)
      const { data: existing } = await supabase
        .from("ingredients")
        .select("id")
        .ilike("name", item.item_name)
        .single();

      let ingredientId: string;

      if (existing) {
        ingredientId = existing.id;
      } else {
        // Create new ingredient
        const { data: created, error: createError } = await supabase
          .from("ingredients")
          .insert({ name: item.item_name })
          .select("id")
          .single();

        if (createError) {
          console.error(`Failed to create ingredient: ${item.item_name}`, createError);
          continue;
        }
        ingredientId = created.id;
      }

      // Upsert par levels for each day
      const parRows = Object.entries(item.par_levels)
        .filter(([_, qty]) => qty > 0)
        .map(([day, qty]) => ({
          ingredient_id: ingredientId,
          day_of_week: dayMap[day] ?? 0,
          par_quantity: qty,
        }));

      if (parRows.length > 0) {
        const { error: upsertError } = await supabase
          .from("par_levels")
          .upsert(parRows, { onConflict: "ingredient_id,day_of_week" });

        if (upsertError) {
          console.error(`Failed to upsert par levels for: ${item.item_name}`, upsertError);
          continue;
        }
        count += parRows.length;
      }
    }

    return new Response(
      JSON.stringify({
        count,
        items_processed: parsedItems.length,
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

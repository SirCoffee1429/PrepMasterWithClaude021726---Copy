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
// XLSX helpers
// ---------------------------------------------------------------------------

interface SheetInfo {
  name: string;
  csv: string;
  previewRows: string; // first ~10 rows for discovery pass
}

function extractSheets(buffer: ArrayBuffer): SheetInfo[] {
  const workbook = XLSX.read(new Uint8Array(buffer), { type: "array" });
  const sheets: SheetInfo[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const fullCsv = XLSX.utils.sheet_to_csv(sheet);
    // Preview: first 10 lines for discovery
    const lines = fullCsv.split("\n");
    const previewRows = lines.slice(0, 10).join("\n");
    sheets.push({ name: sheetName, csv: fullCsv, previewRows });
  }

  return sheets;
}

// ---------------------------------------------------------------------------
// PASS 1 — Discovery: classify each sheet
// ---------------------------------------------------------------------------

const DISCOVERY_PROMPT = `You are analyzing a restaurant workbook to classify each sheet.

For each sheet below, I'm showing you the sheet name and the first few rows of data.
Classify each sheet into one of these categories:

- "MENU_ITEM" — A sheet describing a finished dish that a guest orders. It typically lists the components/ingredients that make up the dish, often with quantities, units, and costs.
- "RECIPE" — A sheet describing how to make a prep item or sub-recipe. It typically has a list of raw ingredients with quantities and measurements, and may include assembly/preparation steps or instructions.
- "OTHER" — Anything else (summary sheets, cost sheets, inventory, cover pages, blank sheets, etc.)

Key distinction: A MENU_ITEM is what the guest sees on the menu (e.g., "Brisket Platter", "Grilled Salmon", "Caesar Salad"). A RECIPE is a prep component that goes INTO menu items (e.g., "Pulled Pork", "Caesar Dressing", "Coleslaw", "Mac and Cheese").

Return a JSON array where each element has:
- "sheet_name": the exact sheet name
- "classification": "MENU_ITEM" | "RECIPE" | "OTHER"
- "detected_name": the item or recipe name you detected from the content

Return ONLY the JSON array.`;

interface SheetClassification {
  sheet_name: string;
  classification: "MENU_ITEM" | "RECIPE" | "OTHER";
  detected_name: string;
}

async function runDiscoveryPass(
  sheets: SheetInfo[],
  contentParts: unknown[]
): Promise<SheetClassification[]> {
  // Build preview text for discovery
  const previewText = sheets
    .map((s) => `=== Sheet: ${s.name} ===\n${s.previewRows}`)
    .join("\n\n");

  const discoveryParts = [
    ...contentParts, // includes PDF inline_data if applicable
    { text: DISCOVERY_PROMPT },
    { text: `Here are the sheets and their first few rows:\n\n${previewText}` },
  ];

  // For PDFs, the content parts already include the inline_data,
  // so we only add the preview text as supplementary context
  const geminiData = (await callGeminiWithRetry({
    contents: [{ parts: discoveryParts }],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: "application/json",
    },
  })) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };

  const responseText =
    geminiData.candidates?.[0]?.content?.parts?.[0]?.text ?? "[]";

  return JSON.parse(responseText) as SheetClassification[];
}

// ---------------------------------------------------------------------------
// PASS 2 — Extraction: parse the actual data using classifications
// ---------------------------------------------------------------------------

function buildExtractionPrompt(classifications: SheetClassification[]): string {
  const menuSheets = classifications
    .filter((c) => c.classification === "MENU_ITEM")
    .map((c) => `"${c.sheet_name}" (${c.detected_name})`)
    .join(", ");

  const recipeSheets = classifications
    .filter((c) => c.classification === "RECIPE")
    .map((c) => `"${c.sheet_name}" (${c.detected_name})`)
    .join(", ");

  return `You are a recipe workbook parser for a restaurant.
This workbook has been analyzed, and the sheets have been classified as follows:

MENU ITEM sheets: ${menuSheets || "none found"}
RECIPE sheets: ${recipeSheets || "none found"}

Using this classification, parse the full workbook data below and return a JSON object with:

{
  "menu_items": [
    {
      "name": "Brisket Platter",
      "category": "BBQ",
      "components": [
        { "ingredient_name": "Brisket", "quantity": 1, "unit": "portion", "has_recipe": true },
        { "ingredient_name": "Mac and Cheese", "quantity": 1, "unit": "portion", "has_recipe": true },
        { "ingredient_name": "White Bread", "quantity": 2, "unit": "slices", "has_recipe": false }
      ]
    }
  ],
  "recipes": [
    {
      "name": "Brisket",
      "ingredients": [
        { "name": "Pork Butt", "quantity": "10", "measure": "lb" },
        { "name": "Brown Sugar", "quantity": "2", "measure": "cup" }
      ],
      "assembly": ["Season with dry rub", "Smoke at 225F for 12 hours"]
    }
  ]
}

Rules:
1. For MENU ITEM sheets: extract the dish name, its category (if apparent), and all of its components/ingredients.
2. For RECIPE sheets: extract the recipe name, the raw ingredients list with quantities and measures, and any assembly/preparation steps.
3. Set "has_recipe": true on a menu item component if there is a matching RECIPE sheet for that component.
4. Ignore sheets classified as OTHER.
5. Match component names to recipe names when they refer to the same item (e.g., a component "Pulled Pork" matches recipe sheet "Pulled Pork").

Return ONLY the JSON object, no markdown or other text.`;
}

// ---------------------------------------------------------------------------
// Types for parsed workbook data
// ---------------------------------------------------------------------------
interface ParsedWorkbook {
  menu_items?: Array<{
    name: string;
    category?: string;
    components?: Array<{
      ingredient_name: string;
      quantity: number;
      unit: string;
      has_recipe: boolean;
    }>;
  }>;
  recipes?: Array<{
    name: string;
    ingredients: Array<{ name: string; quantity: string; measure: string }>;
    assembly: string[];
  }>;
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

    // Upload original file to storage
    let storageMimeType = file.type;
    if (fileName.endsWith(".xlsx")) {
      storageMimeType =
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    } else if (fileName.endsWith(".xls")) {
      storageMimeType = "application/vnd.ms-excel";
    }

    const storagePath = `workbooks/${file.name}`;
    await supabase.storage.from("uploads").upload(storagePath, fileBytes, {
      contentType: storageMimeType,
      upsert: true,
    });

    const {
      data: { publicUrl },
    } = supabase.storage.from("uploads").getPublicUrl(storagePath);

    // -----------------------------------------------------------------------
    // Prepare content for Gemini
    // -----------------------------------------------------------------------
    const isSpreadsheet =
      fileName.endsWith(".xlsx") ||
      fileName.endsWith(".xls") ||
      fileName.endsWith(".csv");

    let sheets: SheetInfo[] = [];
    let fullCsvText = "";
    let pdfParts: unknown[] = [];

    if (isSpreadsheet) {
      if (fileName.endsWith(".csv")) {
        const csvText = new TextDecoder().decode(fileBytes);
        const lines = csvText.split("\n");
        sheets = [
          {
            name: "Sheet1",
            csv: csvText,
            previewRows: lines.slice(0, 10).join("\n"),
          },
        ];
        fullCsvText = csvText;
      } else {
        sheets = extractSheets(fileBytes);
        fullCsvText = sheets
          .map((s) => `=== Sheet: ${s.name} ===\n${s.csv}`)
          .join("\n\n");
      }
    } else {
      // PDF — inline_data
      const base64Content = btoa(
        String.fromCharCode(...new Uint8Array(fileBytes))
      );
      pdfParts = [
        {
          inline_data: {
            mime_type: "application/pdf",
            data: base64Content,
          },
        },
      ];
    }

    // -----------------------------------------------------------------------
    // PASS 1 — Discovery
    // -----------------------------------------------------------------------
    console.log(`[Pass 1] Classifying ${sheets.length} sheets…`);

    const classifications = await runDiscoveryPass(sheets, pdfParts);

    console.log(
      `[Pass 1] Results: ${JSON.stringify(classifications.map((c) => `${c.sheet_name} → ${c.classification}`))}`
    );

    const menuCount = classifications.filter(
      (c) => c.classification === "MENU_ITEM"
    ).length;
    const recipeCount = classifications.filter(
      (c) => c.classification === "RECIPE"
    ).length;

    // -----------------------------------------------------------------------
    // PASS 2 — Extraction
    // -----------------------------------------------------------------------
    console.log(
      `[Pass 2] Extracting data (${menuCount} menu items, ${recipeCount} recipes)…`
    );

    const extractionPrompt = buildExtractionPrompt(classifications);

    let extractionParts: unknown[];
    if (isSpreadsheet) {
      extractionParts = [
        { text: extractionPrompt },
        { text: `Here is the full workbook data:\n\n${fullCsvText}` },
      ];
    } else {
      extractionParts = [
        { text: extractionPrompt },
        ...pdfParts,
      ];
    }

    const geminiData = (await callGeminiWithRetry({
      contents: [{ parts: extractionParts }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: "application/json",
      },
    })) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };

    const responseText =
      geminiData.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";

    const parsed: ParsedWorkbook = JSON.parse(responseText);

    // -----------------------------------------------------------------------
    // Save to database
    // -----------------------------------------------------------------------
    let ingredientsCount = 0;
    let menuItemsCount = 0;
    let recipesCount = 0;

    const newMenuItems: string[] = [];
    const duplicateMenuItems: string[] = [];
    const newRecipes: string[] = [];
    const duplicateRecipes: string[] = [];
    const newIngredients: string[] = [];
    const duplicateIngredients: string[] = [];

    // Process recipes first (create ingredients with recipe_data)
    const recipeIngredientIds = new Map<string, string>();

    for (const recipe of parsed.recipes ?? []) {
      const { data: existing } = await supabase
        .from("ingredients")
        .select("id")
        .ilike("name", recipe.name)
        .single();

      const recipeData = {
        ingredients: recipe.ingredients,
        assembly: recipe.assembly,
      };

      let ingredientId: string;

      if (existing) {
        ingredientId = existing.id;
        await supabase
          .from("ingredients")
          .update({ recipe_data: recipeData, recipe_file_url: publicUrl })
          .eq("id", ingredientId);
        duplicateRecipes.push(recipe.name);
      } else {
        const { data: created, error } = await supabase
          .from("ingredients")
          .insert({
            name: recipe.name,
            recipe_data: recipeData,
            recipe_file_url: publicUrl,
          })
          .select("id")
          .single();

        if (error) {
          console.error(`Failed to create ingredient: ${recipe.name}`, error);
          continue;
        }
        ingredientId = created.id;
        ingredientsCount++;
        newRecipes.push(recipe.name);
      }

      recipeIngredientIds.set(recipe.name.toLowerCase(), ingredientId);
      recipesCount++;
    }

    // Process menu items
    for (const menuItem of parsed.menu_items ?? []) {
      const { data: existingMi } = await supabase
        .from("menu_items")
        .select("id")
        .ilike("name", menuItem.name)
        .single();

      const isNewMenuItem = !existingMi;

      const { data: mi, error: miError } = await supabase
        .from("menu_items")
        .upsert(
          {
            name: menuItem.name,
            category: menuItem.category ?? null,
            pos_name: menuItem.name,
          },
          { onConflict: "name" }
        )
        .select("id")
        .single();

      if (miError) {
        console.error(`Failed to upsert menu item: ${menuItem.name}`, miError);
        continue;
      }

      menuItemsCount++;

      if (isNewMenuItem) {
        newMenuItems.push(menuItem.name);
      } else {
        duplicateMenuItems.push(menuItem.name);
      }

      for (const comp of menuItem.components ?? []) {
        let ingredientId = recipeIngredientIds.get(
          comp.ingredient_name.toLowerCase()
        );

        if (!ingredientId) {
          const { data: existing } = await supabase
            .from("ingredients")
            .select("id")
            .ilike("name", comp.ingredient_name)
            .single();

          if (existing) {
            ingredientId = existing.id;
            duplicateIngredients.push(comp.ingredient_name);
          } else {
            const { data: created, error } = await supabase
              .from("ingredients")
              .insert({ name: comp.ingredient_name, unit: comp.unit })
              .select("id")
              .single();

            if (error) {
              console.error(
                `Failed to create ingredient: ${comp.ingredient_name}`,
                error
              );
              continue;
            }
            ingredientId = created.id;
            ingredientsCount++;
            newIngredients.push(comp.ingredient_name);
          }
        }

        await supabase.from("bill_of_materials").upsert(
          {
            menu_item_id: mi.id,
            ingredient_id: ingredientId,
            quantity: comp.quantity,
            unit: comp.unit,
          },
          { onConflict: "menu_item_id,ingredient_id" }
        );
      }
    }

    return new Response(
      JSON.stringify({
        menu_items_count: menuItemsCount,
        ingredients_count: ingredientsCount,
        recipes_count: recipesCount,
        discovery: classifications.map((c) => ({
          sheet: c.sheet_name,
          type: c.classification,
          name: c.detected_name,
        })),
        new_menu_items: newMenuItems,
        duplicate_menu_items: duplicateMenuItems,
        new_recipes: newRecipes,
        duplicate_recipes: duplicateRecipes,
        new_ingredients: newIngredients,
        duplicate_ingredients: duplicateIngredients,
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

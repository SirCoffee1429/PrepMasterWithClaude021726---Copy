import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ParsedComponent {
  name: string;
  quantity: string;
  measure: string;
  has_recipe: boolean; // true if "(See Recipe)" or "(See MENU ITEM)" was in the name
}

interface SheetResult {
  type: "MENU_ITEM" | "RECIPE";
  name: string;
  sheet_name: string;
  components: ParsedComponent[];
  assembly: string[];
  yield_amount: number | null;
  yield_measure: string | null;
}

// ---------------------------------------------------------------------------
// Workbook Template Layout
// ---------------------------------------------------------------------------
// Your workbooks follow a consistent template:
//
//   Row 1:  A = "MENU ITEM:" or "RECIPE:"    B = Name
//   Row 2:  Headers (Ingredients, Quantity, Measure, Unit Cost, Total Cost)
//   Rows 3–22:  Ingredient/component rows
//   Row 24: A = "Assembly:"                   E = Yield Amount
//   Row 25: A = First assembly step(s)        E = Yield Measure
//   Rows 26+: Additional assembly steps (if multi-row)
//
// This parser reads the template directly — no AI needed.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Deterministic Sheet Parser
// ---------------------------------------------------------------------------

function parseWorkbook(buffer: ArrayBuffer): SheetResult[] {
  const workbook = XLSX.read(new Uint8Array(buffer), { type: "array" });
  const results: SheetResult[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: null,
    });

    if (rows.length < 3) continue;

    // ── Classify from A1 ──
    const a1 = String(rows[0]?.[0] ?? "").trim().toUpperCase();
    const b1 = String(rows[0]?.[1] ?? "").trim();

    let type: "MENU_ITEM" | "RECIPE";
    let name: string;

    if (a1.startsWith("MENU ITEM")) {
      type = "MENU_ITEM";
      name = b1;
    } else if (a1.startsWith("RECIPE")) {
      type = "RECIPE";
      // Strip trailing " Recipe" suffix (e.g. "Pulled Pork Recipe" → "Pulled Pork")
      name = b1.replace(/\s+recipe\s*$/i, "").trim();
    } else {
      // Not a recipe or menu item sheet — skip (e.g. summary, cover pages)
      continue;
    }

    if (!name) continue;

    // ── Extract components/ingredients (rows 3–22, 0-indexed: 2–21) ──
    const components = extractComponents(rows);

    // ── Extract yield info (row 24 col E, row 25 col E) ──
    const { yieldAmount, yieldMeasure } = extractYield(rows);

    // ── Extract assembly steps (rows 25+, column A) ──
    const assembly = extractAssembly(rows);

    results.push({
      type,
      name,
      sheet_name: sheetName,
      components,
      assembly,
      yield_amount: yieldAmount,
      yield_measure: yieldMeasure,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Component / Ingredient Extraction
// ---------------------------------------------------------------------------

function extractComponents(rows: unknown[][]): ParsedComponent[] {
  const components: ParsedComponent[] = [];

  // Rows 3–22 in the template (0-indexed: 2–21)
  const endRow = Math.min(21, rows.length - 1);

  for (let i = 2; i <= endRow; i++) {
    const row = rows[i];
    if (!row) continue;

    const rawName = row[0];
    if (rawName == null || String(rawName).trim() === "") continue;

    const ingredientName = String(rawName).trim();

    // Detect "(See Recipe)" or "(See MENU ITEM)" references
    const hasRecipe = /\(see\s+(recipe|menu\s*item)\)/i.test(ingredientName);
    const cleanName = ingredientName
      .replace(/\s*\(see\s+(recipe|menu\s*item)\)\s*/i, "")
      .trim();

    // Parse quantity — handle "tt"/"TT" (to taste) and missing values
    const rawQty = row[1];
    let quantity = "";
    if (rawQty != null) {
      const qtyStr = String(rawQty).trim();
      if (/^tt$/i.test(qtyStr)) {
        quantity = "to taste";
      } else if (qtyStr !== "") {
        quantity = qtyStr;
      }
    }

    // Parse measure — also handle "TT" as "to taste"
    const rawMeasure = row[2];
    let measure = "";
    if (rawMeasure != null) {
      const measureStr = String(rawMeasure).trim();
      if (/^tt$/i.test(measureStr)) {
        measure = "to taste";
      } else {
        measure = measureStr;
      }
    }

    components.push({
      name: cleanName,
      quantity,
      measure,
      has_recipe: hasRecipe,
    });
  }

  return components;
}

// ---------------------------------------------------------------------------
// Yield Extraction
// ---------------------------------------------------------------------------

function extractYield(rows: unknown[][]): {
  yieldAmount: number | null;
  yieldMeasure: string | null;
} {
  let yieldAmount: number | null = null;
  let yieldMeasure: string | null = null;

  // Row 24 (0-indexed 23), column E (index 4) = Yield Amount
  if (rows.length > 23) {
    const rawYield = rows[23]?.[4];
    if (typeof rawYield === "number") {
      yieldAmount = rawYield;
    } else if (rawYield != null) {
      const parsed = parseFloat(String(rawYield));
      if (!isNaN(parsed)) yieldAmount = parsed;
    }
  }

  // Row 25 (0-indexed 24), column E (index 4) = Yield Measure
  if (rows.length > 24) {
    const rawMeasure = rows[24]?.[4];
    if (rawMeasure != null) {
      yieldMeasure = String(rawMeasure).trim() || null;
    }
  }

  return { yieldAmount, yieldMeasure };
}

// ---------------------------------------------------------------------------
// Assembly Step Extraction
// ---------------------------------------------------------------------------
// Handles all three formats found in your workbooks:
//   1. Single cell with \n\n between numbered steps  (Pulled Pork, Brisket)
//   2. Single cell with \n between numbered steps     (Marinara, Meatball Sub)
//   3. Separate rows for each step                     (Mac & Cheese, Slaw)
// ---------------------------------------------------------------------------

function extractAssembly(rows: unknown[][]): string[] {
  const steps: string[] = [];

  // Assembly steps start at row 25 (0-indexed 24), column A
  for (let i = 24; i <= Math.min(34, rows.length - 1); i++) {
    const row = rows[i];
    if (!row) continue;

    const cellA = row[0];
    if (cellA == null) continue;

    const text = String(cellA).trim();
    if (text === "" || /^photo/i.test(text)) break;

    // Check if this cell contains multiple numbered steps
    const hasNumberedSteps = /\n+\s*\d+\.\s/.test(text);

    if (hasNumberedSteps) {
      // Split on newline(s) followed by a step number
      const subSteps = text
        .split(/\n+(?=\d+\.\s*)/)
        .map((s) => s.replace(/^\d+\.\s*/, "").trim())
        .filter((s) => s.length > 0);
      steps.push(...subSteps);
    } else {
      // Single step in this cell — strip leading number if present
      const cleaned = text.replace(/^\d+\.\s*/, "").trim();
      if (cleaned.length > 0) steps.push(cleaned);
    }
  }

  return steps;
}

// ---------------------------------------------------------------------------
// Fuzzy Name Matching
// ---------------------------------------------------------------------------
// Handles real-world inconsistencies:
//   - "Meatball Recipe" → "Meatball" vs component "Meatballs" (plural)
//   - "Bechemel" vs "Bechamel" (typo, edit distance 1)
//   - Case differences
// ---------------------------------------------------------------------------

function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Simple Levenshtein distance for catching typos */
function editDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = b[i - 1] === a[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Try to match a component name to a known recipe/ingredient name.
 * Returns the matched name or null if no match found.
 */
function findMatch(
  componentName: string,
  knownNames: Map<string, string> // normalized → original
): string | null {
  const cn = normalize(componentName);

  // 1. Exact normalized match
  if (knownNames.has(cn)) return knownNames.get(cn)!;

  // 2. Singular/plural (trailing 's')
  if (knownNames.has(cn + "s")) return knownNames.get(cn + "s")!;
  if (cn.endsWith("s") && knownNames.has(cn.slice(0, -1))) {
    return knownNames.get(cn.slice(0, -1))!;
  }

  // 3. Prefix match (one starts with the other, min 5 chars to avoid false positives)
  for (const [known, original] of knownNames) {
    if (cn.length >= 5 && known.length >= 5) {
      if (cn.startsWith(known) || known.startsWith(cn)) return original;
    }
  }

  // 4. Edit distance ≤ 2 for similar-length names (catches typos like Bechemel/Bechamel)
  for (const [known, original] of knownNames) {
    if (Math.abs(cn.length - known.length) <= 2) {
      if (editDistance(cn, known) <= 2) return original;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Database Operations
// ---------------------------------------------------------------------------

interface SaveResult {
  menuItemsCount: number;
  ingredientsCount: number;
  recipesCount: number;
  newMenuItems: string[];
  duplicateMenuItems: string[];
  newRecipes: string[];
  duplicateRecipes: string[];
  newIngredients: string[];
  duplicateIngredients: string[];
  discovery: Array<{ sheet: string; type: string; name: string }>;
}

async function saveToDatabase(
  supabase: ReturnType<typeof createClient>,
  sheets: SheetResult[],
  publicUrl: string
): Promise<SaveResult> {
  const result: SaveResult = {
    menuItemsCount: 0,
    ingredientsCount: 0,
    recipesCount: 0,
    newMenuItems: [],
    duplicateMenuItems: [],
    newRecipes: [],
    duplicateRecipes: [],
    newIngredients: [],
    duplicateIngredients: [],
    discovery: sheets.map((s) => ({
      sheet: s.sheet_name,
      type: s.type,
      name: s.name,
    })),
  };

  // Track recipe ingredient IDs for linking to menu item components
  const recipeIngredientIds = new Map<string, string>(); // lowercase name → ingredient UUID
  const recipeNamesNormalized = new Map<string, string>(); // normalized → original name

  // ── Phase 1: Process RECIPE sheets (create ingredients with recipe_data) ──

  const recipeSheets = sheets.filter((s) => s.type === "RECIPE");

  for (const recipe of recipeSheets) {
    const recipeData = {
      ingredients: recipe.components.map((c) => ({
        name: c.name,
        quantity: c.quantity,
        measure: c.measure,
      })),
      assembly: recipe.assembly,
      yield_amount: recipe.yield_amount,
      yield_measure: recipe.yield_measure,
    };

    // Check if ingredient already exists
    const { data: existing } = await supabase
      .from("ingredients")
      .select("id")
      .ilike("name", recipe.name)
      .single();

    let ingredientId: string;

    if (existing) {
      ingredientId = existing.id;
      await supabase
        .from("ingredients")
        .update({ recipe_data: recipeData, recipe_file_url: publicUrl })
        .eq("id", ingredientId);
      result.duplicateRecipes.push(recipe.name);
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
        console.error(`Failed to create recipe ingredient: ${recipe.name}`, error);
        continue;
      }
      ingredientId = created.id;
      result.ingredientsCount++;
      result.newRecipes.push(recipe.name);
    }

    recipeIngredientIds.set(recipe.name.toLowerCase(), ingredientId);
    recipeNamesNormalized.set(normalize(recipe.name), recipe.name);
    result.recipesCount++;
  }

  // ── Phase 2: Process MENU_ITEM sheets ──

  const menuSheets = sheets.filter((s) => s.type === "MENU_ITEM");

  for (const menuItem of menuSheets) {
    // Check if this menu item already exists
    const { data: existingMi } = await supabase
      .from("menu_items")
      .select("id")
      .ilike("name", menuItem.name)
      .single();

    const isNew = !existingMi;

    // Upsert the menu item
    const { data: mi, error: miError } = await supabase
      .from("menu_items")
      .upsert(
        {
          name: menuItem.name,
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

    result.menuItemsCount++;
    if (isNew) {
      result.newMenuItems.push(menuItem.name);
    } else {
      result.duplicateMenuItems.push(menuItem.name);
    }

    // Also create an ingredient with recipe_data for this menu item
    // (so it shows up in the kitchen with assembly steps)
    if (menuItem.components.length > 0 || menuItem.assembly.length > 0) {
      const menuRecipeData = {
        ingredients: menuItem.components.map((c) => ({
          name: c.name,
          quantity: c.quantity,
          measure: c.measure,
        })),
        assembly: menuItem.assembly,
        yield_amount: menuItem.yield_amount,
        yield_measure: menuItem.yield_measure,
      };

      const { data: existingIng } = await supabase
        .from("ingredients")
        .select("id")
        .ilike("name", menuItem.name)
        .single();

      if (existingIng) {
        await supabase
          .from("ingredients")
          .update({ recipe_data: menuRecipeData, recipe_file_url: publicUrl })
          .eq("id", existingIng.id);
      } else {
        const { data: created } = await supabase
          .from("ingredients")
          .insert({
            name: menuItem.name,
            recipe_data: menuRecipeData,
            recipe_file_url: publicUrl,
          })
          .select("id")
          .single();

        if (created) {
          result.ingredientsCount++;
        }
      }
    }

    // ── Create BOM entries for each component ──

    for (const comp of menuItem.components) {
      let ingredientId: string | undefined;

      // First: try to match against recipe ingredients created in Phase 1
      if (comp.has_recipe) {
        const matchedName = findMatch(comp.name, recipeNamesNormalized);
        if (matchedName) {
          ingredientId = recipeIngredientIds.get(matchedName.toLowerCase());
        }
      }

      // Second: if no recipe match, look up existing ingredient in database
      if (!ingredientId) {
        ingredientId = recipeIngredientIds.get(comp.name.toLowerCase());
      }

      if (!ingredientId) {
        const { data: existing } = await supabase
          .from("ingredients")
          .select("id")
          .ilike("name", comp.name)
          .single();

        if (existing) {
          ingredientId = existing.id;
          result.duplicateIngredients.push(comp.name);
        } else {
          // Create a new ingredient (raw component without a recipe)
          const { data: created, error } = await supabase
            .from("ingredients")
            .insert({ name: comp.name, unit: comp.measure || "each" })
            .select("id")
            .single();

          if (error) {
            console.error(`Failed to create ingredient: ${comp.name}`, error);
            continue;
          }
          ingredientId = created.id;
          result.ingredientsCount++;
          result.newIngredients.push(comp.name);
        }
      }

      // Parse quantity for BOM (default to 1 if "to taste" or unparseable)
      let bomQuantity = 1;
      const parsed = parseFloat(comp.quantity);
      if (!isNaN(parsed) && parsed > 0) bomQuantity = parsed;

      // Upsert the BOM link
      await supabase.from("bill_of_materials").upsert(
        {
          menu_item_id: mi.id,
          ingredient_id: ingredientId,
          quantity: bomQuantity,
          unit: comp.measure || "each",
        },
        { onConflict: "menu_item_id,ingredient_id" }
      );
    }
  }

  return result;
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

    const fileName = file.name.toLowerCase();
    if (
      !fileName.endsWith(".xlsx") &&
      !fileName.endsWith(".xls") &&
      !fileName.endsWith(".csv")
    ) {
      return new Response(
        JSON.stringify({
          error:
            "Unsupported file type. Please upload an XLSX or XLS workbook.",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const fileBytes = await file.arrayBuffer();

    // ── Upload original file to storage ──
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

    // ── Parse the workbook ──
    console.log(`[import-menu-workbook] Parsing ${file.name}…`);
    const sheets = parseWorkbook(fileBytes);

    const recipeCount = sheets.filter((s) => s.type === "RECIPE").length;
    const menuCount = sheets.filter((s) => s.type === "MENU_ITEM").length;
    const skippedCount =
      XLSX.read(new Uint8Array(fileBytes), { type: "array" }).SheetNames
        .length - sheets.length;

    console.log(
      `[import-menu-workbook] Found ${menuCount} menu items, ${recipeCount} recipes, skipped ${skippedCount} sheets`
    );

    // ── Save to database ──
    const result = await saveToDatabase(supabase, sheets, publicUrl);

    return new Response(
      JSON.stringify({
        menu_items_count: result.menuItemsCount,
        ingredients_count: result.ingredientsCount,
        recipes_count: result.recipesCount,
        discovery: result.discovery,
        new_menu_items: result.newMenuItems,
        duplicate_menu_items: result.duplicateMenuItems,
        new_recipes: result.newRecipes,
        duplicate_recipes: result.duplicateRecipes,
        new_ingredients: result.newIngredients,
        duplicate_ingredients: result.duplicateIngredients,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[import-menu-workbook] Error: ${message}`);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

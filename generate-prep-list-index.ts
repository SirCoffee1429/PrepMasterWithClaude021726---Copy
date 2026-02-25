import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ---------------------------------------------------------------------------
// Prep List Generation Logic
// ---------------------------------------------------------------------------
//
// This replaces the old per-day-of-week par level approach with a simpler
// formula that matches how your kitchen actually works:
//
//   1. Start of day: everything is at par (assumption after yesterday's prep)
//   2. Sales happen: items get consumed via BOM (bill of materials)
//   3. End of day: figure out what needs prepping back to par
//
// Formula per ingredient:
//   consumed = SUM(units_sold × bom_quantity) for all menu items sold
//   remaining = par_level - consumed
//   prep_needed = par_level - remaining = consumed (capped at par)
//
// In practice:
//   - If consumed >= par → prep the full par amount (you ran out)
//   - If consumed < par → prep only what was consumed
//   - If consumed is 0 → no prep needed
//   - threshold filter: skip items where consumed < (par × prep_threshold)
//     This avoids prepping items with negligible usage
//
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { report_id } = await req.json();

    if (!report_id) {
      return new Response(JSON.stringify({ error: "report_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ── Get the sales report ──
    const { data: report, error: reportError } = await supabase
      .from("sales_reports")
      .select("id, report_date")
      .eq("id", report_id)
      .single();

    if (reportError || !report) {
      throw new Error("Sales report not found");
    }

    // Prep date = day after sales date
    const salesDate = new Date(report.report_date);
    const prepDate = new Date(salesDate);
    prepDate.setDate(prepDate.getDate() + 1);
    const prepDateStr = prepDate.toISOString().split("T")[0];

    // ── Get sales data for this report ──
    const { data: salesData } = await supabase
      .from("sales_data")
      .select("menu_item_id, units_sold")
      .eq("sales_report_id", report_id)
      .not("menu_item_id", "is", null);

    if (!salesData || salesData.length === 0) {
      return new Response(
        JSON.stringify({
          error: "No matched sales data found",
          item_count: 0,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // ── Get BOM for all sold menu items ──
    const menuItemIds = [
      ...new Set(
        salesData.map((s) => s.menu_item_id).filter(Boolean) as string[]
      ),
    ];

    const { data: bomEntries } = await supabase
      .from("bill_of_materials")
      .select("menu_item_id, ingredient_id, quantity")
      .in("menu_item_id", menuItemIds);

    // ── Calculate ingredient consumption via BOM ──
    const ingredientConsumption = new Map<string, number>();

    for (const sale of salesData) {
      const boms = (bomEntries ?? []).filter(
        (b) => b.menu_item_id === sale.menu_item_id
      );
      for (const bom of boms) {
        const current = ingredientConsumption.get(bom.ingredient_id) ?? 0;
        ingredientConsumption.set(
          bom.ingredient_id,
          current + sale.units_sold * bom.quantity
        );
      }
    }

    if (ingredientConsumption.size === 0) {
      return new Response(
        JSON.stringify({
          error: "No BOM mappings found for sold items",
          item_count: 0,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const ingredientIds = [...ingredientConsumption.keys()];

    // ── Get ingredient details (par_level, unit, prep_threshold) ──
    const { data: ingredients } = await supabase
      .from("ingredients")
      .select("id, par_level, unit, prep_threshold")
      .in("id", ingredientIds);

    const ingredientMap = new Map<
      string,
      { par_level: number; unit: string; prep_threshold: number }
    >();
    for (const ing of ingredients ?? []) {
      ingredientMap.set(ing.id, {
        par_level: ing.par_level ?? 0,
        unit: ing.unit ?? "each",
        prep_threshold: ing.prep_threshold ?? 0.5,
      });
    }

    // ── Calculate prep quantities ──
    const prepItems: Array<{
      ingredient_id: string;
      amount_needed: number;
      unit: string;
    }> = [];

    for (const [ingredientId, consumed] of ingredientConsumption) {
      const details = ingredientMap.get(ingredientId);
      if (!details) continue;

      const { par_level, unit, prep_threshold } = details;

      // Skip ingredients with no par level set
      if (par_level <= 0) continue;

      // Threshold check: skip if consumption is too low relative to par
      // e.g. if threshold is 0.5 and par is 10, skip if consumed < 5
      const consumptionRatio = consumed / par_level;
      if (consumptionRatio < prep_threshold) continue;

      // Prep needed = min(consumed, par_level)
      // If we consumed more than par, we still only prep up to par
      // If we consumed less than par, prep just what was consumed
      const prepNeeded = Math.min(consumed, par_level);

      if (prepNeeded > 0) {
        prepItems.push({
          ingredient_id: ingredientId,
          amount_needed: Math.ceil(prepNeeded),
          unit,
        });
      }
    }

    // ── Create or update prep list for the date ──
    const { data: prepList, error: prepListError } = await supabase
      .from("prep_lists")
      .upsert(
        { prep_date: prepDateStr, generated_at: new Date().toISOString() },
        { onConflict: "prep_date" }
      )
      .select("id")
      .single();

    if (prepListError) throw prepListError;

    // Delete existing items for this prep list (regenerating)
    await supabase
      .from("prep_list_items")
      .delete()
      .eq("prep_list_id", prepList.id);

    // Insert new prep items
    if (prepItems.length > 0) {
      const rows = prepItems.map((item) => ({
        prep_list_id: prepList.id,
        ingredient_id: item.ingredient_id,
        amount_needed: item.amount_needed,
        unit: item.unit,
        status: "open",
      }));

      const { error: insertError } = await supabase
        .from("prep_list_items")
        .insert(rows);

      if (insertError) throw insertError;
    }

    return new Response(
      JSON.stringify({
        prep_list_id: prepList.id,
        prep_date: prepDateStr,
        item_count: prepItems.length,
        items: prepItems,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[generate-prep-list] Error: ${message}`);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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

    // Get the sales report to determine dates
    const { data: report, error: reportError } = await supabase
      .from("sales_reports")
      .select("id, report_date")
      .eq("id", report_id)
      .single();

    if (reportError || !report) {
      throw new Error("Sales report not found");
    }

    const salesDate = new Date(report.report_date);
    const prepDate = new Date(salesDate);
    prepDate.setDate(prepDate.getDate() + 1);
    const prepDateStr = prepDate.toISOString().split("T")[0];
    const prepDayOfWeek = prepDate.getDay(); // 0=Sun, 6=Sat
    const salesDayOfWeek = salesDate.getDay();

    // Get sales data for this report
    const { data: salesData } = await supabase
      .from("sales_data")
      .select("menu_item_id, units_sold")
      .eq("sales_report_id", report_id)
      .not("menu_item_id", "is", null);

    if (!salesData || salesData.length === 0) {
      return new Response(
        JSON.stringify({ error: "No matched sales data found", item_count: 0 }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // Get BOM for all sold menu items
    const menuItemIds = [
      ...new Set(salesData.map((s) => s.menu_item_id).filter(Boolean)),
    ];

    const { data: bomEntries } = await supabase
      .from("bill_of_materials")
      .select("menu_item_id, ingredient_id, quantity")
      .in("menu_item_id", menuItemIds);

    // Aggregate ingredient consumption from sales via BOM
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
        { headers: { "Content-Type": "application/json" } }
      );
    }

    const ingredientIds = [...ingredientConsumption.keys()];

    // Get par levels for both days
    const { data: parLevels } = await supabase
      .from("par_levels")
      .select("ingredient_id, day_of_week, par_quantity")
      .in("ingredient_id", ingredientIds)
      .in("day_of_week", [salesDayOfWeek, prepDayOfWeek]);

    const parMap = new Map<string, number>();
    for (const pl of parLevels ?? []) {
      parMap.set(`${pl.ingredient_id}-${pl.day_of_week}`, pl.par_quantity);
    }

    // Get ingredient details (for threshold + unit)
    const { data: ingredients } = await supabase
      .from("ingredients")
      .select("id, unit, prep_threshold")
      .in("id", ingredientIds);

    const ingredientMap = new Map<
      string,
      { unit: string; prep_threshold: number }
    >();
    for (const ing of ingredients ?? []) {
      ingredientMap.set(ing.id, {
        unit: ing.unit,
        prep_threshold: ing.prep_threshold,
      });
    }

    // Calculate prep quantities
    const prepItems: Array<{
      ingredient_id: string;
      amount_needed: number;
      unit: string;
    }> = [];

    for (const [ingredientId, consumed] of ingredientConsumption) {
      const prevPar =
        parMap.get(`${ingredientId}-${salesDayOfWeek}`) ?? 0;
      const currentPar =
        parMap.get(`${ingredientId}-${prepDayOfWeek}`) ?? 0;
      const ingDetails = ingredientMap.get(ingredientId);
      const threshold = ingDetails?.prep_threshold ?? 0.5;

      // Skip if par is 0
      if (prevPar === 0 || currentPar === 0) continue;

      // 50% threshold rule: skip if consumption ratio is below threshold
      const consumptionRatio = consumed / prevPar;
      if (consumptionRatio < threshold) continue;

      // remaining = prevPar - consumed
      const remaining = Math.max(0, prevPar - consumed);
      // prep_needed = currentPar - remaining
      const prepNeeded = Math.max(0, currentPar - remaining);

      if (prepNeeded > 0) {
        prepItems.push({
          ingredient_id: ingredientId,
          amount_needed: Math.ceil(prepNeeded),
          unit: ingDetails?.unit ?? "each",
        });
      }
    }

    // Create or update prep list for the date
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

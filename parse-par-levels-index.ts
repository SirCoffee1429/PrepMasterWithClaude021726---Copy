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

interface ParsedParItem {
  item_name: string;
  par_quantity: number;
  par_unit: string;
  section: string | null; // "Frozen", "Cooler", "Hot", "Sauces", etc.
}

// ---------------------------------------------------------------------------
// Par Sheet Layout
// ---------------------------------------------------------------------------
// Your par sheets follow this structure:
//
//   Row 1:  A = Title with station name, e.g. "OH Prep - Fry"
//   Row 3-4: Column headers (Item, Par, Tue, Wed, Thu, Fri, Sat, Sun)
//   Rows 5+: Mix of:
//     - Section headers:  A ends with ":" (e.g. "Frozen:", "Cooler:"), B is empty
//     - Item rows:        A = item name, B = "quantity unit" (e.g. "3 bags", "40ea.")
//
// This parser reads the template directly — no AI needed.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Station Detection from Title
// ---------------------------------------------------------------------------
// Looks for known station names in the sheet title (Row 1) and file name.
// "OH Prep - Fry" → "Fry"
// "Updated_Fry_Par_Levels.xlsx" → "Fry"
// ---------------------------------------------------------------------------

const KNOWN_STATIONS = ["grill", "salad", "sautee", "flattop", "fry"];

function detectStation(title: string, fileName: string): string | null {
  const combined = `${title} ${fileName}`.toLowerCase();

  for (const station of KNOWN_STATIONS) {
    if (combined.includes(station)) {
      // Return with proper capitalization
      return station.charAt(0).toUpperCase() + station.slice(1);
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Par Value Parsing
// ---------------------------------------------------------------------------
// Handles all formats found in your par sheets:
//   "3 bags"     → quantity=3, unit="bags"
//   "40ea."      → quantity=40, unit="ea"
//   "2 qts"      → quantity=2, unit="qts"
//   "1 cambro"   → quantity=1, unit="cambro"
//   "12 orders"  → quantity=12, unit="orders"
//   "1/3 pan"    → quantity=0.33, unit="pan"
//   "2 1/3 pan"  → quantity=2.33, unit="pan"
// ---------------------------------------------------------------------------

function parseParValue(raw: string): {
  quantity: number;
  unit: string;
} | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Pattern: optional whole number, optional fraction, then unit
  // e.g. "2 1/3 pan", "1/3 pan", "3 bags", "40ea."
  const match = trimmed.match(
    /^(\d+)?\s*(?:(\d+)\/(\d+))?\s*(.+)$/
  );

  if (!match) return null;

  const wholeStr = match[1];
  const numerStr = match[2];
  const denomStr = match[3];
  const unitRaw = match[4];

  let quantity = 0;

  if (wholeStr) {
    quantity += parseFloat(wholeStr);
  }

  if (numerStr && denomStr) {
    const denom = parseFloat(denomStr);
    if (denom !== 0) {
      quantity += parseFloat(numerStr) / denom;
    }
  }

  // If we got 0 quantity and there was no whole or fraction, parse failed
  if (quantity === 0 && !wholeStr && !numerStr) return null;

  // Clean up unit: strip trailing dots, trim
  const unit = unitRaw.trim().replace(/\.+$/, "");

  if (!unit) return null;

  return {
    quantity: Math.round(quantity * 100) / 100, // round to 2 decimals
    unit,
  };
}

// ---------------------------------------------------------------------------
// Sheet Parser
// ---------------------------------------------------------------------------

function parseParSheet(
  rows: unknown[][],
  sheetTitle: string,
  fileName: string
): { items: ParsedParItem[]; station: string | null } {
  const items: ParsedParItem[] = [];
  let currentSection: string | null = null;

  // Detect station from title row (row 1) and file name
  const titleRow = String(rows[0]?.[0] ?? "");
  const station = detectStation(titleRow || sheetTitle, fileName);

  // Start scanning from row 5 (0-indexed: 4) to skip headers
  // But be flexible — scan from row 2 onward and skip header-like rows
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    const cellA = row[0];
    const cellB = row[1];

    if (cellA == null || String(cellA).trim() === "") continue;

    const a = String(cellA).trim();
    const b = cellB != null ? String(cellB).trim() : "";

    // Skip header rows (e.g. "Item:", column headers)
    if (/^item/i.test(a) && (!b || /^par/i.test(b))) continue;

    // Section headers end with ":" and have no par value
    if (a.endsWith(":") && !b) {
      currentSection = a.replace(/:$/, "").trim();
      continue;
    }

    // Item rows have a name in A and a par value in B
    if (a && b) {
      const parsed = parseParValue(b);
      if (parsed) {
        items.push({
          item_name: a,
          par_quantity: parsed.quantity,
          par_unit: parsed.unit,
          section: currentSection,
        });
      }
    }
  }

  return { items, station };
}

// ---------------------------------------------------------------------------
// Workbook Parser (handles multi-sheet par files)
// ---------------------------------------------------------------------------

function parseParWorkbook(
  buffer: ArrayBuffer,
  fileName: string
): { items: ParsedParItem[]; station: string | null } {
  const workbook = XLSX.read(new Uint8Array(buffer), { type: "array" });
  const allItems: ParsedParItem[] = [];
  let detectedStation: string | null = null;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: null,
    });

    const { items, station } = parseParSheet(rows, sheetName, fileName);
    allItems.push(...items);

    // Use the first detected station
    if (station && !detectedStation) {
      detectedStation = station;
    }
  }

  return { items: allItems, station: detectedStation };
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

    if (!isSpreadsheet) {
      // For PDFs, we still need AI — but par levels should ideally be XLSX.
      // Return a helpful error for now.
      return new Response(
        JSON.stringify({
          error:
            "PDF par level sheets are not yet supported with the new parser. " +
            "Please export your par sheet as XLSX for best results.",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // ── Parse the workbook ──
    console.log(`[parse-par-levels] Parsing ${file.name}…`);
    const { items, station } = parseParWorkbook(fileBytes, file.name);

    console.log(
      `[parse-par-levels] Found ${items.length} items, station: ${station ?? "unknown"}`
    );

    // ── Resolve station ID ──
    let stationId: string | null = null;
    if (station) {
      const { data: stationRow } = await supabase
        .from("stations")
        .select("id")
        .ilike("name", station)
        .single();

      if (stationRow) {
        stationId = stationRow.id;
        console.log(
          `[parse-par-levels] Matched station "${station}" → ${stationId}`
        );
      }
    }

    // ── Save to database ──
    let count = 0;
    const newItems: string[] = [];
    const duplicateItems: string[] = [];

    for (const item of items) {
      const { data: existing } = await supabase
        .from("ingredients")
        .select("id, station_id")
        .ilike("name", item.item_name)
        .single();

      if (existing) {
        // Update par_level, unit, and assign station if not already set
        const updates: Record<string, unknown> = {
          par_level: item.par_quantity,
          unit: item.par_unit,
        };

        // Only set station if the ingredient doesn't already have one
        if (stationId && !existing.station_id) {
          updates.station_id = stationId;
        }

        await supabase
          .from("ingredients")
          .update(updates)
          .eq("id", existing.id);

        duplicateItems.push(item.item_name);
      } else {
        // Create new ingredient with par_level, unit, and station
        const insertData: Record<string, unknown> = {
          name: item.item_name,
          par_level: item.par_quantity,
          unit: item.par_unit,
        };

        if (stationId) {
          insertData.station_id = stationId;
        }

        const { error: createError } = await supabase
          .from("ingredients")
          .insert(insertData);

        if (createError) {
          console.error(
            `Failed to create ingredient: ${item.item_name}`,
            createError
          );
          continue;
        }

        newItems.push(item.item_name);
      }

      count++;
    }

    return new Response(
      JSON.stringify({
        count,
        items_processed: items.length,
        station_detected: station,
        station_assigned: !!stationId,
        new_items: newItems,
        duplicate_items: duplicateItems,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[parse-par-levels] Error: ${message}`);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

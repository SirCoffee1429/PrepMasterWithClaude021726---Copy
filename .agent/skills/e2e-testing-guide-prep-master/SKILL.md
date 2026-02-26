---
name: PrepMaster — End-to-End Testing Guide
description: This guide walks through every feature of the app in the order a real user would encounter them. Start with a clean database or at least know what data is already there so you can verify new entries. Open browser DevTools (F12 → Network tab) to watch API calls during each test.

---

## Prerequisites

Before testing, confirm:

- [ ] App is running locally (`npm run dev`) or deployed
- [ ] Supabase project is accessible (check dashboard)
- [ ] All 4 edge functions are deployed (`import-menu-workbook`, `parse-par-levels`, `generate-prep-list`, `parse-sales`)
- [ ] `ANTHROPIC_API_KEY` secret is set in Supabase
- [ ] You have test files ready:
  - At least on 3 recipe workbooks XLSX (e.g., `BBQ_Combo_Platter.xlsx`, `Meatball_Sub.xlsx`)
  - At least 2 par level XLSX (e.g., `Updated_Fry_Par_Levels.xlsx`)
  - At least 2 sales report PDF (e.g., `1_13_26.pdf`)

---

## Phase 1: Authentication & Navigation

### Test 1.1 — Login
1. Navigate to the app URL (e.g., `http://localhost:5173`)
2. You should see a login screen
3. Log in with valid credentials

**Expected:** Redirected to the Office dashboard after successful login.

**Check for:**
- Login form accepts email + password
- Invalid credentials show an error message
- No blank screen or console errors after login

### Test 1.2 — Office Navigation Tabs
1. After login, verify you see the Office view with tabs
2. Click through each tab: **Menu Items**, **Recipes**, **Par Levels**, **Sales Data**

**Expected:** Each tab loads without errors and shows its content (or an empty state message if no data exists yet).

### Test 1.3 — Kitchen Route (No Auth)
1. Open a new browser tab
2. Navigate directly to `/kitchen`

**Expected:** Kitchen dashboard loads without requiring login. This is intentional — kitchen tablets don't need credentials.

---

## Phase 2: Workbook Import (Menu Items Tab)

### Test 2.1 — Upload a Recipe Workbook
1. Go to the **Menu Items** tab
2. Click the upload button/area
3. Select a recipe workbook XLSX (e.g., `BBQ_Combo_Platter.xlsx`)
4. Wait for the response

**Expected:**
- No Gemini errors (the old API is gone)
- Response shows counts: menu items found, recipes found, ingredients created
- Response includes `discovery` array listing each sheet with its type (MENU_ITEM or RECIPE) and name
- New items appear in the `new_menu_items` and `new_recipes` arrays
- If re-uploading the same file, items appear in `duplicate_menu_items` / `duplicate_recipes` instead

**Check in Supabase Dashboard (Table Editor):**
- `menu_items` table: new menu item rows created (e.g., "BBQ Combo Platter")
- `ingredients` table: new ingredient rows for each recipe (e.g., "Pulled Pork", "Brisket", "Marinara")
- `ingredients.recipe_data` column: should contain JSON with `ingredients`, `assembly`, `yield_amount`, `yield_measure`
- `bill_of_materials` table: BOM rows linking menu items to their ingredients with correct quantities

### Test 2.2 — Verify Recipe Data Integrity
1. In Supabase Table Editor, open the `ingredients` table
2. Find an ingredient that was imported as a recipe (e.g., "Pulled Pork")
3. Click the `recipe_data` cell to inspect the JSON

**Expected JSON structure:**
```json
{
  "ingredients": [
    {"name": "Pork", "quantity": "10", "measure": "lbs"},
    {"name": "Brown Sugar", "quantity": "3", "measure": "oz"}
  ],
  "assembly": [
    "Combine brown sugar, Lawry's, smoked paprika...",
    "Pat the pork dry and trim the fat cap..."
  ],
  "yield_amount": 10,
  "yield_measure": "lbs"
}
```

**Check for:**
- All ingredients have name, quantity, and measure populated
- "to taste" items show `"quantity": "to taste"` and `"measure": "to taste"` or `"measure": ""`
- Assembly steps are split correctly (no extra numbering, no merged steps)
- Yield amount is a number (not a string), yield measure is a string
- "(See Recipe)" and "(See MENU ITEM)" tags are stripped from ingredient names

### Test 2.3 — Verify BOM Linking (Fuzzy Matching)
1. In `bill_of_materials` table, find rows for the menu item you uploaded
2. Check that each component has a valid `ingredient_id` pointing to the correct ingredient

**Expected:** Components with "(See Recipe)" in the original workbook are linked to the recipe ingredient created in Phase 1. For example, if "BBQ Combo Platter" lists "Pulled Pork (See Recipe)", the BOM should link to the "Pulled Pork" ingredient that has recipe_data.

**Check for edge cases:**
- Plural/singular matching: "Meatballs" component → "Meatball" recipe
- Typo matching: "Bechemel" component → "Bechamel" recipe (edit distance ≤ 2)
- Unmatched components become standalone ingredients (e.g., "Pickled Veg" if no matching recipe exists)

### Test 2.4 — Upload a Second Workbook (Deduplication)
1. Upload a different workbook that shares some ingredients with the first one
2. Check the response

**Expected:**
- Shared ingredients appear in `duplicate_recipes` / `duplicate_ingredients`
- Their `recipe_data` is updated (not duplicated) — check the `ingredients` table for the most recent data
- New, unique items are created normally

### Test 2.5 — Upload Invalid File
1. Try uploading a non-XLSX file (e.g., a .pdf or .txt file)

**Expected:** Error message saying "Unsupported file type. Please upload an XLSX or XLS workbook."

### Test 2.6 — Menu Items Display
1. After uploading, verify the Menu Items tab lists all imported menu items
2. Click on a menu item to see its components/BOM

**Expected:** Each menu item shows its name, and expanding it reveals its components with quantities and units.

---

## Phase 3: Recipes Tab

### Test 3.1 — Recipe List
1. Switch to the **Recipes** tab
2. Verify all imported recipes appear (these are ingredients with non-null `recipe_data`)

**Expected:** Each recipe card shows the recipe name, station (if assigned), yield info (e.g., "Yields 10 lbs"), and ingredient count.

### Test 3.2 — Expand a Recipe Card
1. Click on a recipe card to expand it

**Expected:**
- Yield badge appears (if yield data exists)
- Ingredients table shows Item, Qty, and Measure columns with correct data
- Assembly steps are numbered and listed in order
- "to taste" quantities display correctly (not as "0" or empty)

### Test 3.3 — Search Recipes
1. Type a recipe name in the search box (e.g., "Pulled")

**Expected:** Only matching recipes are shown. Clear the search to see all recipes again.

### Test 3.4 — Rename a Recipe
1. Click the pencil/edit icon on a recipe card
2. Change the name and press Enter (or click the checkmark)

**Expected:** Name updates immediately. Verify in Supabase Table Editor that the `ingredients.name` column was updated.

### Test 3.5 — Delete a Recipe
1. Click the trash icon on a recipe card
2. Confirm the deletion in the dialog

**Expected:** Recipe disappears from the list. In Supabase, the ingredient row still exists but `recipe_data` is set to `null`. The ingredient itself is preserved (it might still be referenced in BOMs).

---

## Phase 4: Par Levels Import

### Test 4.1 — Upload a Par Level Sheet
1. Switch to the **Par Levels** tab
2. Upload a par level XLSX (e.g., `Updated_Fry_Par_Levels.xlsx`)

**Expected response fields:**
- `count`: number of items processed (e.g., 22)
- `station_detected`: the station name pulled from the sheet title (e.g., "Fry")
- `station_assigned`: `true` if the station exists in your `stations` table
- `new_items`: items that didn't exist before
- `duplicate_items`: items that already existed (their par levels were updated)

### Test 4.2 — Verify Par Level Data
1. In Supabase Table Editor, open the `ingredients` table
2. Filter or sort by items from the par sheet you uploaded

**Check for each item:**
- `par_level` column has the correct numeric value (e.g., 3 for "3 bags")
- `unit` column has the correct unit (e.g., "bags", "pan", "ea", "qts")
- Fractional pars are parsed correctly: "1/3 pan" → par_level: 0.33, unit: "pan"
- Mixed fractions work: "2 1/3 pan" → par_level: 2.33, unit: "pan"
- Units like "40ea." are cleaned to "ea" (trailing dot removed)

### Test 4.3 — Verify Station Auto-Assignment
1. In the `ingredients` table, check items from the uploaded par sheet
2. Verify their `station_id` is set to the correct station

**Expected:** All items from `Updated_Fry_Par_Levels.xlsx` should have `station_id` pointing to the "Fry" station. Items that already had a station assigned from a previous import should NOT be overwritten.

### Test 4.4 — Par Levels Tab UI
1. In the app's Par Levels tab, verify the imported items are visible
2. Check that par values and units display correctly
3. Try manually editing a par level value in the UI

**Expected:** Changes save to the database. Verify by refreshing the page — the new value should persist.

### Test 4.5 — Upload Par Sheet for Different Station
1. Upload a par sheet for a different station (e.g., "Salad", "Grill")
2. Verify station detection works for the new station name

**Expected:** Items are auto-assigned to the correct station. Previously imported items keep their existing station assignments.

### Test 4.6 — Upload Non-XLSX Par File
1. Try uploading a PDF par level sheet

**Expected:** Error message: "PDF par level sheets are not yet supported with the new parser. Please export your par sheet as XLSX for best results."

---

## Phase 5: Sales Data Import

### Test 5.1 — Upload a Sales Report PDF
1. Switch to the **Sales Data** tab
2. Upload a sales PDF (e.g., `1_13_26.pdf`)
3. Wait for Claude to parse it (this is the one AI call remaining)

**Expected response:**
- `report_id`: UUID of the created sales report
- `report_date`: extracted from filename (e.g., "2026-01-13" from "1_13_26.pdf")
- `items`: array of parsed items with `raw_item_name`, `units_sold`, and `menu_item_id` (null if unmatched)
- `count`: total number of items parsed

**Check in Supabase Dashboard:**
- `sales_reports` table: new row with status "completed", correct date, file URL
- `sales_data` table: one row per parsed item with `units_sold` as a number

### Test 5.2 — Verify Item Matching
1. In the `sales_data` table, check `menu_item_id` for each row
2. Items whose `raw_item_name` matches a `menu_items.name` or `menu_items.pos_name` should have a valid `menu_item_id`
3. Unmatched items should have `menu_item_id` as null

**Expected:** Common items like "BBQ Combo Platter" or "Meatball Sub" match if they were previously imported via workbook. Niche POS names might not match and will show null — that's expected.

### Test 5.3 — Verify Parsing Quality
1. Compare the parsed items against the original PDF
2. Open the PDF side-by-side with the `sales_data` rows

**Check for:**
- Category headers (e.g., "Appetizers", "BBQ") are NOT included as items
- Subtotal/total rows are NOT included
- "Open Food" entries are excluded
- Modifiers like "SALAD OUT FIRST" are excluded
- All actual food items are present with correct unit counts
- Units sold are numbers (not strings)

### Test 5.4 — Sales Data Tab UI
1. In the app's Sales Data tab, verify the uploaded report appears
2. Check that items display with their names, units sold, and match status

**Expected:** Matched items show the linked menu item name. Unmatched items are flagged or shown differently so you know which ones need manual mapping.

### Test 5.5 — Upload Duplicate Sales Report
1. Upload the same PDF again

**Expected:** A new sales report is created (not deduplicated) with its own rows in `sales_data`. Check that both reports exist in `sales_reports`.

---

## Phase 6: Prep List Generation

### Test 6.1 — Generate a Prep List
1. After uploading sales data, trigger prep list generation
2. This calls the `generate-prep-list` function with the `report_id`

**Expected response:**
- `prep_list_id`: UUID of the created/updated prep list
- `prep_date`: day after the sales report date
- `item_count`: number of ingredients that need prepping
- `items`: array with `ingredient_id`, `amount_needed`, `unit`

### Test 6.2 — Verify the Prep Math
Trace the formula for one ingredient manually:

1. Pick a menu item from the sales data (e.g., "BBQ Combo Platter" with 24 sold)
2. Look up its BOM entries (e.g., Brisket × 6oz, Pulled Pork × 3oz, Mac & Cheese × 1 serving)
3. Calculate consumption: `units_sold × bom_quantity` for each ingredient
4. If the ingredient appears in multiple menu items, sum the consumption
5. Compare against `ingredients.par_level`
6. Threshold check: `consumption / par_level >= 0.5` (default threshold)
7. `prep_needed = min(consumption, par_level)`

**Example trace:**
```
BBQ Combo Platter: 24 sold
  → Brisket: 24 × 6 = 144oz consumed
  → Pulled Pork: 24 × 3 = 72oz consumed

Brisket Platter: 10 sold
  → Brisket: 10 × 6 = 60oz consumed

Total Brisket consumed: 144 + 60 = 204oz
Brisket par_level: 200oz
Consumption ratio: 204/200 = 1.02 (>= 0.5 threshold ✓)
prep_needed: min(204, 200) = 200oz
```

### Test 6.3 — Verify Prep List in Database
1. Check `prep_lists` table for the new prep list row
2. Check `prep_list_items` table for all items

**Expected:** Each prep list item has `ingredient_id`, `amount_needed`, `unit`, and `status: "open"`.

### Test 6.4 — Threshold Filtering
1. Find an ingredient with very low sales relative to its par (e.g., par=100 but only 5 consumed)
2. Consumption ratio = 5/100 = 0.05, which is below the 0.5 threshold

**Expected:** This ingredient should NOT appear on the prep list.

### Test 6.5 — Regenerate Prep List
1. Upload a different sales report for a different date
2. Generate a prep list from the new report
3. Then regenerate from the original report

**Expected:** The prep list for each date is independent. Regenerating deletes the old items for that date and replaces them with the new calculation.

### Test 6.6 — No BOM Mappings Edge Case
1. Upload a sales report where none of the items match any menu items

**Expected:** Response includes `"error": "No matched sales data found"` or `"No BOM mappings found for sold items"` with `item_count: 0`.

---

## Phase 7: Kitchen Dashboard

### Test 7.1 — Prep List Display
1. Navigate to `/kitchen`
2. Verify the current prep list loads (the most recent one)

**Expected:** Prep items are displayed, grouped by station. Each item shows ingredient name, amount needed, unit, and status.

### Test 7.2 — Status Updates
1. Find a prep item with status "open"
2. Tap/click it to change status to "in_progress"
3. Tap/click again to change to "completed"

**Expected:**
- Visual indicator changes (color, icon, or label)
- Status persists after page refresh
- `prep_list_items.status` in database reflects the change
- `prep_list_items.last_status_update` timestamp is updated

### Test 7.3 — Reset Status
1. Find a "completed" item
2. Reset it back to "open"

**Expected:** Status reverts. `assigned_user_id` is set to null on reset.

### Test 7.4 — Recipe Modal (View Recipe)
1. Find a prep item that has recipe data (e.g., "Pulled Pork")
2. Click the view/recipe icon

**Expected:**
- Modal opens with the recipe name as the title
- Yield badge shows (e.g., "Yield: 10 lbs") if yield data exists
- Ingredients table shows Item, Qty, Measure columns with correct data
- Assembly steps are numbered
- Modal closes when clicking X, clicking outside, or pressing Escape

### Test 7.5 — Recipe Modal with No Recipe Data
1. Find a prep item that is a raw ingredient (no recipe — e.g., a standalone item without workbook data)
2. Click the view icon

**Expected:** Modal shows "No recipe data available" with a message suggesting uploading the recipe workbook.

### Test 7.6 — Station Filtering
1. If the kitchen dashboard has station filters/tabs, click through each station

**Expected:** Only items assigned to that station are shown. Items with no station appear under "Other" or "Unassigned".

### Test 7.7 — Kitchen on Mobile/Tablet
1. Open `/kitchen` on a mobile device or use browser DevTools device emulation (toggle device toolbar)
2. Test the full flow: view prep list → tap items → change status → view recipes

**Expected:** Layout is responsive and touch-friendly. Buttons and tap targets are large enough for kitchen use with wet/gloved hands.

---

## Phase 8: Database Integrity Checks

Run these SQL queries in Supabase SQL Editor to verify data consistency after completing all tests:

### Test 8.1 — Orphan BOM Entries
```sql
-- BOM entries pointing to non-existent menu items or ingredients
SELECT bom.id, bom.menu_item_id, bom.ingredient_id
FROM bill_of_materials bom
LEFT JOIN menu_items mi ON bom.menu_item_id = mi.id
LEFT JOIN ingredients ing ON bom.ingredient_id = ing.id
WHERE mi.id IS NULL OR ing.id IS NULL;
```
**Expected:** 0 rows. If any exist, there are orphaned BOM entries.

### Test 8.2 — Ingredients with Par but No Station
```sql
-- Items with par levels set but no station assigned
SELECT name, par_level, unit, station_id
FROM ingredients
WHERE par_level > 0 AND station_id IS NULL
ORDER BY name;
```
**Expected:** Ideally 0 rows after par level import. Any results are items that weren't in a par sheet or whose station wasn't detected.

### Test 8.3 — Sales Data with No Menu Item Match
```sql
-- Unmatched sales items (need manual mapping or workbook import)
SELECT DISTINCT raw_item_name, COUNT(*) as occurrences
FROM sales_data
WHERE menu_item_id IS NULL
GROUP BY raw_item_name
ORDER BY occurrences DESC;
```
**Expected:** Shows which POS item names don't match any menu items. These are candidates for either adding a `pos_name` alias to the menu item or importing the missing workbook.

### Test 8.4 — Recipe Data Completeness
```sql
-- Recipes missing assembly steps or ingredients
SELECT name,
  recipe_data->'ingredients' IS NULL as missing_ingredients,
  recipe_data->'assembly' IS NULL as missing_assembly,
  jsonb_array_length(recipe_data->'ingredients') as ingredient_count,
  jsonb_array_length(recipe_data->'assembly') as step_count
FROM ingredients
WHERE recipe_data IS NOT NULL
ORDER BY name;
```
**Expected:** All recipes have at least 1 ingredient. Most should have assembly steps (some simple recipes may not).

### Test 8.5 — Prep List Item Integrity
```sql
-- Prep items pointing to non-existent ingredients or prep lists
SELECT pli.id, pli.prep_list_id, pli.ingredient_id
FROM prep_list_items pli
LEFT JOIN prep_lists pl ON pli.prep_list_id = pl.id
LEFT JOIN ingredients ing ON pli.ingredient_id = ing.id
WHERE pl.id IS NULL OR ing.id IS NULL;
```
**Expected:** 0 rows.

---

## Phase 9: Edge Cases & Error Handling

### Test 9.1 — Upload Empty Workbook
1. Create an XLSX with no valid sheets (no "MENU ITEM:" or "RECIPE:" headers)
2. Upload it

**Expected:** Response shows 0 menu items, 0 recipes, all sheets skipped. No crash.

### Test 9.2 — Upload Workbook with Only Recipes (No Menu Items)
1. Upload a workbook that has recipe sheets but no menu item sheets

**Expected:** Recipes are created as ingredients with recipe_data. No BOM entries created (no menu items to link). No errors.

### Test 9.3 — Network Failure During Upload
1. Disconnect network or throttle to very slow
2. Try uploading a file

**Expected:** Appropriate error message shown (not a blank screen or unhandled exception).

### Test 9.4 — Large Sales Report
1. Upload a large sales PDF with many items (50+)

**Expected:** Claude parses all items successfully. Check that the `sales_data` count matches what's in the PDF.

### Test 9.5 — Sales Report with No Date in Filename
1. Rename a sales PDF to something without a date (e.g., `report.pdf`)
2. Upload it

**Expected:** Falls back to today's date for `report_date`. Parsing still works normally.

### Test 9.6 — Concurrent Operations
1. Open two browser tabs
2. Upload a workbook in one tab and a par sheet in the other simultaneously

**Expected:** Both complete without errors. No duplicate or corrupted data.

---

## Phase 10: Full Pipeline Smoke Test

This is the end-to-end "golden path" test. Do these steps in order, starting from a clean state:

1. **Upload recipe workbook** → Menu Items tab, upload `BBQ_Combo_Platter.xlsx`
   - Verify: menu items, recipes, ingredients, BOMs created
2. **Upload par levels** → Par Levels tab, upload `Updated_Fry_Par_Levels.xlsx`
   - Verify: par_level values set, station auto-assigned to Fry
3. **Upload sales report** → Sales Data tab, upload `1_13_26.pdf`
   - Verify: items parsed, matches found, report status = completed
4. **Generate prep list** → Trigger generation from the sales report
   - Verify: prep items created with correct amounts based on consumption vs par
5. **Check kitchen** → Navigate to `/kitchen`
   - Verify: prep list items are displayed with correct stations
   - Tap an item → status changes to "in_progress"
   - Tap the recipe icon → recipe modal shows ingredients, qty, measure, assembly, yield
   - Tap item again → status changes to "completed"
6. **Re-upload workbook** → Upload the same workbook again
   - Verify: duplicate report shows, recipe_data updated (not duplicated)

If all 6 steps pass without errors, the full pipeline is working.

---

## Test Results Template

Copy this checklist and fill in results:

```
Date: ___________
Tester: ___________
Environment: [ ] Local  [ ] Deployed

Phase 1: Auth & Navigation
  [ ] 1.1 Login                    Pass / Fail / Notes: ___
  [ ] 1.2 Office tab navigation    Pass / Fail / Notes: ___
  [ ] 1.3 Kitchen no-auth access   Pass / Fail / Notes: ___

Phase 2: Workbook Import
  [ ] 2.1 Upload workbook          Pass / Fail / Notes: ___
  [ ] 2.2 Recipe data integrity    Pass / Fail / Notes: ___
  [ ] 2.3 BOM fuzzy matching       Pass / Fail / Notes: ___
  [ ] 2.4 Deduplication            Pass / Fail / Notes: ___
  [ ] 2.5 Invalid file type        Pass / Fail / Notes: ___
  [ ] 2.6 Menu items display       Pass / Fail / Notes: ___

Phase 3: Recipes
  [ ] 3.1 Recipe list              Pass / Fail / Notes: ___
  [ ] 3.2 Expand recipe card       Pass / Fail / Notes: ___
  [ ] 3.3 Search                   Pass / Fail / Notes: ___
  [ ] 3.4 Rename recipe            Pass / Fail / Notes: ___
  [ ] 3.5 Delete recipe            Pass / Fail / Notes: ___

Phase 4: Par Levels
  [ ] 4.1 Upload par sheet         Pass / Fail / Notes: ___
  [ ] 4.2 Par level data           Pass / Fail / Notes: ___
  [ ] 4.3 Station auto-assignment  Pass / Fail / Notes: ___
  [ ] 4.4 Par levels UI editing    Pass / Fail / Notes: ___
  [ ] 4.5 Different station        Pass / Fail / Notes: ___
  [ ] 4.6 Non-XLSX rejection       Pass / Fail / Notes: ___

Phase 5: Sales Data
  [ ] 5.1 Upload sales PDF         Pass / Fail / Notes: ___
  [ ] 5.2 Item matching            Pass / Fail / Notes: ___
  [ ] 5.3 Parsing quality          Pass / Fail / Notes: ___
  [ ] 5.4 Sales data UI            Pass / Fail / Notes: ___
  [ ] 5.5 Duplicate report         Pass / Fail / Notes: ___

Phase 6: Prep List
  [ ] 6.1 Generate prep list       Pass / Fail / Notes: ___
  [ ] 6.2 Verify prep math         Pass / Fail / Notes: ___
  [ ] 6.3 Database check           Pass / Fail / Notes: ___
  [ ] 6.4 Threshold filtering      Pass / Fail / Notes: ___
  [ ] 6.5 Regenerate               Pass / Fail / Notes: ___
  [ ] 6.6 No BOM edge case         Pass / Fail / Notes: ___

Phase 7: Kitchen Dashboard
  [ ] 7.1 Prep list display        Pass / Fail / Notes: ___
  [ ] 7.2 Status updates           Pass / Fail / Notes: ___
  [ ] 7.3 Reset status             Pass / Fail / Notes: ___
  [ ] 7.4 Recipe modal             Pass / Fail / Notes: ___
  [ ] 7.5 No recipe data modal     Pass / Fail / Notes: ___
  [ ] 7.6 Station filtering        Pass / Fail / Notes: ___
  [ ] 7.7 Mobile/tablet layout     Pass / Fail / Notes: ___

Phase 8: Database Integrity
  [ ] 8.1 Orphan BOM entries       Pass / Fail / Notes: ___
  [ ] 8.2 Par with no station      Pass / Fail / Notes: ___
  [ ] 8.3 Unmatched sales items    Pass / Fail / Notes: ___
  [ ] 8.4 Recipe completeness      Pass / Fail / Notes: ___
  [ ] 8.5 Prep item integrity      Pass / Fail / Notes: ___

Phase 9: Edge Cases
  [ ] 9.1 Empty workbook           Pass / Fail / Notes: ___
  [ ] 9.2 Recipes only workbook    Pass / Fail / Notes: ___
  [ ] 9.3 Network failure          Pass / Fail / Notes: ___
  [ ] 9.4 Large sales report       Pass / Fail / Notes: ___
  [ ] 9.5 No date in filename      Pass / Fail / Notes: ___
  [ ] 9.6 Concurrent uploads       Pass / Fail / Notes: ___

Phase 10: Full Pipeline
  [ ] Golden path (all 6 steps)    Pass / Fail / Notes: ___
```
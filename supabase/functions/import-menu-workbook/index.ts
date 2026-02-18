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

const PARSE_PROMPT = `You are a recipe workbook parser for a restaurant.
This XLSX workbook contains recipe and menu data.

Green-tabbed sheets contain MENU ITEMS with:
- Menu item name (the finished dish the guest receives)
- Ingredients list with: name, quantity, measure, unit cost, total cost
- Some ingredients say "(see recipe)" meaning they reference a separate recipe sheet

Blue-tabbed sheets contain RECIPES with:
- Recipe name (e.g., "Pulled Pork", "Caesar Dressing")
- Ingredients with: name, quantity, measure
- Assembly/preparation steps

Parse this workbook and return a JSON object with:
{
  "menu_items": [
    {
      "name": "Pulled Pork Platter",
      "category": "BBQ",
      "components": [
        { "ingredient_name": "Pulled Pork", "quantity": 1, "unit": "portion", "has_recipe": true },
        { "ingredient_name": "Mac and Cheese", "quantity": 1, "unit": "portion", "has_recipe": true },
        { "ingredient_name": "White Bread", "quantity": 2, "unit": "slices", "has_recipe": false }
      ]
    }
  ],
  "recipes": [
    {
      "name": "Pulled Pork",
      "ingredients": [
        { "name": "Pork Butt", "quantity": "10", "measure": "lb" },
        { "name": "Brown Sugar", "quantity": "2", "measure": "cup" }
      ],
      "assembly": ["Season pork with dry rub", "Smoke at 225F for 12 hours", "Pull and serve"]
    }
  ]
}

Return ONLY the JSON object, no markdown or other text.`;

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

    // Determine correct MIME type (browsers often send application/octet-stream for xlsx)
    const fileName = file.name.toLowerCase();
    let mimeType = file.type;
    if (fileName.endsWith(".xlsx")) {
      mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    } else if (fileName.endsWith(".xls")) {
      mimeType = "application/vnd.ms-excel";
    }

    // Upload original file to storage
    const storagePath = `workbooks/${file.name}`;
    await supabase.storage.from("uploads").upload(storagePath, fileBytes, {
      contentType: mimeType,
      upsert: true,
    });

    const {
      data: { publicUrl },
    } = supabase.storage.from("uploads").getPublicUrl(storagePath);

    // Call Gemini to parse the workbook
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
      geminiData.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";

    const parsed: {
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
    } = JSON.parse(responseText);

    let ingredientsCount = 0;
    let menuItemsCount = 0;
    let recipesCount = 0;

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
      }

      recipeIngredientIds.set(recipe.name.toLowerCase(), ingredientId);
      recipesCount++;
    }

    // Process menu items
    for (const menuItem of parsed.menu_items ?? []) {
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

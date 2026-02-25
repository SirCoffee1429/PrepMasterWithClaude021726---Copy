-- ============================================================
-- Add par_level to ingredients, drop per-day par_levels table
-- ============================================================
-- The par_levels table supported per-day-of-week par quantities,
-- but the actual workflow uses a single par target per ingredient.
-- The par value lives on ingredients.par_level, and generate-prep-list
-- now reads from there directly.
-- ============================================================

-- Add par_level column if it doesn't already exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ingredients'
      AND column_name = 'par_level'
  ) THEN
    ALTER TABLE public.ingredients
      ADD COLUMN par_level DECIMAL NOT NULL DEFAULT 0;
  END IF;
END $$;

-- Migrate any existing per-day data into ingredients.par_level
-- (takes the max par across all days as the single par value)
UPDATE public.ingredients i
SET par_level = sub.max_par
FROM (
  SELECT ingredient_id, MAX(par_quantity) AS max_par
  FROM public.par_levels
  GROUP BY ingredient_id
) sub
WHERE i.id = sub.ingredient_id
  AND i.par_level = 0;

-- Drop the per-day par_levels table
DROP TABLE IF EXISTS public.par_levels;

-- Add index for quick lookups on par_level
CREATE INDEX IF NOT EXISTS idx_ingredients_par_level
  ON public.ingredients(par_level)
  WHERE par_level > 0;

-- ============================================================
-- Prep Master - Database Schema
-- ============================================================

-- Profiles (synced with Supabase Auth)
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  role TEXT NOT NULL DEFAULT 'cook' CHECK (role IN ('chef', 'sous_chef', 'cook')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'role', 'cook')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Stations
CREATE TABLE public.stations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  display_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Seed default stations
INSERT INTO public.stations (name, display_order) VALUES
  ('Grill', 1),
  ('Salad', 2),
  ('Sautee', 3),
  ('Flattop', 4),
  ('Fry', 5);

-- Ingredients (prep-able items: Romaine, Pulled Pork, Caesar Dressing, etc.)
CREATE TABLE public.ingredients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  station_id UUID REFERENCES public.stations(id),
  unit TEXT NOT NULL DEFAULT 'each',
  prep_threshold DECIMAL NOT NULL DEFAULT 0.50,
  recipe_file_url TEXT,
  recipe_data JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Menu items (what guests order: Caesar Salad, Pulled Pork Platter, etc.)
CREATE TABLE public.menu_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  category TEXT,
  station_id UUID REFERENCES public.stations(id),
  pos_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Bill of Materials (links menu_items -> ingredients)
CREATE TABLE public.bill_of_materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_item_id UUID NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  ingredient_id UUID NOT NULL REFERENCES public.ingredients(id) ON DELETE CASCADE,
  quantity DECIMAL NOT NULL DEFAULT 1,
  unit TEXT NOT NULL DEFAULT 'each',
  UNIQUE(menu_item_id, ingredient_id)
);

-- Par levels (per ingredient, per day of week)
CREATE TABLE public.par_levels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ingredient_id UUID NOT NULL REFERENCES public.ingredients(id) ON DELETE CASCADE,
  day_of_week INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  par_quantity DECIMAL NOT NULL,
  UNIQUE(ingredient_id, day_of_week)
);

-- Sales reports (uploaded files + metadata)
CREATE TABLE public.sales_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_date DATE NOT NULL,
  file_url TEXT,
  file_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  error_message TEXT,
  uploaded_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Sales data (parsed item-level sales)
CREATE TABLE public.sales_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_report_id UUID NOT NULL REFERENCES public.sales_reports(id) ON DELETE CASCADE,
  menu_item_id UUID REFERENCES public.menu_items(id),
  raw_item_name TEXT NOT NULL,
  units_sold DECIMAL NOT NULL,
  report_date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Prep lists (one per day)
CREATE TABLE public.prep_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prep_date DATE UNIQUE NOT NULL,
  generated_at TIMESTAMPTZ DEFAULT now(),
  generated_by UUID REFERENCES public.profiles(id)
);

-- Prep list items (REALTIME ENABLED)
CREATE TABLE public.prep_list_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prep_list_id UUID NOT NULL REFERENCES public.prep_lists(id) ON DELETE CASCADE,
  ingredient_id UUID NOT NULL REFERENCES public.ingredients(id),
  amount_needed DECIMAL NOT NULL,
  unit TEXT NOT NULL DEFAULT 'each',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'completed')),
  assigned_user_id UUID REFERENCES public.profiles(id),
  completed_at TIMESTAMPTZ,
  last_status_update TIMESTAMPTZ DEFAULT now()
);

-- Enable Realtime on prep_list_items
ALTER PUBLICATION supabase_realtime ADD TABLE prep_list_items;

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX idx_par_levels_ingredient_day ON par_levels(ingredient_id, day_of_week);
CREATE INDEX idx_prep_list_items_list ON prep_list_items(prep_list_id);
CREATE INDEX idx_prep_list_items_status ON prep_list_items(status);
CREATE INDEX idx_sales_data_date ON sales_data(report_date);
CREATE INDEX idx_sales_data_report ON sales_data(sales_report_id);
CREATE INDEX idx_bill_of_materials_menu ON bill_of_materials(menu_item_id);
CREATE INDEX idx_bill_of_materials_ingredient ON bill_of_materials(ingredient_id);
CREATE INDEX idx_menu_items_station ON menu_items(station_id);
CREATE INDEX idx_ingredients_station ON ingredients(station_id);

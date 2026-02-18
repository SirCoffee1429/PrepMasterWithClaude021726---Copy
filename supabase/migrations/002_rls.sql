-- ============================================================
-- Prep Master - Row Level Security Policies
-- ============================================================

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bill_of_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.par_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prep_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prep_list_items ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Profiles
-- ============================================================
CREATE POLICY "Profiles are viewable by authenticated users"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id);

-- ============================================================
-- Stations (read: all authenticated, write: chef/sous_chef)
-- ============================================================
CREATE POLICY "Stations are viewable by all"
  ON public.stations FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Chefs can manage stations"
  ON public.stations FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('chef', 'sous_chef'))
  );

-- ============================================================
-- Ingredients (read: all, write: chef/sous_chef)
-- ============================================================
CREATE POLICY "Ingredients are viewable by all"
  ON public.ingredients FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Chefs can manage ingredients"
  ON public.ingredients FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('chef', 'sous_chef'))
  );

-- ============================================================
-- Menu Items (read: all, write: chef/sous_chef)
-- ============================================================
CREATE POLICY "Menu items are viewable by all"
  ON public.menu_items FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Chefs can manage menu items"
  ON public.menu_items FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('chef', 'sous_chef'))
  );

-- ============================================================
-- Bill of Materials (read: all, write: chef/sous_chef)
-- ============================================================
CREATE POLICY "BOM is viewable by all"
  ON public.bill_of_materials FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Chefs can manage BOM"
  ON public.bill_of_materials FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('chef', 'sous_chef'))
  );

-- ============================================================
-- Par Levels (read: all authenticated, write: chef only)
-- ============================================================
CREATE POLICY "Par levels are viewable by authenticated"
  ON public.par_levels FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Chefs can manage par levels"
  ON public.par_levels FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'chef')
  );

-- ============================================================
-- Sales Reports (read: all authenticated, write: chef/sous_chef)
-- ============================================================
CREATE POLICY "Sales reports are viewable by authenticated"
  ON public.sales_reports FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Chefs can manage sales reports"
  ON public.sales_reports FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('chef', 'sous_chef'))
  );

-- ============================================================
-- Sales Data (read: all authenticated, write: chef/sous_chef)
-- ============================================================
CREATE POLICY "Sales data is viewable by authenticated"
  ON public.sales_data FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Chefs can manage sales data"
  ON public.sales_data FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('chef', 'sous_chef'))
  );

-- ============================================================
-- Prep Lists (read: all, write: chef/sous_chef)
-- ============================================================
CREATE POLICY "Prep lists are viewable by all"
  ON public.prep_lists FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Chefs can manage prep lists"
  ON public.prep_lists FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('chef', 'sous_chef'))
  );

-- ============================================================
-- Prep List Items (read: all, update status: all authenticated, full manage: chef)
-- ============================================================
CREATE POLICY "Prep items are viewable by all"
  ON public.prep_list_items FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Authenticated users can update prep item status"
  ON public.prep_list_items FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Chefs can insert prep items"
  ON public.prep_list_items FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('chef', 'sous_chef'))
  );

CREATE POLICY "Chefs can delete prep items"
  ON public.prep_list_items FOR DELETE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('chef', 'sous_chef'))
  );

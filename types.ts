export interface Profile {
  readonly id: string
  readonly email: string
  readonly full_name: string | null
  readonly role: 'chef' | 'sous_chef' | 'cook'
  readonly created_at: string
}

export interface Station {
  readonly id: string
  readonly name: string
  readonly display_order: number
  readonly created_at: string
}

export interface Ingredient {
  readonly id: string
  readonly name: string
  readonly station_id: string | null
  readonly unit: string
  readonly par_level: number
  readonly recipe_file_url: string | null
  readonly recipe_data: RecipeData | null
  readonly created_at: string
  readonly station?: Station
}

export interface RecipeData {
  readonly ingredients: ReadonlyArray<RecipeIngredient>
  readonly assembly: ReadonlyArray<string>
  readonly yield_amount?: number | null
  readonly yield_measure?: string | null
}

export interface RecipeIngredient {
  readonly name: string
  readonly quantity: string
  readonly measure: string
}

export interface MenuItem {
  readonly id: string
  readonly name: string
  readonly category: string | null
  readonly station_id: string | null
  readonly pos_name: string | null
  readonly created_at: string
  readonly station?: Station
  readonly components?: ReadonlyArray<BillOfMaterial>
}

export interface BillOfMaterial {
  readonly id: string
  readonly menu_item_id: string
  readonly ingredient_id: string
  readonly quantity: number
  readonly unit: string
  readonly ingredient?: Ingredient
}


export interface SalesReport {
  readonly id: string
  readonly report_date: string
  readonly file_url: string | null
  readonly file_name: string | null
  readonly status: 'pending' | 'processing' | 'completed' | 'failed'
  readonly error_message: string | null
  readonly uploaded_by: string | null
  readonly created_at: string
}

export interface SalesDataItem {
  readonly id: string
  readonly sales_report_id: string
  readonly menu_item_id: string | null
  readonly raw_item_name: string
  readonly units_sold: number
  readonly report_date: string
  readonly created_at: string
  readonly menu_item?: MenuItem
}

export interface PrepList {
  readonly id: string
  readonly prep_date: string
  readonly generated_at: string
  readonly generated_by: string | null
}

export type PrepItemStatus = 'open' | 'in_progress' | 'completed'

export interface PrepListItem {
  readonly id: string
  readonly prep_list_id: string
  readonly ingredient_id: string
  readonly amount_needed: number
  readonly unit: string
  readonly status: PrepItemStatus
  readonly assigned_user_id: string | null
  readonly completed_at: string | null
  readonly last_status_update: string
  readonly ingredient?: Ingredient
  readonly assigned_user?: Profile
}

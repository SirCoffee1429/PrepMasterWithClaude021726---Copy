import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, BookOpen } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { Ingredient } from '@/lib/types'

export function RecipesTab() {
  const [searchQuery, setSearchQuery] = useState('')

  const { data: recipes = [] } = useQuery({
    queryKey: ['recipes'],
    queryFn: async () => {
      const { data } = await supabase
        .from('ingredients')
        .select('id, name, unit, recipe_data, station:stations(id, name)')
        .not('recipe_data', 'is', null)
        .order('name')
      return (data ?? []) as unknown as Ingredient[]
    },
  })

  const filtered = searchQuery
    ? recipes.filter((r) =>
        r.name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : recipes

  return (
    <div className="flex flex-col gap-6">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          placeholder="Search recipes..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="
            w-full rounded-xl border border-gray-300 pl-10 pr-4 py-3 text-base
            focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200
            placeholder:text-gray-400
          "
        />
      </div>

      <div className="flex flex-col gap-4">
        {filtered.map((recipe) => (
          <RecipeCard key={recipe.id} recipe={recipe} />
        ))}

        {filtered.length === 0 && (
          <p className="py-12 text-center text-gray-400">
            {searchQuery
              ? 'No recipes match your search.'
              : 'No recipes yet. Upload a recipe workbook in the Menu Items tab.'}
          </p>
        )}
      </div>
    </div>
  )
}

interface RecipeCardProps {
  readonly recipe: Ingredient
}

function RecipeCard({ recipe }: RecipeCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const recipeData = recipe.recipe_data

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <button
        onClick={() => setIsExpanded((prev) => !prev)}
        className="flex w-full items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          <BookOpen className="h-5 w-5 text-brand-500" />
          <div>
            <p className="font-semibold text-gray-900">{recipe.name}</p>
            {recipe.station && (
              <p className="text-xs text-gray-500">{recipe.station.name}</p>
            )}
          </div>
        </div>
        <span className="text-sm text-gray-400">
          {recipeData?.ingredients.length ?? 0} ingredients
        </span>
      </button>

      {isExpanded && recipeData && (
        <div className="border-t px-5 py-4 flex flex-col gap-4">
          {recipeData.ingredients.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-2">Ingredients</h4>
              <div className="rounded-lg border border-gray-100 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Item</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-500">Qty</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Measure</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recipeData.ingredients.map((ing, i) => (
                      <tr key={i} className="border-t border-gray-50">
                        <td className="px-3 py-2 text-gray-800">{ing.name}</td>
                        <td className="px-3 py-2 text-right text-gray-600">{ing.quantity}</td>
                        <td className="px-3 py-2 text-gray-500">{ing.measure}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {recipeData.assembly.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-2">Assembly / Steps</h4>
              <ol className="flex flex-col gap-1.5">
                {recipeData.assembly.map((step, i) => (
                  <li
                    key={i}
                    className="flex gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700"
                  >
                    <span className="shrink-0 font-bold text-brand-600">{i + 1}.</span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

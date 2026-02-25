import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Search, BookOpen, Pencil, Trash2, Check, X, FlaskConical } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { Ingredient } from '@/lib/types'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'

export function RecipesTab() {
  const queryClient = useQueryClient()
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
    ? recipes.filter((r) => r.name.toLowerCase().includes(searchQuery.toLowerCase()))
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
          <RecipeCard key={recipe.id} recipe={recipe} queryClient={queryClient} />
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
  readonly queryClient: ReturnType<typeof useQueryClient>
}

function RecipeCard({ recipe, queryClient }: RecipeCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(recipe.name)
  const [showDelete, setShowDelete] = useState(false)
  const recipeData = recipe.recipe_data

  // ── Rename ──
  const renameMutation = useMutation({
    mutationFn: async () => {
      const trimmed = editName.trim()
      if (!trimmed || trimmed === recipe.name) return
      const { error } = await supabase
        .from('ingredients')
        .update({ name: trimmed })
        .eq('id', recipe.id)
      if (error) throw error
    },
    onSuccess: () => {
      setEditing(false)
      queryClient.invalidateQueries({ queryKey: ['recipes'] })
      queryClient.invalidateQueries({ queryKey: ['ingredients-with-stations'] })
    },
  })

  // ── Delete recipe (clears recipe_data, keeps ingredient) ──
  const deleteMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('ingredients')
        .update({ recipe_data: null })
        .eq('id', recipe.id)
      if (error) throw error
    },
    onSuccess: () => {
      setShowDelete(false)
      queryClient.invalidateQueries({ queryKey: ['recipes'] })
      queryClient.invalidateQueries({ queryKey: ['ingredients-with-stations'] })
    },
  })

  const handleCancelEdit = () => {
    setEditName(recipe.name)
    setEditing(false)
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <div className="flex w-full items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors">
        {editing ? (
          <div className="flex items-center gap-2 flex-1 mr-2" onClick={(e) => e.stopPropagation()}>
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') renameMutation.mutate()
                if (e.key === 'Escape') handleCancelEdit()
              }}
              autoFocus
              className="flex-1 rounded border border-brand-400 px-2 py-1 text-sm font-semibold
                focus:outline-none focus:ring-1 focus:ring-brand-300"
            />
            <button
              onClick={() => renameMutation.mutate()}
              className="p-1 text-green-600 hover:text-green-700"
            >
              <Check className="h-4 w-4" />
            </button>
            <button onClick={handleCancelEdit} className="p-1 text-gray-400 hover:text-gray-600">
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setIsExpanded((prev) => !prev)}
            className="flex items-center gap-3 flex-1 text-left"
          >
            <BookOpen className="h-5 w-5 text-brand-500" />
            <div>
              <p className="font-semibold text-gray-900">{recipe.name}</p>
              <div className="flex items-center gap-3 text-xs text-gray-500">
                {recipe.station && <span>{recipe.station.name}</span>}
                {recipeData?.yield_amount != null && (
                  <span className="flex items-center gap-1">
                    <FlaskConical className="h-3 w-3" />
                    Yields {recipeData.yield_amount} {recipeData.yield_measure ?? ''}
                  </span>
                )}
              </div>
            </div>
          </button>
        )}

        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-400">
            {recipeData?.ingredients.length ?? 0} ingredients
          </span>
          {!editing && (
            <>
              <button
                onClick={() => { setEditName(recipe.name); setEditing(true) }}
                className="p-1.5 rounded text-gray-400 hover:text-brand-600 hover:bg-brand-50 transition-colors"
                title="Edit name"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setShowDelete(true)}
                className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                title="Delete recipe"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>
      </div>

      {isExpanded && recipeData && (
        <div className="border-t px-5 py-4 flex flex-col gap-4">
          {/* Yield info */}
          {(recipeData.yield_amount != null || recipeData.yield_measure) && (
            <div className="flex items-center gap-3 rounded-lg bg-brand-50 border border-brand-200 px-4 py-2.5">
              <FlaskConical className="h-4 w-4 text-brand-600 shrink-0" />
              <span className="text-sm">
                <span className="font-medium text-brand-800">Yield: </span>
                <span className="text-brand-700">
                  {recipeData.yield_amount ?? '—'} {recipeData.yield_measure ?? ''}
                </span>
              </span>
            </div>
          )}

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

      <ConfirmDialog
        open={showDelete}
        title="Delete Recipe"
        message={`Are you sure you want to delete the recipe for "${recipe.name}"? The ingredient will be kept but its recipe data will be cleared.`}
        onConfirm={() => deleteMutation.mutate()}
        onCancel={() => setShowDelete(false)}
      />
    </div>
  )
}

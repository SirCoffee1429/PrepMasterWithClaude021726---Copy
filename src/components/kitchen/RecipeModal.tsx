import { useCallback, useEffect } from 'react'
import { X } from 'lucide-react'
import type { PrepListItem } from '@/lib/types'

interface RecipeModalProps {
  readonly item: PrepListItem | null
  readonly onClose: () => void
}

export function RecipeModal({ item, onClose }: RecipeModalProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    },
    [onClose]
  )

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  if (!item) return null

  const recipe = item.ingredient?.recipe_data

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white px-6 py-4 rounded-t-2xl">
          <h2 className="text-2xl font-bold text-gray-900">
            {item.ingredient?.name ?? 'Recipe'}
          </h2>
          <button
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-gray-100 transition-colors"
            aria-label="Close recipe"
          >
            <X className="h-6 w-6 text-gray-500" />
          </button>
        </div>

        <div className="px-6 py-5">
          {recipe ? (
            <div className="flex flex-col gap-6">
              {recipe.ingredients.length > 0 && (
                <section>
                  <h3 className="text-lg font-semibold text-gray-800 mb-3">
                    Ingredients
                  </h3>
                  <div className="rounded-xl border border-gray-200 overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-2.5 text-left font-medium text-gray-600">
                            Item
                          </th>
                          <th className="px-4 py-2.5 text-right font-medium text-gray-600">
                            Qty
                          </th>
                          <th className="px-4 py-2.5 text-left font-medium text-gray-600">
                            Measure
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {recipe.ingredients.map((ing, i) => (
                          <tr key={i} className="border-t border-gray-100">
                            <td className="px-4 py-2.5 text-gray-900">{ing.name}</td>
                            <td className="px-4 py-2.5 text-right text-gray-700">{ing.quantity}</td>
                            <td className="px-4 py-2.5 text-gray-500">{ing.measure}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {recipe.assembly.length > 0 && (
                <section>
                  <h3 className="text-lg font-semibold text-gray-800 mb-3">
                    Assembly / Steps
                  </h3>
                  <ol className="flex flex-col gap-2">
                    {recipe.assembly.map((step, i) => (
                      <li
                        key={i}
                        className="flex gap-3 rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-700"
                      >
                        <span className="shrink-0 font-bold text-brand-600">
                          {i + 1}.
                        </span>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ol>
                </section>
              )}
            </div>
          ) : (
            <div className="py-12 text-center text-gray-400">
              <p className="text-lg">No recipe data available</p>
              <p className="mt-1 text-sm">Upload the recipe workbook in the Office to add recipe details.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Save, ChevronRight, ChevronDown, FlaskConical, Pencil, Trash2, Check, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { ACCEPTED_UPLOAD_TYPES, STATIONS } from '@/lib/constants'
import type { Ingredient } from '@/lib/types'
import { FileUpload } from '@/components/shared/FileUpload'
import type { FileItem } from '@/components/shared/FileUpload'
import { DuplicateReport } from '@/components/shared/DuplicateReport'
import type { DuplicateGroup } from '@/components/shared/DuplicateReport'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'

export function ParLevelsTab() {
  const queryClient = useQueryClient()
  const [fileItems, setFileItems] = useState<FileItem[]>([])
  const [editedPars, setEditedPars] = useState<Map<string, { par?: number; unit?: string }>>(
    new Map()
  )
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[]>([])
  const [crossFileDuplicates, setCrossFileDuplicates] = useState<string[]>([])
  const [expandedRecipes, setExpandedRecipes] = useState<Set<string>>(new Set())
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)

  const { data: ingredients = [] } = useQuery({
    queryKey: ['ingredients-with-stations'],
    queryFn: async () => {
      const { data } = await supabase
        .from('ingredients')
        .select('id, name, station_id, unit, par_level, recipe_data, station:stations(id, name)')
        .order('name')
      return (data ?? []) as unknown as Ingredient[]
    },
  })

  const { data: menuItemNames = [] } = useQuery({
    queryKey: ['menu-item-names-for-filter'],
    queryFn: async () => {
      const { data } = await supabase.from('menu_items').select('name')
      return (data ?? []).map((mi) => mi.name.toLowerCase())
    },
  })

  const menuNameSet = new Set(menuItemNames)
  const filteredIngredients = ingredients.filter(
    (ing) => !menuNameSet.has(ing.name.toLowerCase())
  )

  // ── Save par/unit edits ──
  const saveMutation = useMutation({
    mutationFn: async () => {
      const updates = Array.from(editedPars.entries()).map(([id, changes]) => {
        const ingredient = ingredients.find((ing) => ing.id === id)
        return {
          id,
          par_level: changes.par ?? ingredient?.par_level ?? 0,
          unit: changes.unit ?? ingredient?.unit ?? '',
        }
      })
      for (const update of updates) {
        const { error } = await supabase
          .from('ingredients')
          .update({ par_level: update.par_level, unit: update.unit })
          .eq('id', update.id)
        if (error) throw error
      }
    },
    onSuccess: () => {
      setEditedPars(new Map())
      queryClient.invalidateQueries({ queryKey: ['ingredients-with-stations'] })
    },
  })

  // ── Delete ingredient ──
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('ingredients').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      setDeleteTarget(null)
      queryClient.invalidateQueries({ queryKey: ['ingredients-with-stations'] })
      queryClient.invalidateQueries({ queryKey: ['menu-items-with-components'] })
      queryClient.invalidateQueries({ queryKey: ['recipes'] })
    },
  })

  // ── Rename ingredient ──
  const renameMutation = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { error } = await supabase.from('ingredients').update({ name }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ingredients-with-stations'] })
    },
  })

  const handleParChange = useCallback((ingredientId: string, value: string) => {
    const num = parseFloat(value)
    if (isNaN(num) || num < 0) return
    setEditedPars((prev) => {
      const next = new Map(prev)
      const existing = next.get(ingredientId) ?? {}
      next.set(ingredientId, { ...existing, par: num })
      return next
    })
  }, [])

  const handleUnitChange = useCallback((ingredientId: string, value: string) => {
    setEditedPars((prev) => {
      const next = new Map(prev)
      const existing = next.get(ingredientId) ?? {}
      next.set(ingredientId, { ...existing, unit: value })
      return next
    })
  }, [])

  const getParValue = (ingredient: Ingredient): string => {
    const edited = editedPars.get(ingredient.id)
    if (edited?.par !== undefined) return String(edited.par)
    return ingredient.par_level > 0 ? String(ingredient.par_level) : ''
  }

  const getUnitValue = (ingredient: Ingredient): string => {
    const edited = editedPars.get(ingredient.id)
    if (edited?.unit !== undefined) return edited.unit
    return ingredient.unit || ''
  }

  const toggleRecipe = useCallback((ingredientId: string) => {
    setExpandedRecipes((prev) => {
      const next = new Set(prev)
      if (next.has(ingredientId)) next.delete(ingredientId)
      else next.add(ingredientId)
      return next
    })
  }, [])

  const handleFilesSelect = useCallback(
    async (files: File[]) => {
      const items: FileItem[] = files.map((f) => ({ file: f, status: 'queued' as const }))
      setFileItems(items)
      setDuplicateGroups([])
      setCrossFileDuplicates([])

      const allNew: string[] = []
      const allDup: string[] = []
      const seenAcrossFiles = new Map<string, number>()

      for (let i = 0; i < files.length; i++) {
        setFileItems((prev) =>
          prev.map((item, idx) =>
            idx === i ? { ...item, status: 'uploading' as const, message: 'Parsing...' } : item
          )
        )
        try {
          const formData = new FormData()
          formData.append('file', files[i])
          const { data, error } = await supabase.functions.invoke('parse-par-levels', {
            body: formData,
          })
          if (error) throw error

          const count = data?.count ?? 0
          const newItems: string[] = data?.new_items ?? []
          const dupItems: string[] = data?.duplicate_items ?? []
          allNew.push(...newItems)
          allDup.push(...dupItems)

          for (const name of [...newItems, ...dupItems]) {
            const lower = name.toLowerCase()
            seenAcrossFiles.set(lower, (seenAcrossFiles.get(lower) ?? 0) + 1)
          }

          setFileItems((prev) =>
            prev.map((item, idx) =>
              idx === i
                ? { ...item, status: 'success' as const, message: `${count} items parsed` }
                : item
            )
          )
        } catch (err) {
          setFileItems((prev) =>
            prev.map((item, idx) =>
              idx === i
                ? {
                  ...item,
                  status: 'error' as const,
                  message: err instanceof Error ? err.message : 'Failed',
                }
                : item
            )
          )
        }
      }

      setDuplicateGroups([
        { label: 'Ingredients', newItems: [...new Set(allNew)], duplicateItems: [...new Set(allDup)] },
      ])
      const crossFile = Array.from(seenAcrossFiles.entries())
        .filter(([, count]) => count > 1)
        .map(([name]) => name)
      setCrossFileDuplicates(crossFile)

      queryClient.invalidateQueries({ queryKey: ['ingredients-with-stations'] })
    },
    [queryClient]
  )

  const isUploading = fileItems.some((f) => f.status === 'uploading')

  // Group by station
  const ingredientsByStation = new Map<string, Ingredient[]>()
  for (const station of STATIONS) ingredientsByStation.set(station, [])
  ingredientsByStation.set('Other', [])

  for (const ing of filteredIngredients) {
    const stationName = ing.station?.name ?? 'Other'
    const list = ingredientsByStation.get(stationName) ?? []
    ingredientsByStation.set(stationName, [...list, ing])
  }

  const ingredientByName = new Map<string, Ingredient>()
  for (const ing of ingredients) ingredientByName.set(ing.name.toLowerCase(), ing)

  return (
    <div className="flex flex-col gap-6">
      <FileUpload
        accept={[...ACCEPTED_UPLOAD_TYPES.parLevels]}
        onFilesSelect={handleFilesSelect}
        isUploading={isUploading}
        fileItems={fileItems}
        label="Upload Par Level Sheets (PDF / XLSX)"
      />

      <DuplicateReport groups={duplicateGroups} crossFileDuplicates={crossFileDuplicates} />

      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">Par Level Grid</h3>
        {editedPars.size > 0 && (
          <button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2
              text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            Save Changes ({editedPars.size})
          </button>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="sticky left-0 bg-gray-50 px-4 py-3 text-left font-medium text-gray-600 min-w-[250px]">
                Ingredient / Recipe
              </th>
              <th className="px-3 py-3 text-center font-medium text-gray-600 min-w-[100px]">Par</th>
              <th className="px-3 py-3 text-left font-medium text-gray-600 min-w-[120px]">Unit</th>
              <th className="px-3 py-3 text-center font-medium text-gray-600 w-[80px]">Actions</th>
            </tr>
          </thead>
          <tbody>
            {Array.from(ingredientsByStation.entries()).map(([station, ings]) =>
              ings.length > 0 ? (
                <StationGroup
                  key={station}
                  stationName={station}
                  ingredients={ings}
                  getParValue={getParValue}
                  getUnitValue={getUnitValue}
                  onParChange={handleParChange}
                  onUnitChange={handleUnitChange}
                  expandedRecipes={expandedRecipes}
                  onToggleRecipe={toggleRecipe}
                  ingredientByName={ingredientByName}
                  onDelete={(id, name) => setDeleteTarget({ id, name })}
                  onRename={(id, name) => renameMutation.mutate({ id, name })}
                />
              ) : null
            )}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Ingredient"
        message={`Are you sure you want to delete "${deleteTarget?.name}"? This will also remove it from any menu items and prep lists.`}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}

// ── Station Group ──
interface StationGroupProps {
  readonly stationName: string
  readonly ingredients: ReadonlyArray<Ingredient>
  readonly getParValue: (ingredient: Ingredient) => string
  readonly getUnitValue: (ingredient: Ingredient) => string
  readonly onParChange: (ingredientId: string, value: string) => void
  readonly onUnitChange: (ingredientId: string, value: string) => void
  readonly expandedRecipes: Set<string>
  readonly onToggleRecipe: (ingredientId: string) => void
  readonly ingredientByName: Map<string, Ingredient>
  readonly onDelete: (id: string, name: string) => void
  readonly onRename: (id: string, name: string) => void
}

function StationGroup({
  stationName,
  ingredients,
  getParValue,
  getUnitValue,
  onParChange,
  onUnitChange,
  expandedRecipes,
  onToggleRecipe,
  ingredientByName,
  onDelete,
  onRename,
}: StationGroupProps) {
  return (
    <>
      <tr>
        <td colSpan={4} className="bg-brand-50 px-4 py-2 text-sm font-bold text-brand-800 border-t">
          {stationName}
        </td>
      </tr>
      {ingredients.map((ing) => (
        <IngredientRow
          key={ing.id}
          ingredient={ing}
          isRecipe={!!ing.recipe_data}
          isExpanded={expandedRecipes.has(ing.id)}
          getParValue={getParValue}
          getUnitValue={getUnitValue}
          onParChange={onParChange}
          onUnitChange={onUnitChange}
          onToggleRecipe={onToggleRecipe}
          ingredientByName={ingredientByName}
          onDelete={onDelete}
          onRename={onRename}
        />
      ))}
    </>
  )
}

// ── Ingredient / Recipe Row ──
interface IngredientRowProps {
  readonly ingredient: Ingredient
  readonly isRecipe: boolean
  readonly isExpanded: boolean
  readonly getParValue: (ingredient: Ingredient) => string
  readonly getUnitValue: (ingredient: Ingredient) => string
  readonly onParChange: (ingredientId: string, value: string) => void
  readonly onUnitChange: (ingredientId: string, value: string) => void
  readonly onToggleRecipe: (ingredientId: string) => void
  readonly ingredientByName: Map<string, Ingredient>
  readonly onDelete: (id: string, name: string) => void
  readonly onRename: (id: string, name: string) => void
}

function IngredientRow({
  ingredient,
  isRecipe,
  isExpanded,
  getParValue,
  getUnitValue,
  onParChange,
  onUnitChange,
  onToggleRecipe,
  ingredientByName,
  onDelete,
  onRename,
}: IngredientRowProps) {
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(ingredient.name)

  const handleSaveName = () => {
    const trimmed = editName.trim()
    if (trimmed && trimmed !== ingredient.name) {
      onRename(ingredient.id, trimmed)
    }
    setEditing(false)
  }

  const handleCancelEdit = () => {
    setEditName(ingredient.name)
    setEditing(false)
  }

  return (
    <>
      <tr
        className={`border-t border-gray-100 ${isRecipe ? 'cursor-pointer hover:bg-blue-50' : 'hover:bg-gray-50'}`}
        onClick={isRecipe && !editing ? () => onToggleRecipe(ingredient.id) : undefined}
      >
        <td className="sticky left-0 bg-white px-4 py-2 font-medium text-gray-900">
          {editing ? (
            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveName()
                  if (e.key === 'Escape') handleCancelEdit()
                }}
                autoFocus
                className="flex-1 rounded border border-brand-400 px-2 py-1 text-sm
                  focus:outline-none focus:ring-1 focus:ring-brand-300"
              />
              <button onClick={handleSaveName} className="p-1 text-green-600 hover:text-green-700">
                <Check className="h-4 w-4" />
              </button>
              <button onClick={handleCancelEdit} className="p-1 text-gray-400 hover:text-gray-600">
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              {isRecipe &&
                (isExpanded ? (
                  <ChevronDown className="h-4 w-4 text-blue-500 shrink-0" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-blue-500 shrink-0" />
                ))}
              {isRecipe && <FlaskConical className="h-4 w-4 text-blue-500 shrink-0" />}
              <span className={isRecipe ? 'text-blue-700 font-semibold' : ''}>
                {ingredient.name}
              </span>
              {isRecipe && (
                <span className="text-xs bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded-full font-medium">
                  Recipe
                </span>
              )}
            </div>
          )}
        </td>
        <td className="px-1 py-1 text-center" onClick={(e) => e.stopPropagation()}>
          <input
            type="number"
            min="0"
            step="0.01"
            value={getParValue(ingredient)}
            onChange={(e) => onParChange(ingredient.id, e.target.value)}
            placeholder="—"
            className="w-full rounded border border-gray-200 px-2 py-1.5 text-center text-sm
              focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-200"
          />
        </td>
        <td className="px-1 py-1" onClick={(e) => e.stopPropagation()}>
          <input
            type="text"
            value={getUnitValue(ingredient)}
            onChange={(e) => onUnitChange(ingredient.id, e.target.value)}
            placeholder="unit"
            className="w-full rounded border border-gray-200 px-2 py-1.5 text-sm
              focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-200"
          />
        </td>
        <td className="px-1 py-1 text-center" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-center gap-1">
            {!editing && (
              <button
                onClick={() => { setEditName(ingredient.name); setEditing(true) }}
                className="p-1.5 rounded text-gray-400 hover:text-brand-600 hover:bg-brand-50 transition-colors"
                title="Edit name"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              onClick={() => onDelete(ingredient.id, ingredient.name)}
              className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
              title="Delete"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </td>
      </tr>

      {/* Expanded recipe components */}
      {isRecipe &&
        isExpanded &&
        ingredient.recipe_data?.ingredients.map((comp) => {
          const compIngredient = ingredientByName.get(comp.name.toLowerCase())
          return (
            <tr key={`${ingredient.id}-${comp.name}`} className="border-t border-blue-100 bg-blue-50/30">
              <td className="sticky left-0 bg-blue-50/30 pl-12 pr-4 py-1.5 text-gray-600 text-sm">
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-300 shrink-0" />
                  {comp.name}
                  <span className="text-xs text-gray-400">
                    ({comp.quantity} {comp.measure})
                  </span>
                </div>
              </td>
              <td className="px-1 py-1 text-center">
                {compIngredient ? (
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={getParValue(compIngredient)}
                    onChange={(e) => onParChange(compIngredient.id, e.target.value)}
                    placeholder="—"
                    className="w-full rounded border border-blue-200 bg-white/80 px-2 py-1 text-center text-xs
                      focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-200"
                  />
                ) : (
                  <span className="text-xs text-gray-300">—</span>
                )}
              </td>
              <td className="px-1 py-1">
                {compIngredient ? (
                  <input
                    type="text"
                    value={getUnitValue(compIngredient)}
                    onChange={(e) => onUnitChange(compIngredient.id, e.target.value)}
                    placeholder="unit"
                    className="w-full rounded border border-blue-200 bg-white/80 px-2 py-1 text-xs
                      focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-200"
                  />
                ) : (
                  <span className="text-xs text-gray-300">—</span>
                )}
              </td>
              <td className="px-1 py-1" />
            </tr>
          )
        })}
    </>
  )
}
